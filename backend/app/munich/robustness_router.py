"""Bounded, deterministic stress screens for the schedule-coupled SIL prototype."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..models import ModelPack, RunRequest, RunState, ScenarioDefinition
from ..run_service import RunService
from .coupled_models import (
    COUPLED_DOMAIN,
    ENGINE_VERSION,
    CoupledConfig,
    CoupledRequest,
    StressEvent,
)
from .coupled_world import CoupledWorld, build_world
from .flightplan import FlightPlanSnapshot
from .flightplan_router import load_snapshot
from .flightplan_store import FlightPlanStore
from .router import read_reference

SUITE_SCHEMA = "munich_robustness_suite_v1"
SUITE_ID = re.compile(r"^[a-f0-9]{32}$")
POLICIES = ("uncontrolled", "mission_priority")
SUMMARY_METRICS = (
    "departure_readiness_pct",
    "grid_peak_kw",
    "charging_unmet_kwh",
    "background_unserved_kwh",
    "energy_wait_total_min",
    "resource_wait_total_min",
)
DELTA_EPS = 1e-9
ROBUSTNESS_VARIANTS = (
    ("baseline", "Basis"),
    ("grid_import_minus_20_pct", "Netzimport -20 %"),
    ("one_bus_charger_offline", "Ein Bus-Ladepunkt ausgefallen"),
    ("pv_peak_factor_minus_50_pct", "PV-Profilfaktor -50 %"),
)
# Stress-Screen Schlepperzahl x Netzimport; seriell, deterministisch, keine Optimierung.
SENSITIVITY_TUGS = (10, 15, 20)
SENSITIVITY_GRID_KW = (1000, 2000, 3500)
SENSITIVITY_VARIANTS = tuple(
    (f"tugs_{tugs}_grid_{grid}", f"{tugs} Schlepper / Netzimport {grid} kW")
    for tugs in SENSITIVITY_TUGS for grid in SENSITIVITY_GRID_KW
)
SENSITIVITY_POLICIES = ("mission_priority",)
Screen = Literal["robustness", "sensitivity"]


def _mission_signature(world: CoupledWorld) -> str:
    """Hash demand-defining mission fields, independently of power stress."""
    payload = [mission.model_dump(mode="json") for mission in world.missions]
    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
    ).hexdigest()


def _variant_config(
    base: CoupledConfig, key: str, day_minutes: int
) -> tuple[CoupledConfig, dict[str, Any]]:
    values = base.model_dump(mode="json")
    if key == "baseline":
        return CoupledConfig.model_validate(values), {}
    if key == "grid_import_minus_20_pct":
        limit = base.power.grid_import_limit_kw
        if limit <= 0:
            raise ValueError("Grid-20%-Variante benoetigt eine positive Netzimportgrenze")
        adjusted = limit * 0.8
        values["power"]["grid_import_limit_kw"] = adjusted
        return CoupledConfig.model_validate(values), {"power.grid_import_limit_kw": adjusted}
    if key == "one_bus_charger_offline":
        bus = next((fleet for fleet in base.fleets if fleet.kind == "bus"), None)
        if bus is None or bus.chargers < 1:
            raise ValueError(
                "Ladepunkt-Ausfall benoetigt mindestens einen modellierten Bus-Ladepunkt"
            )
        outage = StressEvent(
            start_min=0,
            end_min=day_minutes,
            fleet_kind="bus",
            offline_chargers=1,
        )
        varied_event = outage.model_dump(mode="json", exclude_none=True)
        values["stress_events"].append(varied_event)
        return CoupledConfig.model_validate(values), {
            "stress_events.append": varied_event,
        }
    if key.startswith("tugs_"):
        _, tugs, _, grid = key.split("_")
        fleet = next((f for f in values["fleets"] if f["kind"] == "pushback_tug"), None)
        if fleet is None:
            raise ValueError("Sensitivitaets-Screen benoetigt eine modellierte Pushback-Flotte")
        fleet["vehicles"] = int(tugs)
        fleet["chargers"] = min(fleet["chargers"], int(tugs))
        values["power"]["grid_import_limit_kw"] = float(grid)
        return CoupledConfig.model_validate(values), {
            "fleets.pushback_tug.vehicles": int(tugs),
            "fleets.pushback_tug.chargers": fleet["chargers"],
            "power.grid_import_limit_kw": float(grid),
        }
    if key == "pv_peak_factor_minus_50_pct":
        factor = base.power.pv_peak_factor
        if factor <= 0:
            raise ValueError("PV-50%-Variante benoetigt einen positiven PV-Profilfaktor")
        adjusted = factor * 0.5
        values["power"]["pv_peak_factor"] = adjusted
        return CoupledConfig.model_validate(values), {"power.pv_peak_factor": adjusted}
    raise ValueError("Unbekannte Robustness-Variante")


def _build_variants(
    plan: FlightPlanSnapshot, payload: CoupledRequest, screen: Screen = "robustness",
) -> list[dict[str, Any]]:
    baseline = build_world(plan, payload.config, payload.seed)
    signature = _mission_signature(baseline)
    variants = []
    for key, label in (ROBUSTNESS_VARIANTS if screen == "robustness" else SENSITIVITY_VARIANTS):
        config, varied = _variant_config(payload.config, key, baseline.day_minutes)
        world = baseline if key == "baseline" else build_world(plan, config, payload.seed)
        invariant = (
            world.source_plan_sha256 == baseline.source_plan_sha256
            and world.seed == baseline.seed
            and _mission_signature(world) == signature
        )
        if not invariant:
            raise RuntimeError(
                "Robustness-Variante hat die eingefrorene Missionsnachfrage veraendert"
            )
        variants.append(
            {
                "key": key,
                "label": label,
                "config": config,
                "world": world,
                "varied_parameters": varied,
                "mission_signature": signature,
                "demand_invariant": True,
            }
        )
    return variants


def _suite_dir(service: RunService) -> Path:
    path = service.storage.base_dir / "munich" / "robustness_suites"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _suite_path(service: RunService, suite_id: str) -> Path:
    if not SUITE_ID.fullmatch(suite_id):
        raise HTTPException(status_code=404, detail="Robustness-Suite nicht gefunden")
    return _suite_dir(service) / f"{suite_id}.json"


def _write_suite(path: Path, suite: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(suite, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _load_suite(service: RunService, suite_id: str) -> dict[str, Any]:
    path = _suite_path(service, suite_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Robustness-Suite nicht gefunden")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(
            status_code=500, detail="Robustness-Suite kann nicht gelesen werden"
        ) from exc
    if result.get("schema") != SUITE_SCHEMA or result.get("suite_id") != suite_id:
        raise HTTPException(status_code=500, detail="Robustness-Suite-Metadaten sind ungueltig")
    return result


def _completed_summary(record: Any) -> dict[str, float | None] | None:
    summary = record.summary
    if record.status.state != RunState.completed or summary is None:
        return None
    if (
        summary.domain != COUPLED_DOMAIN
        or summary.energy_kpis is None
        or summary.coupled_kpis is None
    ):
        return None
    return {
        "departure_readiness_pct": summary.coupled_kpis.departure_readiness_pct,
        "grid_peak_kw": summary.energy_kpis.grid_peak_kw,
        "charging_unmet_kwh": summary.energy_kpis.charging_unmet_kwh,
        "background_unserved_kwh": summary.energy_kpis.background_unserved_kwh,
        "energy_wait_total_min": summary.coupled_kpis.energy_wait_total_min,
        "resource_wait_total_min": summary.coupled_kpis.resource_wait_total_min,
        "energy_wait_share_pct": summary.coupled_kpis.energy_wait_share_pct,
        "bottleneck": summary.coupled_kpis.bottleneck,
    }


def _compatible(record: Any, baseline: Any, suite: dict[str, Any], policy: str) -> bool:
    if record.status.state != RunState.completed or baseline.status.state != RunState.completed:
        return False
    candidate = record.model_pack_snapshot
    base = baseline.model_pack_snapshot
    if candidate is None or base is None:
        return False
    candidate_meta = candidate.calibration_meta
    base_meta = base.calibration_meta
    candidate_suite = candidate_meta.get("robustness_suite", {})
    base_suite = base_meta.get("robustness_suite", {})
    return (
        record.request.seed == baseline.request.seed == suite["seed"]
        and candidate.parameter_set.get("policy") == base.parameter_set.get("policy") == policy
        and candidate_suite.get("suite_id") == base_suite.get("suite_id") == suite["suite_id"]
        and candidate_suite.get("mission_signature") == base_suite.get("mission_signature")
        and candidate_meta.get("flight_plan_snapshot", {}).get("content_sha256")
        == base_meta.get("flight_plan_snapshot", {}).get("content_sha256")
        == suite["source_plan_sha256"]
    )


def _delta(
    summary: dict[str, float | None], baseline: dict[str, float | None]
) -> dict[str, float | None]:
    def difference(a: float, b: float) -> float:
        value = a - b
        # Rundungsrauschen (z.B. Summationsreihenfolge) nicht als Effekt ausweisen.
        return 0.0 if abs(value) < DELTA_EPS else value

    return {
        metric: (
            None
            if summary.get(metric) is None or baseline.get(metric) is None
            else difference(summary[metric], baseline[metric])
        )
        for metric in SUMMARY_METRICS
    }


def _integrity_verified(service: RunService, record: Any, cache: dict[str, bool]) -> bool:
    """A completed run cannot support a comparison after its evidence changes."""
    if record.status.state != RunState.completed:
        return False
    run_id = record.status.run_id
    if run_id in cache:
        return cache[run_id]
    audit = service.get_run_safety(run_id).audit
    cache[run_id] = (
        audit.get("fingerprint_match") is True
        and audit.get("artifact_hashes_match") is True
        and audit.get("report_consistent_match") is True
        and audit.get("result_audit_scope")
        in {
            "data_and_reports_v2",
            "data_and_report_consistency_v1",
        }
    )
    return cache[run_id]


def _render_suite(
    service: RunService, suite: dict[str, Any], *, initial: bool = False
) -> dict[str, Any]:
    records: dict[str, Any] = {}
    integrity: dict[str, bool] = {}
    rendered_scenarios = []
    for variant in suite["scenarios"]:
        runs = []
        for item in variant["runs"]:
            status = service.get_run_status(item["run_id"])
            runs.append(
                {
                    "policy": item["policy"],
                    "run_id": item["run_id"],
                    "status": status.model_dump(mode="json"),
                    "integrity_verified": False,
                    "completed_summary": None,
                    "delta_to_baseline": None,
                }
            )
        rendered_scenarios.append(
            {
                "key": variant["key"],
                "label": variant["label"],
                "varied_parameters": variant["varied_parameters"],
                "demand_invariant": variant["demand_invariant"],
                "mission_signature": variant["mission_signature"],
                "runs": runs,
            }
        )
    if not initial:

        def record_for(run_id: str) -> Any:
            if run_id not in records:
                records[run_id] = service.get_run_record(run_id)
            return records[run_id]

        baseline_by_policy = {
            run["policy"]: record_for(run["run_id"])
            for scenario in rendered_scenarios
            if scenario["key"] == "baseline"
            for run in scenario["runs"]
        }
        for scenario in rendered_scenarios:
            for run in scenario["runs"]:
                record = record_for(run["run_id"])
                verified = _integrity_verified(service, record, integrity)
                run["integrity_verified"] = verified
                summary = _completed_summary(record) if verified else None
                run["completed_summary"] = summary
                baseline = baseline_by_policy.get(run["policy"])
                if (
                    scenario["key"] != "baseline"
                    and summary
                    and baseline
                    and _compatible(
                        record,
                        baseline,
                        suite,
                        run["policy"],
                    )
                    and _integrity_verified(service, baseline, integrity)
                ):
                    baseline_summary = _completed_summary(baseline)
                    if baseline_summary is not None:
                        run["delta_to_baseline"] = _delta(summary, baseline_summary)
    return {
        "suite_id": suite["suite_id"],
        # Gespeicherte Suiten behalten ihre Engine-Version (aeltere Laeufe bleiben erkennbar).
        "engine_version": suite.get("engine_version", "airport_coupled_v1"),
        "seed": suite["seed"],
        "flight_plan_snapshot_id": suite["flight_plan_snapshot_id"],
        "source_plan_sha256": suite["source_plan_sha256"],
        "scenarios": rendered_scenarios,
        "runs": [run for scenario in rendered_scenarios for run in scenario["runs"]],
        "screen": suite.get("screen", "robustness"),
        "statistical_confidence": "not_provided_deterministic_stress_screen_only",
    }


def create_router(
    service: RunService,
    enqueue: Callable[[str], None],
    plans: FlightPlanStore,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/munich", tags=["Flugplan-Fahrzeuge-Energie (SIL)"])
    creation_lock = Lock()

    @router.post("/robustness-suites", status_code=202)
    def create_suite(
        payload: CoupledRequest, screen: Screen = Query(default="robustness"),
    ) -> dict[str, Any]:
        policies = POLICIES if screen == "robustness" else SENSITIVITY_POLICIES
        with creation_lock:
            plan = load_snapshot(plans, payload.flight_plan_snapshot_id)
            pending = [
                run for run in service.list_runs() if run.state.value in {"queued", "running"}
            ]
            run_count = len(policies) * (
                len(ROBUSTNESS_VARIANTS) if screen == "robustness" else len(SENSITIVITY_VARIANTS)
            )
            if len(pending) + run_count > 10:
                raise HTTPException(status_code=429, detail="Run-Queue voll. Runs abwarten.")
            try:
                variants = _build_variants(plan, payload, screen)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except RuntimeError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

            suite_id = uuid4().hex
            reference = read_reference()
            suite = {
                "schema": SUITE_SCHEMA,
                "suite_id": suite_id,
                "engine_version": ENGINE_VERSION,
                "screen": screen,
                "seed": payload.seed,
                "flight_plan_snapshot_id": plan.snapshot_id,
                "source_plan_sha256": plan.content_sha256,
                "scenarios": [],
            }
            queued = []
            for variant in variants:
                scenario_meta = {
                    "suite_id": suite_id,
                    "variant_key": variant["key"],
                    "mission_signature": variant["mission_signature"],
                    "demand_invariant": True,
                }
                saved_runs = []
                for policy in policies:
                    scenario_id = f"robustness_{suite_id}_{variant['key']}_{policy}_v1"
                    model_id = f"robustness_model_{suite_id}_{variant['key']}_{policy}_v1"
                    service.create_scenario(
                        ScenarioDefinition(
                            id=scenario_id,
                            version="1",
                            domain=COUPLED_DOMAIN,
                            description="Begrenzter deterministischer Stress-Screen, unkalibriert",
                            duration_ms=(variant["world"].end_min - variant["world"].start_min)
                            * 60000,
                            tick_ms=60000,
                            metadata={**scenario_meta, "policy": policy},
                        )
                    )
                    service.create_model_pack(
                        ModelPack(
                            id=model_id,
                            site_profile="munich_coupled_reference_v1",
                            parameter_set={"policy": policy},
                            calibration_meta={
                                "calibrated": False,
                                "engine_version": ENGINE_VERSION,
                                "coupled_world": variant["world"].model_dump(mode="json"),
                                "flight_plan_snapshot": plan.model_dump(mode="json"),
                                "flight_plan_usage": "drives_explicit_hypothetical_missions",
                                "reference_dossier": reference,
                                "all_operational_parameters": "synthetic_assumptions",
                                "compatibility_fields": (
                                    "frequency_voltage_blackout_switching_not_modelled"
                                ),
                                "robustness_suite": scenario_meta,
                                "varied_parameters": variant["varied_parameters"],
                            },
                        )
                    )
                    status = service.queue_run(
                        RunRequest(
                            scenario_id=scenario_id,
                            model_pack_id=model_id,
                            seed=payload.seed,
                            realtime_mode="sil",
                            adapters=[],
                            hardware_meta={
                                "generated_by": "munich_robustness_suite",
                                "suite_id": suite_id,
                                "variant_key": variant["key"],
                                "policy": policy,
                                "no_hardware_control": True,
                            },
                        )
                    )
                    queued.append(status)
                    saved_runs.append({"policy": policy, "run_id": status.run_id})
                suite["scenarios"].append(
                    {
                        "key": variant["key"],
                        "label": variant["label"],
                        "varied_parameters": variant["varied_parameters"],
                        "mission_signature": variant["mission_signature"],
                        "demand_invariant": True,
                        "runs": saved_runs,
                    }
                )
            _write_suite(_suite_path(service, suite_id), suite)
            response = _render_suite(service, suite, initial=True)
            for status in queued:
                enqueue(status.run_id)
            return response

    @router.get("/robustness-suites/{suite_id}")
    def get_suite(suite_id: str) -> dict[str, Any]:
        return _render_suite(service, _load_suite(service, suite_id))

    @router.get("/robustness-suites/{suite_id}/artifact.json")
    def download_suite_artifact(suite_id: str) -> FileResponse:
        path = _suite_path(service, suite_id)
        _load_suite(service, suite_id)
        return FileResponse(
            path,
            media_type="application/json",
            filename=f"munich-robustness-suite-{suite_id}.json",
        )

    @router.get("/robustness-suites")
    def list_suites(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
        suites = []
        for path in sorted(_suite_dir(service).glob("*.json"), reverse=True)[:limit]:
            suite_id = path.stem
            if SUITE_ID.fullmatch(suite_id):
                suites.append(_render_suite(service, _load_suite(service, suite_id)))
        return suites

    return router
