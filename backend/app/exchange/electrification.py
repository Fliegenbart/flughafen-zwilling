"""Fixed-fleet electrification study: identical demand, three explicit charging choices."""
from __future__ import annotations

import os
from contextlib import AbstractContextManager, nullcontext
from functools import lru_cache
from math import ceil
from time import perf_counter
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..munich.charging_plan import duty_hash
from ..munich.coupled_models import PREDICTIVE_ENGINE_VERSION, trusted_scale
from ..munich.coupled_simulator import simulate_coupled
from ..munich.coupled_world import build_world
from .airport_model import (
    AIRPORT_MODEL_VERSION,
    airport_config,
    airport_day,
    grid_raster,
    storage_axis,
)
from .airport_spec import load_spec
from .demo import (
    _SIMULATION_LOCK,
    DEMO_WAIT_SECONDS,
    _canonical_hash,
)
from .electrification_atlas import atlas_sizes
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
    grid_import_limit_kw: float = Field(default=1500, ge=0, le=200000)
    storage_kwh: float = Field(default=2000, ge=0, le=200000)
    # Oekosystem-Bausteine neben dem Vorfeld: Photovoltaik und Laden im Parkhaus.
    pv_kwp: float = Field(default=500, ge=0, le=100000)
    parking_sessions: int = Field(default=40, ge=0, le=2000, strict=True)
    # Echter Flughafen (data/airports/<IATA>.json); ohne Angabe der Beispielflughafen.
    airport: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def within_model(self) -> ElectrificationRequest:
        if self.airport is None:
            if (self.grid_import_limit_kw > 8000 or self.storage_kwh > 6000
                    or self.pv_kwp > 5000 or self.parking_sessions > 275):
                raise ValueError("Wert ausserhalb des Beispielflughafens")
            return self
        try:
            spec = load_spec(self.airport)
        except KeyError:
            raise ValueError("Unbekannter Flughafen") from None
        if spec.fleet is None:
            raise ValueError("Flotte des Flughafens noch nicht bemessen")
        if (self.grid_import_limit_kw > grid_raster(spec)[1]
                or self.storage_kwh > max(storage_axis(spec))):
            raise ValueError("Wert ausserhalb des Flughafenmodells")
        return self


class ElectrificationRunRequest(ElectrificationRequest):
    solution: Solution

    @model_validator(mode="after")
    def reference_only(self) -> ElectrificationRunRequest:
        if self.airport is not None:
            raise ValueError("Laeufe gibt es nur fuer den Beispielflughafen")
        return self


def _scope(airport: str | None) -> AbstractContextManager:
    """Flughafenwelten sind groesser als alles, was von aussen kommen darf."""
    return trusted_scale() if airport else nullcontext()


def _base(airport: str | None):
    """Flugplan, Konfiguration und Suchraster des Beispielflughafens oder eines Flughafens."""
    if airport is None:
        return reference_day(), reference_config(), GRID_STEP_KW, GRID_MAX_KW
    spec = load_spec(airport)
    step, top = grid_raster(spec)
    with trusted_scale():
        return airport_day(airport), airport_config(spec), step, top


def prepare_electrification(request: ElectrificationRequest, solution: Solution):
    plan, config, _, _ = _base(request.airport)
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
    config.power.pv_capacity_kwp = request.pv_kwp
    config.power.parking_sessions = request.parking_sessions
    config.power.battery_capacity_kwh = request.storage_kwh if solution == "managed_storage" else 0
    config.power.battery_power_kw = config.power.battery_capacity_kwh / 2
    config.power.battery_grid_charge_below_kw = (
        request.grid_import_limit_kw * 0.8 if config.power.battery_capacity_kwh else None
    )
    policy = "uncontrolled" if solution == "direct" else "lookahead"
    with _scope(request.airport):
        world = build_world(plan, config, DEFAULT_SEED, PREDICTIVE_ENGINE_VERSION)
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
        "duty_roster_hash": duty_hash(world),
        "fixed_vehicle_assignments": True,
        "mission_count": len(world.missions),
        "parking_jobs_hash": _canonical_hash([p.model_dump() for p in world.parking_jobs]),
        "source_plan_sha256": plan.content_sha256,
        "seed": world.seed,
        "grid_import_limit_kw": config.power.grid_import_limit_kw,
        "repeat_days": config.repeat_days,
    }


@lru_cache(maxsize=32)
def _resource_baseline_feasible(airport: str | None = None) -> bool:
    top = _base(airport)[3]
    plan, _, policy, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=top, airport=airport), "direct")
    with _scope(airport):
        result = simulate_coupled(world, plan, policy, capture_traces=False)
    return connection_checks(result)['feasible']


