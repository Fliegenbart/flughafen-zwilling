from __future__ import annotations

import hashlib
import json
from typing import Callable

from ..models import (
    ModelPack,
    RunRequest,
    RunSummary,
    SafetySummary,
    ScenarioDefinition,
    TelemetrySample,
)
from .coupled_evidence import build_artifacts
from .coupled_models import COUPLED_DOMAIN, ENGINE_VERSION, LEGACY_ENGINE_VERSIONS, CoupledWorld
from .coupled_simulator import simulate_coupled
from .coupled_world import verify_world
from .flightplan import FlightPlanSnapshot


def validate_coupled_inputs(
    scenario: ScenarioDefinition, model: ModelPack, request: RunRequest,
) -> tuple[CoupledWorld, FlightPlanSnapshot]:
    if model.site_profile != "munich_coupled_reference_v1":
        raise ValueError("Kopplung benoetigt ein eigenes eingefrorenes Muenchen-Profil")
    if request.realtime_mode != "sil" or request.adapters:
        raise ValueError("Gekoppelter Pilot ist ausschliesslich SIL ohne Adapter")
    meta = model.calibration_meta
    if meta.get("engine_version") in LEGACY_ENGINE_VERSIONS:
        raise ValueError(
            f"Lauf wurde mit aelterer Engine {meta['engine_version']} eingefroren; "
            f"aktuelle Engine {ENGINE_VERSION} rechnet anders. Neuen Vergleich erzeugen.",
        )
    if meta.get("calibrated") is not False or meta.get("engine_version") != ENGINE_VERSION:
        raise ValueError("Engine/Unkalibriert-Metadaten widersprechen dem Kopplungsmodell")
    if meta.get("flight_plan_usage") != "drives_explicit_hypothetical_missions":
        raise ValueError("Flugplanverwendung nicht als explizite Auftragsannahme gekennzeichnet")
    world = CoupledWorld.model_validate(meta.get("coupled_world"))
    plan = FlightPlanSnapshot.model_validate(meta.get("flight_plan_snapshot"))
    verify_world(world, plan)
    if world.engine_version != ENGINE_VERSION:
        raise ValueError("Welt-Engine passt nicht zur aktuellen Kopplungs-Engine")
    if request.seed != world.seed:
        raise ValueError("Seed passt nicht zur eingefrorenen Welt; neuen Vergleich erzeugen")
    if (scenario.duration_ms != (world.end_min - world.start_min) * 60000
            or scenario.tick_ms != 60000):
        raise ValueError("Kopplung benoetigt eingefrorenen Horizont und 1-Minuten-Schritte")
    if scenario.disturbances or scenario.timeline_events:
        raise ValueError("Kopplungsstoerungen ausschliesslich in der eingefrorenen Welt definieren")
    if model.parameter_set.get("policy") not in {"uncontrolled", "mission_priority"}:
        raise ValueError("Unbekannte Laderegel")
    return world, plan


def run_coupled_simulation(
    run_id: str, scenario: ScenarioDefinition, model_pack: ModelPack, seed: int,
    realtime_mode: str, adapters: list,
    telemetry_callback: Callable[[TelemetrySample], None] | None = None,
) -> tuple[RunSummary, SafetySummary, dict[str, str]]:
    world, plan = validate_coupled_inputs(scenario, model_pack, RunRequest(
        scenario_id=scenario.id, model_pack_id=model_pack.id, seed=seed,
        realtime_mode=realtime_mode, adapters=adapters,
    ))
    policy = model_pack.parameter_set["policy"]
    result = simulate_coupled(world, plan, policy)
    digest = hashlib.sha256()
    for row in result.series:
        for metric, value in row.items():
            if metric == "minute":
                continue
            unit = "%" if metric.endswith("pct") else "count" if (
                metric.endswith("count") or metric == "mission_queue"
            ) else "kW"
            sample = TelemetrySample(
                ts=int((row["minute"] - world.start_min) * 60000), source="munich_coupled_model",
                asset_id="campus_fleet_balance", metric=metric, value=value,
                quality="good", unit=unit, run_id=run_id,
            )
            digest.update(json.dumps(sample.model_dump(), sort_keys=True).encode())
            if telemetry_callback:
                telemetry_callback(sample)
    summary = RunSummary(
        domain=COUPLED_DOMAIN, coupled_kpis=result.kpis, energy_kpis=result.energy,
        energy_world_hash=world.world_hash, telemetry_hash=digest.hexdigest(),
        freq_nadir_hz=0, volt_nadir_v=0, blackout_ms=0, switch_time_ms=0,
        final_soc_pct=(result.energy.battery_final_kwh / world.config.power.battery_capacity_kwh
                       * 100 if world.config.power.battery_capacity_kwh else 0),
        io_latency_p99_ms=0, tick_target_ms=60000,
    )
    return (summary, SafetySummary(fail_reason="not_applicable_synthetic_model_no_hardware"),
            build_artifacts(result, world, plan, policy))
