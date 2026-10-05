from __future__ import annotations

from threading import Lock
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from ..models import ModelPack, RunRequest, ScenarioDefinition
from ..run_service import RunService
from .coupled_models import COUPLED_DOMAIN, ENGINE_VERSION, CoupledConfig, CoupledRequest
from .coupled_world import build_world
from .flightplan_router import load_snapshot
from .flightplan_store import FlightPlanStore
from .router import read_reference


def create_router(
    service: RunService, enqueue: Callable[[str], None], plans: FlightPlanStore,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/munich", tags=["Flugplan-Fahrzeuge-Energie (SIL)"])
    creation_lock = Lock()

    @router.get("/coupled-reference")
    def reference() -> dict:
        return {"defaults": CoupledConfig().model_dump(mode="json"),
                "engine_version": ENGINE_VERSION, "recommendation_only": True,
                "evidence_level": "schedule_driven_assumptions_uncalibrated",
                "policies": ["uncontrolled", "mission_priority"], "step_minutes": 1}

    @router.post("/coupled-comparisons", status_code=202)
    def compare(payload: CoupledRequest) -> dict:
        with creation_lock:
            plan = load_snapshot(plans, payload.flight_plan_snapshot_id)
            pending = [r for r in service.list_runs() if r.state.value in {"queued", "running"}]
            if len(pending) + 2 > 10:
                raise HTTPException(status_code=429, detail="Run-Queue voll. Runs abwarten.")
            try:
                world = build_world(plan, payload.config, payload.seed)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            comparison_id = uuid4().hex
            dossier = read_reference()
            statuses = []
            for policy in ["uncontrolled", "mission_priority"]:
                scenario_id = f"coupled_{comparison_id}_{policy}_v1"
                model_id = f"coupled_model_{comparison_id}_{policy}_v1"
                service.create_scenario(ScenarioDefinition(
                    id=scenario_id, version="1", domain=COUPLED_DOMAIN,
                    description="Flugplanbasierte Aufgaben-/Energie-Kopplung, unkalibriert",
                    duration_ms=(world.end_min - world.start_min) * 60000, tick_ms=60000,
                    metadata={"comparison_id": comparison_id, "policy": policy},
                ))
                service.create_model_pack(ModelPack(
                    id=model_id, site_profile="munich_coupled_reference_v1",
                    parameter_set={"policy": policy}, calibration_meta={
                        "calibrated": False, "engine_version": ENGINE_VERSION,
                        "coupled_world": world.model_dump(mode="json"),
                        "flight_plan_snapshot": plan.model_dump(mode="json"),
                        "flight_plan_usage": "drives_explicit_hypothetical_missions",
                        "reference_dossier": dossier,
                        "all_operational_parameters": "synthetic_assumptions",
                        "compatibility_fields": "frequency_voltage_blackout_switching_not_modelled",
                    },
                ))
                statuses.append(service.queue_run(RunRequest(
                    scenario_id=scenario_id, model_pack_id=model_id, seed=payload.seed,
                    realtime_mode="sil", adapters=[], hardware_meta={
                        "generated_by": "munich_coupled_compare", "comparison_id": comparison_id,
                        "policy": policy, "no_hardware_control": True,
                    },
                )))
            for status in statuses:
                enqueue(status.run_id)
            return {"comparison_id": comparison_id, "world_hash": world.world_hash,
                    "flight_plan_snapshot_id": plan.snapshot_id, "engine_version": ENGINE_VERSION,
                    "runs": [s.model_dump(mode="json") for s in statuses]}

    return router