def size_solution(solution: Solution, electric_share_pct: int, storage_kwh: float,
                  pv_kwp: float = 500, parking_sessions: int = 40,
                  airport: str | None = None) -> dict:
    """Kleinste erfolgreiche Anschlussstufe einer Ladeloesung (Raster-Suche, siehe grid_sizing)."""
    _, _, step, top = _base(airport)
    if not _resource_baseline_feasible(airport):
        return {"status": "resource_infeasible", "required_grid_kw": None,
                "step_kw": step, "max_kw": top, "evaluations": []}

    def request(kw: float) -> ElectrificationRequest:
        return ElectrificationRequest(
            electric_share_pct=electric_share_pct, grid_import_limit_kw=kw,
            storage_kwh=storage_kwh, pv_kwp=pv_kwp, parking_sessions=parking_sessions,
            airport=airport)

    def evaluate(kw):
        plan, _, policy, world, _ = prepare_electrification(request(kw), solution)
        with _scope(airport):
            return simulate_coupled(world, plan, policy, capture_traces=False)

    _, _, _, world, _ = prepare_electrification(request(step), solution)
    return search_connection(evaluate, step_kw=step, max_kw=top,
                             lower_bound_kw=minimum_energy_bound(world))


@lru_cache(maxsize=8)
def uncontrolled_need(electric_share_pct: int, pv_kwp: float = 500,
                      parking_sessions: int = 40, airport: str | None = None) -> dict:
    """Anschluss fuer Laden ganz ohne Steuerung: kein Anschluss bremst, jedes Fahrzeug laedt
    sofort mit voller Leistung. Bedarf = hoechste Netzlast in drei Tagen, aufs Raster gerundet.

    Anders als die Variante "direct" (sofort laden, am Anschluss proportional begrenzt) bremst
    hier nichts; was ueber dem Anschluss liegt, waere Ueberlast.
    """
    _, _, step, top = _base(airport)
    request = ElectrificationRequest(
        electric_share_pct=electric_share_pct, grid_import_limit_kw=top, storage_kwh=0,
        pv_kwp=pv_kwp, parking_sessions=parking_sessions, airport=airport)
    plan, config, policy, world, _ = prepare_electrification(request, "direct")
    with _scope(airport):
        result = simulate_coupled(world, plan, policy, capture_traces=False)
    peak = max(r["grid_import_kw"] for r in result.series)
    required = ceil(peak / step - 1e-9) * step
    feasible = connection_checks(result)["feasible"] and required < top
    departures, _ = departures_by_half_hour(result)
    return {
        "grid_sizing": {"status": "feasible" if feasible else "not_found",
                        "required_grid_kw": required if feasible else None,
                        "peak_kw": round(peak, 1), "step_kw": step,
                        "max_kw": top},
        "basis": {**basis_from_series(result.series, config, day_minutes=world.day_minutes,
                                      start_min=world.start_min,
                                      day_start_utc=world.day_start_utc, policy=policy,
                                      run_id=None), "departures": departures},
    }


@lru_cache(maxsize=24)
def _size_solutions(electric_share_pct: int, storage_kwh: float, pv_kwp: float = 500,
                    parking_sessions: int = 40, airport: str | None = None) -> dict:
    # Vorab gerechnete Stufen (scripts/make_electrification_atlas.py) machen den Vergleich schnell.
    cached = atlas_sizes(electric_share_pct, storage_kwh, pv_kwp, parking_sessions, airport)
    if cached is not None:
        return cached
    answers = {}
    for solution in SOLUTIONS:
        if solution == "managed_storage" and storage_kwh == 0:
            # Same world and policy as managed, not an estimated shortcut.
            answers[solution] = answers["managed"]
            continue
        answers[solution] = size_solution(solution, electric_share_pct, storage_kwh, pv_kwp,
                                          parking_sessions, airport)
    return answers


