from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from ..models import ModelPack, RunRequest, RunStatus, ScenarioDefinition
from ..run_service import RunService
from .flightplan_router import load_snapshot
from .flightplan_store import FlightPlanStore
from .models import MunichAssumptions, MunichCompareRequest
from .simulator import generate_sessions, simulate


def read_reference() -> dict:
    root = Path(os.environ.get(
        "TWIN_REFERENCE_DIR", str(Path(__file__).resolve().parents[3] / "data" / "references"),
    ))
    return json.loads((root / "munich_public_facts_v1.json").read_text(encoding="utf-8"))


def create_router(
    service: RunService, enqueue: Callable[[str], None], plans: FlightPlanStore,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/munich", tags=["Muenchen-Referenzpilot (synthetisch)"])
    creation_lock = Lock()

    @router.get("/reference")
    def reference() -> dict:
        return {
            "dossier": read_reference(), "defaults": MunichAssumptions().model_dump(),
            "engine_version": "munich_energy_v1", "evidence_level": "synthetic_uncalibrated",
            "model_hours": 24, "step_minutes": 5, "recommendation_only": True,
            "policies": ["uncontrolled", "bus_priority"],
        }

    @router.post("/comparisons", status_code=202)
    def compare(payload: MunichCompareRequest) -> dict:
        with creation_lock:
            plan = (load_snapshot(plans, payload.flight_plan_snapshot_id)
                    if payload.flight_plan_snapshot_id else None)
            # Avoid an unbounded local backlog. Recovery still uses the ordinary RunWorker.
            pending = [r for r in service.list_runs() if r.state.value in {"queued", "running"}]
            if len(pending) + 2 > 10:
                raise HTTPException(
                    status_code=429, detail="Run-Queue voll. Laufende Runs abwarten.",
                )
            comparison_id = uuid4().hex
            config = payload.assumptions
            sessions = generate_sessions(config, payload.seed)
            world_hash = simulate(
                config, payload.seed, "uncontrolled", sessions=sessions,
            ).world_hash
            dossier = read_reference()
            statuses: list[RunStatus] = []
            for policy in ["uncontrolled", "bus_priority"]:
                scenario_id = f"munich_{comparison_id}_{policy}_v1"
                model_id = f"munich_model_{comparison_id}_{policy}_v1"
                scenario = ScenarioDefinition(
                    id=scenario_id, version="1", domain="airport_energy_v1",
                    description="Muenchen-Pilot: synthetische Auftraege, keine FMG-Betriebsdaten",
                    duration_ms=86400000, tick_ms=300000,
                    metadata={"comparison_id": comparison_id, "policy": policy,
                              "evidence_level": "synthetic_uncalibrated"},
                )
                model = ModelPack(
                    id=model_id, site_profile="munich_public_reference_v1",
                    parameter_set={"policy": policy},
                    calibration_meta={
                        "calibrated": False, "munich_assumptions": config.model_dump(),
                        "munich_sessions": [s.model_dump() for s in sessions],
                        "world_hash": world_hash, "reference_dossier": dossier,
                        "engine_version": "munich_energy_v1",
                        "all_operational_parameters": "synthetic_assumptions",
                        "compatibility_fields": "frequency_voltage_blackout_switching_not_modelled",
                        **({
                            "flight_plan_snapshot": plan.model_dump(mode="json"),
                            "flight_plan_usage": "context_only_not_driving_energy",
                        } if plan else {}),
                    },
                )
                service.create_scenario(scenario)
                service.create_model_pack(model)
                statuses.append(service.queue_run(RunRequest(
                    scenario_id=scenario_id, model_pack_id=model_id, seed=payload.seed,
                    realtime_mode="sil", adapters=[],
                    hardware_meta={"generated_by": "munich_reference_compare",
                                   "comparison_id": comparison_id, "policy": policy,
                                   "no_hardware_control": True},
                )))
            for status in statuses:
                enqueue(status.run_id)
            return {"comparison_id": comparison_id, "world_hash": world_hash,
                    "flight_plan_snapshot_id": plan.snapshot_id if plan else None,
                    "runs": [status.model_dump(mode="json") for status in statuses]}

    return router
