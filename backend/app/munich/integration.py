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
from .models import ChargingSession, MunichAssumptions
from .simulator import simulate


def validate_energy_inputs(
    scenario: ScenarioDefinition, model: ModelPack, request: RunRequest,
) -> None:
    if model.site_profile != "munich_public_reference_v1":
        raise ValueError("Energiepilot benoetigt das Muenchen-Referenzprofil")
    if request.realtime_mode != "sil" or request.adapters:
        raise ValueError("Muenchen-Energiepilot ist ausschliesslich SIL ohne Adapter")
    if scenario.duration_ms != 86400000 or scenario.tick_ms != 300000:
        raise ValueError("Energiepilot benoetigt 24 Modellstunden und 5-Minuten-Schritte")
    if scenario.disturbances or scenario.timeline_events:
        raise ValueError("Energiepilot v1 akzeptiert nur die dokumentierten festen Annahmen")
    assumptions = model.calibration_meta.get("munich_assumptions")
    if not isinstance(assumptions, dict) or set(assumptions) != set(MunichAssumptions.model_fields):
        raise ValueError("Vollstaendige, explizite Betriebsannahmen fehlen")
    if model.calibration_meta.get("calibrated") is not False:
        raise ValueError("Energiepilot ist unkalibriert; Metadaten widersprechen dem Modell")
    MunichAssumptions.model_validate(assumptions)
    sessions = model.calibration_meta.get("munich_sessions")
    if not isinstance(sessions, list) or len(sessions) > 325:
        raise ValueError("Eingefrorene Ladeauftraege fehlen oder sind zu umfangreich")
    parsed = [ChargingSession.model_validate(s) for s in sessions]
    if len({s.id for s in parsed}) != len(parsed):
        raise ValueError("Doppelte Ladeauftrag-ID")
    if model.parameter_set.get("policy") not in {"uncontrolled", "bus_priority"}:
        raise ValueError("Unbekannte Laderegel")


def run_energy_simulation(
    run_id: str, scenario: ScenarioDefinition, model_pack: ModelPack, seed: int,
    realtime_mode: str, adapters: list,
    telemetry_callback: Callable[[TelemetrySample], None] | None = None,
) -> tuple[RunSummary, SafetySummary]:
    validate_energy_inputs(scenario, model_pack, RunRequest(
        scenario_id=scenario.id, model_pack_id=model_pack.id, realtime_mode=realtime_mode,
        adapters=adapters,
    ))
    config = MunichAssumptions.model_validate(model_pack.calibration_meta["munich_assumptions"])
    sessions = [ChargingSession.model_validate(s)
                for s in model_pack.calibration_meta["munich_sessions"]]
    result = simulate(config, seed, model_pack.parameter_set["policy"], sessions=sessions)
    expected_hash = model_pack.calibration_meta.get("world_hash")
    if expected_hash and expected_hash != result.world_hash:
        raise ValueError("Welt-Hash stimmt nicht mit eingefrorenen Eingaben ueberein")
    digest = hashlib.sha256()
    for row in result.series:
        for metric, value in row.items():
            if metric == "minute":
                continue
            sample = TelemetrySample(
                ts=int(row["minute"] * 60000), source="munich_synthetic",
                asset_id="campus_balance", metric=metric, value=value,
                # 'good' refers only to a computed sample, never to measured data quality.
                quality="good", unit="%" if metric.endswith("pct") else "kW", run_id=run_id,
            )
            digest.update(json.dumps(sample.model_dump(), sort_keys=True).encode())
            if telemetry_callback:
                telemetry_callback(sample)
    summary = RunSummary(
        domain="airport_energy_v1", energy_kpis=result.kpis, energy_sessions=result.evidence,
        energy_world_hash=result.world_hash, telemetry_hash=digest.hexdigest(),
        # Shape-only compatibility fields; no frequency, voltage or switching model exists here.
        freq_nadir_hz=0, volt_nadir_v=0, blackout_ms=0, switch_time_ms=0,
        final_soc_pct=(result.kpis.battery_final_kwh / config.battery_capacity_kwh * 100
                       if config.battery_capacity_kwh else 0),
        io_latency_p99_ms=0, tick_target_ms=300000,
    )
    return summary, SafetySummary(fail_reason="not_applicable_synthetic_energy_model_no_hardware")
