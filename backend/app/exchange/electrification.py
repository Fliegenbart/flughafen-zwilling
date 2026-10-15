"""Fixed-fleet electrification study: identical demand, three explicit charging choices."""
from __future__ import annotations

import os
from functools import lru_cache
from time import perf_counter
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..munich.coupled_models import GRID_SIZING_ENGINE_VERSION
from ..munich.coupled_simulator import simulate_coupled
from ..munich.coupled_world import build_world
from .demo import (
    _SIMULATION_LOCK,
    DEMO_WAIT_SECONDS,
    _canonical_hash,
)
from .electrification_reference import REFERENCE_ID, SOURCES, reference_config, reference_day
from .grid_sizing import (
    GRID_MAX_KW,
    GRID_STEP_KW,
    connection_checks,
    minimum_energy_bound,
    search_connection,
)
from .live import basis_from_series, departures_by_half_hour, preview_kpis
from .variants import DEFAULT_SEED

Solution = Literal["direct", "managed", "managed_storage"]
SOLUTIONS = ("direct", "managed", "managed_storage")


class ElectrificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    electric_share_pct: int = Field(default=50, ge=0, le=100, strict=True)
    grid_import_limit_kw: float = Field(default=1500, ge=0, le=8000)
    storage_kwh: float = Field(default=2000, ge=0, le=6000)


class ElectrificationRunRequest(ElectrificationRequest):
    solution: Solution


def prepare_electrification(request: ElectrificationRequest, solution: Solution):
    plan, config = reference_day(), reference_config()
    total = sum(f.vehicles for f in config.fleets)
    target = (total * request.electric_share_pct + 50) // 100
    electric = [f.vehicles * request.electric_share_pct // 100 for f in config.fleets]
    # Largest remainders keep the requested total exact and class allocation repeatable.
    order = sorted(range(len(electric)), key=lambda i: (
        -(config.fleets[i].vehicles * request.electric_share_pct % 100), i,
    ))
    for i in order[:target - sum(electric)]:
        electric[i] += 1
    for fleet, count in zip(config.fleets, electric):
        fleet.electric_vehicles = count
    config.power.grid_import_limit_kw = request.grid_import_limit_kw
    config.power.battery_capacity_kwh = request.storage_kwh if solution == "managed_storage" else 0
    config.power.battery_power_kw = config.power.battery_capacity_kwh / 2
    config.power.battery_grid_charge_below_kw = (
        request.grid_import_limit_kw * 0.8 if config.power.battery_capacity_kwh else None
    )
    policy = "uncontrolled" if solution == "direct" else "mission_priority"
    world = build_world(plan, config, DEFAULT_SEED, GRID_SIZING_ENGINE_VERSION)
    changes = {**request.model_dump(exclude={"solution"}), "solution": solution}
    return plan, config, policy, world, changes


def _contract(plan, config, world) -> dict:
    fleet = [{"kind": f.kind, "total": f.vehicles, "electric": f.electric_vehicles,
              "non_electric": f.vehicles - f.electric_vehicles, "chargers": f.chargers}
             for f in config.fleets]
    initial = [{"id": f"{f.kind}-{i + 1:03d}", "electric": i < f.electric_vehicles,
                "initial_soc_pct": f.initial_soc_pct if i < f.electric_vehicles else None}
               for f in config.fleets for i in range(f.vehicles)]
    return {
        "fleet": fleet,
        "total_vehicles": sum(f["total"] for f in fleet),
        "electric_vehicles": sum(f["electric"] for f in fleet),
        "non_electric_vehicles": sum(f["non_electric"] for f in fleet),
        "initial_fleet_hash": _canonical_hash(initial),
        "missions_hash": _canonical_hash([m.model_dump() for m in world.missions]),
        "mission_count": len(world.missions),
        "parking_jobs_hash": _canonical_hash([p.model_dump() for p in world.parking_jobs]),
        "source_plan_sha256": plan.content_sha256,
        "seed": world.seed,
        "grid_import_limit_kw": config.power.grid_import_limit_kw,
        "repeat_days": config.repeat_days,
    }


@lru_cache(maxsize=1)
def _resource_baseline_feasible() -> bool:
    plan, _, policy, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=GRID_MAX_KW), "direct")
    result = simulate_coupled(world, plan, policy, capture_traces=False)
    return connection_checks(result)['feasible']


@lru_cache(maxsize=12)
def _size_solutions(electric_share_pct: int, storage_kwh: float) -> dict:
    answers = {}
    for solution in SOLUTIONS:
        if not _resource_baseline_feasible():
            answers[solution] = {"status": "resource_infeasible", "required_grid_kw": None,
                                 "step_kw": GRID_STEP_KW, "max_kw": GRID_MAX_KW,
                                 "evaluations": []}
            continue

        def evaluate(kw, solution=solution):
            plan, _, policy, world, _ = prepare_electrification(ElectrificationRequest(
                electric_share_pct=electric_share_pct, grid_import_limit_kw=kw,
                storage_kwh=storage_kwh), solution)
            return simulate_coupled(world, plan, policy, capture_traces=False)

        _, _, _, world, _ = prepare_electrification(ElectrificationRequest(
            electric_share_pct=electric_share_pct, storage_kwh=storage_kwh), solution)
        answers[solution] = search_connection(evaluate, lower_bound_kw=minimum_energy_bound(world))
    return answers


