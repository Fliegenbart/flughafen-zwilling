from __future__ import annotations

import random
import time
from dataclasses import dataclass

from .models import (
    AirportKpiSummary,
    ModelPack,
    PlaybookAction,
    PlaybookConstraints,
    PlaybookOption,
    ScenarioDefinition,
    TimelineEvent,
)
from .simulators.airport_turnaround import run_airport_turnaround_simulation

_ALLOWED_LEVERS = [
    "gates_open_pct",
    "ground_crew_teams",
    "runway_slots_per_hour",
    "baggage_capacity_flights_per_hour",
    "departures_per_hour",
]

_LEVER_VALUES: dict[str, list[float]] = {
    "gates_open_pct": [2.0, 4.0, 6.0, 8.0, 10.0],
    "ground_crew_teams": [1.0, 2.0, 3.0],
    "runway_slots_per_hour": [1.0, 2.0, 3.0, 4.0],
    "baggage_capacity_flights_per_hour": [2.0, 4.0, 6.0, 8.0],
    "departures_per_hour": [-1.0, -2.0, -3.0, -4.0, -5.0],
}

_COST_PER_UNIT: dict[str, float] = {
    "gates_open_pct": 1.0,
    "ground_crew_teams": 6.0,
    "runway_slots_per_hour": 5.0,
    "baggage_capacity_flights_per_hour": 3.0,
    "departures_per_hour": 2.5,
}


@dataclass
class SynthResult:
    baseline_option: PlaybookOption
    best_option: PlaybookOption
    pareto_options: list[PlaybookOption]
    candidates_evaluated: int
    frontier_size: int


@dataclass
class _CandidateSpec:
    actions: list[PlaybookAction]


def default_action_epochs(scenario: ScenarioDefinition) -> list[int]:
    if scenario.disturbances:
        disturbance = sorted(scenario.disturbances, key=lambda d: d.start_ms)[0]
        epochs = [
            max(0, disturbance.start_ms - 2000),
            min(scenario.duration_ms, disturbance.start_ms + int(disturbance.duration_ms * 0.3)),
            min(scenario.duration_ms, disturbance.start_ms + int(disturbance.duration_ms * 0.7)),
        ]
        result = sorted(set(max(0, min(scenario.duration_ms, ts)) for ts in epochs))
        return result or [0]
    fallback = [8000, 20000, 32000]
    result = sorted(set(max(0, min(scenario.duration_ms, ts)) for ts in fallback))
    return result or [0]


def _action_signature(actions: list[PlaybookAction]) -> tuple[tuple[int, str, str, float], ...]:
    return tuple(sorted((a.at_ms, a.target, a.action, round(a.value, 4)) for a in actions))


def _build_baseline_and_sweep_specs(
    scenario: ScenarioDefinition,
    epochs: list[int],
) -> list[_CandidateSpec]:
    baseline = _CandidateSpec(actions=[])
    specs = [baseline]
    epoch = epochs[0] if epochs else 0
    for target in _ALLOWED_LEVERS:
        for value in _LEVER_VALUES[target]:
            specs.append(
                _CandidateSpec(
                    actions=[
                        PlaybookAction(
                            at_ms=epoch,
                            target=target,
                            action="inject",
                            value=value,
                            cost_component=abs(value) * _COST_PER_UNIT[target],
                        )
                    ]
                )
            )
    return specs


def _build_random_composite_spec(
    rng: random.Random,
    epochs: list[int],
) -> _CandidateSpec:
    n_actions = rng.randint(1, 3)
    chosen_targets = rng.sample(_ALLOWED_LEVERS, k=n_actions)
    actions: list[PlaybookAction] = []
    for target in chosen_targets:
        value = rng.choice(_LEVER_VALUES[target])
        at_ms = rng.choice(epochs)
        actions.append(
            PlaybookAction(
                at_ms=at_ms,
                target=target,
                action="inject",
                value=value,
                cost_component=abs(value) * _COST_PER_UNIT[target],
            )
        )
    return _CandidateSpec(actions=actions)


def build_playbook_scenario(
    base_scenario: ScenarioDefinition,
    option: PlaybookOption,
    scenario_id: str,
) -> ScenarioDefinition:
    scenario = base_scenario.model_copy(deep=True)
    scenario.id = scenario_id
    scenario.description = f"Playbook candidate {option.option_id} from {base_scenario.id}"
    scenario.timeline_events = [
        *scenario.timeline_events,
        *[
            TimelineEvent(
                at_ms=action.at_ms,
                action=action.action,
                target=action.target,
                value=action.value,
            )
            for action in option.actions
        ],
    ]
    scenario.metadata = {
        **scenario.metadata,
        "generated_by": "playbook_synth",
        "playbook_option_id": option.option_id,
    }
    return scenario


def _apply_candidate_to_scenario(base: ScenarioDefinition, spec: _CandidateSpec) -> ScenarioDefinition:
    scenario = base.model_copy(deep=True)
    scenario.timeline_events = [
        *scenario.timeline_events,
        *[
            TimelineEvent(at_ms=a.at_ms, action=a.action, target=a.target, value=a.value)
            for a in spec.actions
        ],
    ]
    return scenario


