from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

from .adapters import AdapterPlugin
from .models import (
    AssertionResult,
    AssertionSpec,
    ExpectedAssertion,
    ModelPack,
    RunSummary,
    SafetySummary,
    ScenarioDefinition,
    TelemetrySample,
)
from .simulators import run_airport_turnaround_simulation, run_legacy_ems_simulation
from .munich.integration import run_energy_simulation
from .munich.coupled_integration import run_coupled_simulation


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * _clamp(t, 0.0, 1.0)


def _compare(observed: float, op: str, threshold: float) -> bool:
    if op == "<":
        return observed < threshold
    if op == "<=":
        return observed <= threshold
    if op == ">":
        return observed > threshold
    if op == ">=":
        return observed >= threshold
    if op == "==":
        return observed == threshold
    if op == "!=":
        return observed != threshold
    return False


@dataclass
class SimulationResult:
    telemetry: list[TelemetrySample]
    summary: RunSummary
    assertion_results: list[AssertionResult]
    pass_fail: bool
    watchdog_summary: SafetySummary
    extra_artifacts: dict[str, str] = field(default_factory=dict)


def _metrics_from_summary(summary: RunSummary) -> dict[str, float]:
    metrics: dict[str, float] = {
        "freq_nadir_hz": summary.freq_nadir_hz,
        "volt_nadir_v": summary.volt_nadir_v,
        "blackout_ms": float(summary.blackout_ms),
        "switch_time_ms": float(summary.switch_time_ms),
        "final_soc_pct": summary.final_soc_pct,
        "io_latency_p99_ms": summary.io_latency_p99_ms,
        "tick_drift_avg_ms": summary.tick_drift_avg_ms,
        "tick_drift_max_ms": summary.tick_drift_max_ms,
        "tick_drift_p99_ms": summary.tick_drift_p99_ms,
    }

    if summary.airport_kpis is not None:
        kpis = summary.airport_kpis
        metrics.update(
            {
                "otp_rate_pct": kpis.otp_rate_pct,
                "avg_turnaround_min": kpis.avg_turnaround_min,
                "gate_utilization_avg_pct": kpis.gate_utilization_avg_pct,
                "ground_crew_utilization_avg_pct": kpis.ground_crew_utilization_avg_pct,
                "departure_queue_avg_flights": kpis.departure_queue_avg_flights,
                "baggage_queue_avg_flights": kpis.baggage_queue_avg_flights,
                "delay_avg_min": kpis.delay_avg_min,
                "airport_kpis.otp_rate_pct": kpis.otp_rate_pct,
                "airport_kpis.avg_turnaround_min": kpis.avg_turnaround_min,
                "airport_kpis.gate_utilization_avg_pct": kpis.gate_utilization_avg_pct,
                "airport_kpis.ground_crew_utilization_avg_pct": kpis.ground_crew_utilization_avg_pct,
                "airport_kpis.departure_queue_avg_flights": kpis.departure_queue_avg_flights,
                "airport_kpis.baggage_queue_avg_flights": kpis.baggage_queue_avg_flights,
                "airport_kpis.delay_avg_min": kpis.delay_avg_min,
            }
        )

    if summary.energy_kpis is not None:
        metrics.update({f"energy_kpis.{key}": float(value)
                        for key, value in summary.energy_kpis.model_dump().items()
                        if isinstance(value, (int, float))})
    if summary.coupled_kpis is not None:
        metrics.update({f"coupled_kpis.{key}": float(value)
                        for key, value in summary.coupled_kpis.model_dump().items()
                        if isinstance(value, (int, float))})
    return metrics