def compare_electrification(request: ElectrificationRequest) -> dict:
    if not _SIMULATION_LOCK.acquire(timeout=DEMO_WAIT_SECONDS):
        raise HTTPException(status_code=429, detail="Demo ausgelastet. Vergleich erneut versuchen.")
    started = perf_counter()
    variants, contract = [], None
    try:
        sizes = _size_solutions(request.electric_share_pct, request.storage_kwh)
        for solution in SOLUTIONS:
            plan, config, policy, world, _ = prepare_electrification(request, solution)
            invariant = _contract(plan, config, world)
            if contract is not None and invariant != contract:
                raise RuntimeError("Vergleichsbedingungen stimmen nicht ueberein")
            contract = invariant
            result = simulate_coupled(world, plan, policy, capture_traces=False)
            departures, delayed = departures_by_half_hour(result)
            input_hash = _canonical_hash({"world_hash": world.world_hash, "policy": policy})
            variants.append({
                **basis_from_series(result.series, config, day_minutes=world.day_minutes,
                                    start_min=world.start_min, day_start_utc=world.day_start_utc,
                                    policy=policy, run_id=None),
                "solution": solution, "engine_version": world.engine_version,
                "world_hash": world.world_hash, "input_hash": input_hash,
                "calculation_id": input_hash,
                "departures": departures, "kpis": preview_kpis(result, departures, delayed),
                "coupled_kpis": result.kpis.model_dump(mode="json"),
                "grid_sizing": sizes[solution],
                "checks": connection_checks(result),
                "metrics": {
                    "ready_departures": result.kpis.departures_ready_on_time,
                    "departures_total": result.kpis.modeled_departure_count,
                    "energy_wait_min": result.kpis.energy_wait_total_min,
                    "restricted_charging_min": sum(
                        r["charging_requested_kw"] - r["ground_charging_kw"]
                        - r["parking_kw"] > 0.5 for r in result.series),
                    "charging_gap_kwh": round(sum(max(0, r["charging_requested_kw"]
                        - r["ground_charging_kw"] - r["parking_kw"]) / 60
                        for r in result.series), 3),
                    "peak_grid_kw": round(max(r["grid_import_kw"] for r in result.series), 3),
                    "apron_charged_kwh": round(result.kpis.fleet_charged_kwh, 3),
                    "background_unserved_kwh": result.kpis.background_unserved_kwh,
                    "parking_unmet_kwh": result.energy.charging_unmet_kwh,
                    "horizon_hours": result.kpis.model_horizon_hours,
                    "vehicle_recharge_deficit_kwh": round(
                        result.kpis.vehicle_recharge_deficit_kwh or 0, 3),
                    "storage_recharge_deficit_kwh": round(max(
                        0, result.energy.battery_initial_kwh - result.energy.battery_final_kwh), 3),
                },
                "metadata": {"config": config.model_dump(mode="json"), "policy": policy,
                             "stateless": True, "engine_version": world.engine_version},
            })
    finally:
        _SIMULATION_LOCK.release()
    return {
        "inputs": request.model_dump(), "comparison_contract": contract, "variants": variants,
        "comparison_id": _canonical_hash({"contract": contract, "inputs": request.model_dump(),
            "variants": [v["input_hash"] for v in variants]}),
        "engine_version": GRID_SIZING_ENGINE_VERSION,
        "build_commit": os.environ.get("TWIN_BUILD_GIT_COMMIT", "local-unversioned"),
        "compute_ms": round((perf_counter() - started) * 1000),
        "evidence_level": "synthetic_uncalibrated",
        "reference": {"id": REFERENCE_ID, "days": 3, "departures_per_day": 180,
                      "arrivals_per_day": 180,
                      "scope": "synthetic_apron_section_not_whole_munich_airport",
                      "resource_baseline_feasible": _resource_baseline_feasible(),
                      "grid_step_kw": GRID_STEP_KW, "grid_max_kw": GRID_MAX_KW},
        "sources": SOURCES,
        "limitations": [
            "Synthetischer Vorfeldbereich, kein Modell des gesamten Muenchner Flughafens.",
            "180 Ankunfts- und 180 Abflugabfertigungen pro Tag; "
            "drei wiederholte Tage mit durchlaufendem SOC.",
            "Flotte, Einsatzfenster, 14 GPU-Ladepunkte, 250 kW Grundlast, "
            "500 kWp PV (Faktor 0,2) und 40 Parkvorgaenge/Tag sind Annahmen.",
            "Einsatzenergie und Batteriegroesse fuer Gepaeckschlepper, Flugzeugschlepper "
            "und Bodenstromgeraete: He et al. (2026), Tabelle 1, Narrow-body.",
            "Gleiche Einsatzzeiten fuer elektrische und nicht-elektrische Fahrzeuge.",
            "Keine Betankung, Kraftstoffkosten oder Emissionen nicht-elektrischer Fahrzeuge.",
            "Anschlussbedarf = erste erfolgreiche Stufe im 250-kW-Raster, "
            "keine exakte Mindestleistung oder Anschlusszusage.",
            "Erfolg: alle Aufgaben rechtzeitig, Grundlast und Parken versorgt, "
            "Anfangsladung jedes Fahrzeugs und des Speichers am Ende wiederhergestellt.",
            "Speicher startet mit 50 %, Fahrzeuge mit 85 %; keine geliehene Anfangsenergie, "
            "aber kein saisonaler oder zyklischer Jahresnachweis.",
            "Kein Kosten-, ROI-, Netzschutz- oder Lastflussnachweis.",
        ],
    }