def compare_electrification(request: ElectrificationRequest) -> dict:
    if not _SIMULATION_LOCK.acquire(timeout=DEMO_WAIT_SECONDS):
        raise HTTPException(status_code=429, detail="Demo ausgelastet. Vergleich erneut versuchen.")
    started = perf_counter()
    variants, contract = [], None
    scope = _scope(request.airport)
    try:
        scope.__enter__()
        sizes = _size_solutions(request.electric_share_pct, request.storage_kwh,
                                request.pv_kwp, request.parking_sessions, request.airport)
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
                        result.energy.vehicle_recharge_deficit_kwh or 0, 3),
                    "storage_recharge_deficit_kwh": round(max(
                        0, result.energy.battery_initial_kwh - result.energy.battery_final_kwh), 3),
                },
                "metadata": {"config": config.model_dump(mode="json"), "policy": policy,
                             "stateless": True, "engine_version": world.engine_version,
                             "planning": result.planning_meta},
            })
        uncontrolled = uncontrolled_need(request.electric_share_pct, request.pv_kwp,
                                         request.parking_sessions, request.airport)
    finally:
        scope.__exit__(None, None, None)
        _SIMULATION_LOCK.release()
    return {
        "inputs": request.model_dump(), "comparison_contract": contract, "variants": variants,
        "uncontrolled": uncontrolled,
        "comparison_id": _canonical_hash({"contract": contract, "inputs": request.model_dump(),
            "variants": [v["input_hash"] for v in variants]}),
        "engine_version": PREDICTIVE_ENGINE_VERSION,
        "build_commit": os.environ.get("TWIN_BUILD_GIT_COMMIT", "local-unversioned"),
        "compute_ms": round((perf_counter() - started) * 1000),
        "evidence_level": "synthetic_uncalibrated",
        "reference": _reference_info(request.airport),
        "sources": SOURCES,
        "limitations": _airport_limitations(request.airport) if request.airport else [
            "Synthetischer Vorfeldbereich, kein Modell des gesamten Muenchner Flughafens.",
            "180 Ankunfts- und 180 Abflugabfertigungen pro Tag; "
            "drei wiederholte Tage mit durchlaufendem SOC.",
            "Flotte, Einsatzfenster, 14 GPU-Ladepunkte, 250 kW Grundlast, "
            "500 kWp PV (Faktor 0,2) und 40 Parkvorgaenge/Tag sind Annahmen.",
            "Einsatzenergie und Batteriegroesse fuer Gepaeckschlepper, Flugzeugschlepper "
            "und Bodenstromgeraete: He et al. (2026), Tabelle 1, Narrow-body.",
            "Gleiche Einsatzzeiten fuer elektrische und nicht-elektrische Fahrzeuge.",
            "Keine Betankung, Kraftstoffkosten oder Emissionen nicht-elektrischer Fahrzeuge.",
            "Anschlussbedarf = erste erfolgreiche Stufe im 25-kW-Raster, "
            "keine exakte Mindestleistung oder Anschlusszusage.",
            "Erfolg: alle Aufgaben rechtzeitig, Grundlast und Parken versorgt, "
            "Anfangsladung jedes Fahrzeugs und des Speichers am Ende wiederhergestellt.",
            "Speicher startet mit 50 %, Fahrzeuge mit 85 %; keine geliehene Anfangsenergie, "
            "aber kein saisonaler oder zyklischer Jahresnachweis.",
            "Kein Kosten-, ROI-, Netzschutz- oder Lastflussnachweis.",
            "Gleiche Fahrzeugzuordnung je Auftrag, kein Ausweichen auf Dieselfahrzeuge.",
            "Vorausschauende Energieplanung mit vollstaendig bekanntem Einsatzplan; "
            "Heuristik, keine optimale Loesung oder Prognose realer Verspaetungen.",
            "Direktes Laden ist ebenfalls am vorhandenen Netzanschluss begrenzt.",
            "Ohne Steuerung (uncontrolled): gleiche Flotte, kein Anschluss bremst; Bedarf = "
            "hoechste Netzlast in drei Tagen, auf 25 kW aufgerundet.",
        ],
    }


def _reference_info(airport: str | None) -> dict:
    _, _, step, top = _base(airport)
    if airport is None:
        return {"id": REFERENCE_ID, "days": 3, "departures_per_day": 180,
                "arrivals_per_day": 180,
                "scope": "synthetic_apron_section_not_whole_munich_airport",
                "resource_baseline_feasible": _resource_baseline_feasible(),
                "grid_step_kw": step, "grid_max_kw": top}
    spec = load_spec(airport)
    return {"id": f"{AIRPORT_MODEL_VERSION}:{airport}", "airport": airport, "days": 3,
            "departures_per_day": round(spec.departures_per_day),
            "arrivals_per_day": round(spec.departures_per_day),
            "scope": "whole_apron_profile_from_public_data",
            "resource_baseline_feasible": _resource_baseline_feasible(airport),
            "grid_step_kw": step, "grid_max_kw": top}


def _airport_limitations(airport: str) -> list[str]:
    spec = load_spec(airport)
    step = grid_raster(spec)[0]
    return [
        f"Ganzes Vorfeld von {spec.name} an einem typischen Tag im Spitzenmonat; Tagesprofil "
        "aus veroeffentlichten Eckdaten konstruiert, kein echter Flugplan.",
        "Anschluss = Reserve des Flughafennetzes fuer das Laden (Vorfeld und Parkhaus); die "
        "uebrige Last und die Photovoltaik des Flughafens sind darin schon enthalten.",
        "Flotte aus dem Modell bemessen (kleinste puenktliche Dieselflotte plus Puffer des "
        "Beispielflughafens); keine Angabe des Flughafens.",
        "Akku, Energie je Einsatz und Ladeleistung wie im Beispielflughafen (He et al. 2026, "
        "Busse angenommen).",
        f"Anschlussbedarf = erste erfolgreiche Stufe im {step}-kW-Raster, keine Anschlusszusage.",
        "Erfolg: alle Einsaetze bis zur Frist erledigt, Parkhaus versorgt, Fahrzeuge und "
        "Speicher am Ende wieder geladen.",
        "Nicht mit dem Flughafen abgestimmt; kein Kosten-, Netzschutz- oder Lastflussnachweis.",
    ]