def _ensure_kpis(kpis: AirportKpiSummary | None) -> AirportKpiSummary:
    return kpis or AirportKpiSummary()


def _violation_penalty(kpis: AirportKpiSummary, constraints: PlaybookConstraints) -> float:
    return (
        max(0.0, constraints.otp_min_pct - kpis.otp_rate_pct) * 3.0
        + max(0.0, kpis.avg_turnaround_min - constraints.turnaround_max_min) * 2.0
        + max(0.0, kpis.gate_utilization_avg_pct - constraints.gate_utilization_max_pct) * 1.5
    )


def _is_feasible(kpis: AirportKpiSummary, constraints: PlaybookConstraints) -> bool:
    return (
        kpis.otp_rate_pct >= constraints.otp_min_pct
        and kpis.avg_turnaround_min <= constraints.turnaround_max_min
        and kpis.gate_utilization_avg_pct <= constraints.gate_utilization_max_pct
    )


def _option_objective(option: PlaybookOption) -> tuple[float, float, float, float, float]:
    return option.objective_tuple


def _pareto_frontier(options: list[PlaybookOption]) -> list[PlaybookOption]:
    frontier: list[PlaybookOption] = []
    for option in options:
        dominated = False
        for other in options:
            if other.option_id == option.option_id:
                continue
            o_kpi = option.estimated_airport_kpis
            r_kpi = other.estimated_airport_kpis
            if (
                r_kpi.otp_rate_pct >= o_kpi.otp_rate_pct
                and other.intervention_cost <= option.intervention_cost
                and r_kpi.delay_avg_min <= o_kpi.delay_avg_min
                and (
                    r_kpi.otp_rate_pct > o_kpi.otp_rate_pct
                    or other.intervention_cost < option.intervention_cost
                    or r_kpi.delay_avg_min < o_kpi.delay_avg_min
                )
            ):
                dominated = True
                break
        if not dominated:
            frontier.append(option)
    return frontier


def synthesize_playbook_options(
    scenario: ScenarioDefinition,
    model_pack: ModelPack,
    seed: int,
    constraints: PlaybookConstraints,
    *,
    search_budget_sec: int,
    search_seed: int | None,
    max_candidates: int = 640,
) -> SynthResult:
    start = time.monotonic()
    rng = random.Random(search_seed if search_seed is not None else seed)
    epochs = default_action_epochs(scenario)

    evaluated: list[PlaybookOption] = []
    seen_signatures: set[tuple[tuple[int, str, str, float], ...]] = set()

    def evaluate_spec(spec: _CandidateSpec, idx: int) -> None:
        candidate_scenario = _apply_candidate_to_scenario(scenario, spec)
        summary, _ = run_airport_turnaround_simulation(
            run_id=f"playbook-eval-{idx}",
            scenario=candidate_scenario,
            model_pack=model_pack,
            seed=seed,
            realtime_mode="sil",
            adapters=[],
            telemetry_callback=None,
        )
        kpis = _ensure_kpis(summary.airport_kpis)
        feasible = _is_feasible(kpis, constraints)
        penalty = _violation_penalty(kpis, constraints)
        cost = sum(action.cost_component for action in spec.actions)
        objective = (
            0.0 if feasible else 1.0,
            penalty,
            cost,
            float(len(spec.actions)),
            kpis.delay_avg_min,
        )
        option_id = "baseline" if not spec.actions else f"opt_{idx:03d}"
        option = PlaybookOption(
            option_id=option_id,
            feasible=feasible,
            violation_penalty=round(penalty, 6),
            intervention_cost=round(cost, 6),
            estimated_airport_kpis=kpis,
            actions=spec.actions,
            objective_tuple=objective,
        )
        evaluated.append(option)

    base_specs = _build_baseline_and_sweep_specs(scenario, epochs)
    index = 1
    for spec in base_specs:
        if len(evaluated) >= max_candidates:
            break
        if time.monotonic() - start >= search_budget_sec:
            break
        signature = _action_signature(spec.actions)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        evaluate_spec(spec, index)
        index += 1

    while len(evaluated) < max_candidates and (time.monotonic() - start) < search_budget_sec:
        spec = _build_random_composite_spec(rng, epochs)
        signature = _action_signature(spec.actions)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        evaluate_spec(spec, index)
        index += 1

    if not evaluated:
        evaluate_spec(_CandidateSpec(actions=[]), 1)

    ranked = sorted(evaluated, key=_option_objective)
    baseline = next((option for option in evaluated if not option.actions), ranked[0])
    best = ranked[0]
    frontier = sorted(_pareto_frontier(ranked), key=_option_objective)

    return SynthResult(
        baseline_option=baseline,
        best_option=best,
        pareto_options=frontier,
        candidates_evaluated=len(ranked),
        frontier_size=len(frontier),
    )
