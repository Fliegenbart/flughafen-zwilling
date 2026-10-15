"""Bounded, stateless public simulation for the Airport Energy Check sample project."""

from __future__ import annotations

import hashlib
import json
import os
import random
from datetime import date
from threading import Lock
from time import perf_counter
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models import ModelPack, RunRequest, RunStatus, ScenarioDefinition
from ..munich.coupled_models import (
    COUPLED_DOMAIN,
    ENGINE_VERSION,
    CoupledConfig,
    CoupledPolicy,
    FleetKind,
    PowerConfig,
)
from ..munich.coupled_simulator import simulate_coupled
from ..munich.coupled_world import build_world
from ..munich.flightplan import parse_pages
from ..run_service import RunService
from .live import basis_from_series, departures_by_half_hour, preview_kpis
from .variants import DEFAULT_POLICY, DEFAULT_SEED, VariantChanges, apply_changes

DEMO_DAY_SEED = 7
DEMO_GRID_DEFAULT_KW = 3500
DEMO_MAX_EXTRA_VEHICLES = 60
DEMO_WAIT_SECONDS = 2.0
DEMO_RUN_QUEUE_LIMIT = 10
_SIMULATION_LOCK = Lock()
_MATERIALIZATION_LOCK = Lock()

_HEADER = """Flugplan Muenchen
L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename
Datenstand: 02.10.2026
Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag
"""


def _canonical_hash(payload: object) -> str:
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode()).hexdigest()