def evaluate_assertions(
    summary: RunSummary,
    expected: list[ExpectedAssertion],
    custom: list[AssertionSpec],
) -> tuple[list[AssertionResult], bool]:
    metrics = _metrics_from_summary(summary)

    merged: list[AssertionSpec] = [
        AssertionSpec(metric=e.metric, op=e.op, threshold=e.threshold, name=e.name)
        for e in expected
    ] + custom

    if not merged:
        if summary.domain == "airport_coupled_v1":
            merged = [
                # Buchfuehrungscheck: dieselbe Gleichung, die die Bilanz schliesst; per
                # Konstruktion ~0 und kein unabhaengiger Physiknachweis.
                AssertionSpec(name="Wirkleistungsbilanz (Buchfuehrungscheck)",
                              metric="energy_kpis.balance_error_max_kw",
                              op="<=", threshold=0.000001),
                AssertionSpec(name="Fahrzeug-Energiebilanz",
                              metric="coupled_kpis.fleet_energy_balance_error_kwh",
                              op="<=", threshold=0.000001),
                # Unabhaengig aufsummierte Lade-/Entlade-/Verlustgroessen gegen SOC-Differenz.
                AssertionSpec(name="Speicher-Energiebilanz",
                              metric="coupled_kpis.storage_energy_balance_error_kwh",
                              op="<=", threshold=0.000001),
                AssertionSpec(name="Fahrzeugreserve eingehalten",
                              metric="coupled_kpis.fleet_reserve_violations", op="<=", threshold=0),
                AssertionSpec(name="Keine unerledigten Modellauftraege",
                              metric="coupled_kpis.missions_uncompleted", op="<=", threshold=0),
                AssertionSpec(name="Alle Modellauftraege rechtzeitig",
                              metric="coupled_kpis.mission_on_time_pct", op=">=", threshold=100),
                AssertionSpec(name="Grundlast versorgt (nur Modell)",
                              metric="energy_kpis.background_unserved_kwh", op="<=", threshold=0.001),
                AssertionSpec(name="Parkhausfristen erfuellt (nur Modell)",
                              metric="energy_kpis.charging_unmet_kwh", op="<=", threshold=0.001),
                AssertionSpec(name="BHKW-Erzeugung absetzbar (nur Modell)",
                              metric="energy_kpis.chp_unabsorbed_kwh", op="<=", threshold=0.001),
            ]
        elif summary.domain == "airport_energy_v1":
            merged = [
                AssertionSpec(name="Modellbilanz", metric="energy_kpis.balance_error_max_kw",
                              op="<=", threshold=0.000001),
                AssertionSpec(name="Grundlast versorgt (nur Modell)",
                              metric="energy_kpis.background_unserved_kwh", op="<=", threshold=0.001),
                AssertionSpec(name="Ladefristen erfuellt (nur Modell)",
                              metric="energy_kpis.charging_unmet_kwh", op="<=", threshold=0.001),
                AssertionSpec(name="BHKW-Erzeugung absetzbar (nur Modell)",
                              metric="energy_kpis.chp_unabsorbed_kwh", op="<=", threshold=0.001),
            ]
        elif summary.domain == "airport_turnaround_v1":
            merged = [
                AssertionSpec(name="OTP Rate", metric="otp_rate_pct", op=">=", threshold=85.0),
                AssertionSpec(name="Turnaround Avg", metric="avg_turnaround_min", op="<=", threshold=55.0),
                AssertionSpec(
                    name="Gate Utilization Avg",
                    metric="gate_utilization_avg_pct",
                    op="<=",
                    threshold=92.0,
                ),
            ]
        else:
            merged = [
                AssertionSpec(name="Frequency extremum", metric="freq_nadir_hz", op=">=", threshold=47.0),
                AssertionSpec(name="Voltage extremum", metric="volt_nadir_v", op=">=", threshold=340.0),
                AssertionSpec(name="Blackout budget", metric="blackout_ms", op="<=", threshold=500.0),
            ]

    results: list[AssertionResult] = []
    all_pass = True
    for spec in merged:
        observed = metrics.get(spec.metric)
        if observed is None:
            observed = math.nan
            passed = False
        else:
            passed = _compare(observed, spec.op, spec.threshold)

        all_pass = all_pass and passed
        results.append(
            AssertionResult(
                name=spec.name,
                metric=spec.metric,
                op=spec.op,
                threshold=spec.threshold,
                observed=round(observed, 6) if isinstance(observed, float) and not math.isnan(observed) else observed,
                passed=passed,
            )
        )

    return results, all_pass


def run_simulation(
    run_id: str,
    scenario: ScenarioDefinition,
    model_pack: ModelPack,
    seed: int,
    realtime_mode: str,
    adapters: list[AdapterPlugin],
    run_assertions: list[AssertionSpec],
    telemetry_callback: Callable[[TelemetrySample], None] | None = None,
) -> SimulationResult:
    extra_artifacts: dict[str, str] = {}
    if scenario.domain == "ems_legacy_v1":
        summary, watchdog_summary = run_legacy_ems_simulation(
            run_id=run_id,
            scenario=scenario,
            model_pack=model_pack,
            seed=seed,
            realtime_mode=realtime_mode,
            adapters=adapters,
            telemetry_callback=telemetry_callback,
        )
    elif scenario.domain == "airport_coupled_v1":
        summary, watchdog_summary, extra_artifacts = run_coupled_simulation(
            run_id=run_id, scenario=scenario, model_pack=model_pack, seed=seed,
            realtime_mode=realtime_mode, adapters=adapters, telemetry_callback=telemetry_callback,
        )
    elif scenario.domain == "airport_energy_v1":
        summary, watchdog_summary = run_energy_simulation(
            run_id=run_id, scenario=scenario, model_pack=model_pack, seed=seed,
            realtime_mode=realtime_mode, adapters=adapters, telemetry_callback=telemetry_callback,
        )
    else:
        summary, watchdog_summary = run_airport_turnaround_simulation(
            run_id=run_id,
            scenario=scenario,
            model_pack=model_pack,
            seed=seed,
            realtime_mode=realtime_mode,
            adapters=adapters,
            telemetry_callback=telemetry_callback,
        )

    assertion_results, pass_fail = evaluate_assertions(summary, scenario.expected_assertions, run_assertions)
    return SimulationResult(
        telemetry=[],
        summary=summary,
        assertion_results=assertion_results,
        pass_fail=pass_fail,
        watchdog_summary=watchdog_summary,
        extra_artifacts=extra_artifacts,
    )