def _airport_code(number: int) -> str:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return (letters[number // 676 % 26] + letters[number // 26 % 26] + letters[number % 26])


def _busy_day():
    """The fixed Seed-7 busy day used by the live-power reference generator."""
    rng = random.Random(DEMO_DAY_SEED)
    rows: list[str] = []
    waves = ((6 * 60, 75, 120), (11 * 60 + 30, 60, 80), (17 * 60, 70, 110))
    number = 0
    for center, spread, count in waves:
        for _ in range(count):
            departure = int(rng.gauss(center, spread / 2))
            departure = max(5 * 60, min(23 * 60, departure))
            arrival = departure - rng.choice((45, 50, 55, 60, 70))
            number += 1
            rows.append(
                f"S XY {1000 + number} {arrival // 60:02d}:{arrival % 60:02d} "
                f"{departure // 60:02d}:{departure % 60:02d} 1234567 "
                f"{_airport_code(number)} 03.10.26 27.03.27 1 Test Air"
            )
    return parse_pages([_HEADER + "\n".join(rows)], date(2026, 10, 3), "b" * 64)


class DemoSimulationRequest(BaseModel):
    """Only public-demo levers; this endpoint never accepts a flightplan or a seed."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    grid_import_limit_kw: float = Field(default=DEMO_GRID_DEFAULT_KW, ge=1500, le=8000)
    storage_kwh: float = Field(default=0, ge=0, le=6000)
    storage_kw: float | None = Field(default=None, gt=0, le=20000)
    pv_factor: float = Field(default=1, ge=0, le=3)
    extra_vehicles: dict[FleetKind, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_storage_and_fleet(self) -> DemoSimulationRequest:
        if self.storage_kwh == 0 and self.storage_kw is not None:
            raise ValueError("Speicherleistung benoetigt Speicherkapazitaet")
        if (self.storage_kwh > 0 and self.storage_kw is not None
                and not self.storage_kwh * 0.1 <= self.storage_kw <= self.storage_kwh * 4):
            raise ValueError("Speicherleistung ausserhalb 0,1C bis 4C der Kapazitaet")
        if any(count < 1 for count in self.extra_vehicles.values()):
            raise ValueError("Zusaetzliche Fahrzeuge muessen positiv sein")
        if sum(self.extra_vehicles.values()) > DEMO_MAX_EXTRA_VEHICLES:
            raise ValueError(f"Maximal {DEMO_MAX_EXTRA_VEHICLES} zusaetzliche Fahrzeuge")
        return self

    def changes(self) -> dict[str, Any]:
        changes: dict[str, Any] = {}
        if self.grid_import_limit_kw != DEMO_GRID_DEFAULT_KW:
            changes["grid_import_limit_kw"] = self.grid_import_limit_kw
        if self.storage_kwh > 0:
            changes["storage_kwh"] = self.storage_kwh
            if self.storage_kw is not None:
                changes["storage_kw"] = self.storage_kw
        if self.pv_factor != 1:
            changes["pv_factor"] = self.pv_factor
        if self.extra_vehicles:
            changes["extra_vehicles"] = dict(sorted(self.extra_vehicles.items()))
        return changes


def _base_config() -> CoupledConfig:
    return CoupledConfig(power=PowerConfig(grid_import_limit_kw=DEMO_GRID_DEFAULT_KW))


def _prepare_demo(request: DemoSimulationRequest):
    """Build the complete deterministic input contract shared by preview and persisted runs."""
    plan = _busy_day()
    base_config = _base_config()
    base_policy: CoupledPolicy = DEFAULT_POLICY
    base_world = build_world(plan, base_config, DEFAULT_SEED)
    changes = request.changes()
    if changes:
        config, policy, _ = apply_changes(base_config, base_policy,
                                           VariantChanges.model_validate(changes),
                                           base_world.day_minutes)
        world = build_world(plan, config, DEFAULT_SEED)
    else:
        config, policy, world = base_config, base_policy, base_world
    return plan, config, policy, world, changes


def simulate_demo(request: DemoSimulationRequest) -> dict:
    """Run one bounded synthetic day without storage, adapters, or project state."""
    if not _SIMULATION_LOCK.acquire(timeout=DEMO_WAIT_SECONDS):
        raise HTTPException(
            status_code=429, detail="Demo-Auslastung erreicht. Bitte erneut versuchen.",
        )
    try:
        started = perf_counter()
        plan, config, policy, world, changes = _prepare_demo(request)
        result = simulate_coupled(world, plan, policy)
        elapsed = perf_counter() - started
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid_demo_input: {exc}") from exc
    finally:
        _SIMULATION_LOCK.release()

    departures, delayed = departures_by_half_hour(result)
    config_payload = config.model_dump(mode="json")
    config_hash = _canonical_hash(config_payload)
    input_hash = _canonical_hash({
        "engine_version": ENGINE_VERSION,
        "build_commit": os.environ.get("TWIN_BUILD_GIT_COMMIT", "local-unversioned"),
        "scenario": {"kind": "synthetic_busy_day", "seed": DEMO_DAY_SEED,
                     "source_plan_sha256": plan.content_sha256},
        "simulation_seed": world.seed,
        "policy": policy,
        "config": config_payload,
        "world_hash": world.world_hash,
    })
    return {
        **basis_from_series(result.series, config, day_minutes=world.day_minutes,
                            start_min=world.start_min, day_start_utc=world.day_start_utc,
                            policy=policy, run_id=None),
        "preview": True,
        "evidence_level": "synthetic_uncalibrated",
        "changes": changes,
        "base_source": "synthetic_busy_day_seed_7",
        "departures": departures,
        "kpis": preview_kpis(result, departures, delayed),
        "coupled_kpis": result.kpis.model_dump(mode="json"),
        "energy_kpis": result.energy.model_dump(mode="json"),
        "calculation_id": input_hash,
        "input_hash": input_hash,
        "engine_version": world.engine_version,
        "world_hash": world.world_hash,
        "warnings": [
            "synthetic_uncalibrated",
            "Fester synthetischer Verkehrstag; keine MUC-Quelle, Live-Daten oder Betriebsprognose.",
            *world.warnings,
        ],
        "metadata": {
            "stateless": True,
            "build_commit": os.environ.get("TWIN_BUILD_GIT_COMMIT", "local-unversioned"),
            "engine_version": world.engine_version,
            "input_hash": input_hash,
            "config_hash": config_hash,
            "world_hash": world.world_hash,
            "config": config_payload,
            "scenario": {"kind": "synthetic_busy_day", "seed": DEMO_DAY_SEED,
                         "entry_count": len(plan.rows), "source_plan_sha256": plan.content_sha256},
            "simulation_seed": world.seed,
            "policy": policy,
        },
        "compute_ms": round(elapsed * 1000),
    }


def materialize_demo_run(
    request: DemoSimulationRequest, service: RunService, enqueue: Callable[[str], None],
    *, prepared: tuple | None = None,
) -> RunStatus:
    """Persist one frozen synthetic SIL run without creating a project or adapter binding."""
    with _MATERIALIZATION_LOCK:
        pending = [run for run in service.list_runs() if run.state.value in {"queued", "running"}]
        if len(pending) >= DEMO_RUN_QUEUE_LIMIT:
            raise HTTPException(status_code=429, detail="Run-Queue voll. Runs abwarten.")
        try:
            plan, config, policy, world, changes = prepared or _prepare_demo(request)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"invalid_demo_input: {exc}") from exc
        materialization_id = uuid4().hex
        scenario_id = f"demo_simulation_{materialization_id}_v1"
        model_id = f"demo_simulation_model_{materialization_id}_v1"
        input_hash = _canonical_hash({
            "engine_version": world.engine_version,
            "source_plan_sha256": plan.content_sha256,
            "world_hash": world.world_hash,
            "config": config.model_dump(mode="json"),
            "policy": policy,
            "seed": world.seed,
        })
        service.create_scenario(ScenarioDefinition(
            id=scenario_id,
            version="1",
            domain=COUPLED_DOMAIN,
            description="Fester synthetischer Demo-Tag, unkalibriert, nur SIL.",
            duration_ms=(world.end_min - world.start_min) * 60000,
            tick_ms=60000,
            metadata={
                "demo_synthetic": True,
                "input_hash": input_hash,
                "world_hash": world.world_hash,
                "changes": changes,
            },
        ))
        service.create_model_pack(ModelPack(
            id=model_id,
            site_profile="munich_coupled_reference_v1",
            parameter_set={"policy": policy},
            calibration_meta={
                "calibrated": False,
                "engine_version": world.engine_version,
                "coupled_world": world.model_dump(mode="json"),
                "flight_plan_snapshot": plan.model_dump(mode="json"),
                "flight_plan_usage": "drives_explicit_hypothetical_missions",
                "all_operational_parameters": "synthetic_assumptions",
                "compatibility_fields": "frequency_voltage_blackout_switching_not_modelled",
                "demo_synthetic": True,
                "demo_input_hash": input_hash,
                "demo_day_seed": DEMO_DAY_SEED,
            },
        ))
        try:
            status = service.queue_run(RunRequest(
                scenario_id=scenario_id,
                model_pack_id=model_id,
                seed=world.seed,
                realtime_mode="sil",
                adapters=[],
                hardware_meta={
                    "generated_by": "demo_simulation_materialization",
                    "demo_synthetic": True,
                    "input_hash": input_hash,
                    "world_hash": world.world_hash,
                    "no_hardware_control": True,
                },
            ))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"invalid_demo_run: {exc}") from exc
        enqueue(status.run_id)
        return status
