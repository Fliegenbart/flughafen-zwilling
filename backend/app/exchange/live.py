"""Vorschau fuer die Live-Regler im Arbeitsbildschirm.

Beim Ziehen eines Reglers rechnet der Browser die Netzseite nach (src/aec/model/livePower.ts, die
Ladenachfrage der Flotte nach den Regeln des Simulators in liveFleet.ts; dafuer liefert die Basis
die Weltdaten der Flotte, siehe fleet_block). Nach
einer kurzen Pause rechnet diese Vorschau den Tag genau: dieselbe Basis und dieselben Aenderungen
wie bei Loesungen (variants.apply_changes), aber ohne Warteschlange, ohne Speichern und ohne
Versiegelung. Deshalb gilt sie als Vorschau; verbindlich sind nur versiegelte Laeufe.
"""

from __future__ import annotations

from threading import Lock
from time import perf_counter

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..munich.coupled_models import CoupledConfig, CoupledPolicy, CoupledWorld, FleetKind
from ..munich.coupled_simulator import simulate_coupled
from ..munich.coupled_world import build_world
from .crisis import crisis_config, crisis_stress
from .situation import minutes_at_limit

ROUND = 3


def fleet_block(world: CoupledWorld) -> dict:
    """Weltdaten der Flotte fuer das Abbild der Ladenachfrage im Browser (liveFleet.ts).

    Nur was nicht von den Reglern abhaengt: Fahrzeugklassen, Freigabeminuten der Auftraege,
    Parkhaus-Ladeauftraege, ausgefallene Ladepunkte. Alle Auftraege einer Klasse sind im Modell
    gleich (Energie, Dauer, Rueckfahrt aus der FleetSpec, siehe coupled_world.build_world).
    """
    config = world.config
    classes = []
    for spec in config.fleets:
        missions = [m for m in world.missions if m.kind == spec.kind]
        shapes = {(m.energy_kwh, m.duration_min + m.return_min) for m in missions}
        if len(shapes) > 1:
            raise ValueError("Auftraege einer Fahrzeugklasse sind nicht gleich")
        mission_kwh, mission_min = next(iter(shapes), (0, 0))
        classes.append({
            "kind": spec.kind, "vehicles": spec.vehicles, "chargers": spec.chargers,
            "charger_kw": spec.charger_kw, "capacity_kwh": spec.battery_capacity_kwh,
            "initial_soc_pct": spec.initial_soc_pct, "target_soc_pct": spec.charge_target_soc_pct,
            "reserve_soc_pct": spec.reserve_soc_pct,
            "mission_kwh": mission_kwh, "mission_min": mission_min,
            "release_min": sorted(m.release_min for m in missions),
            "offline": [{"start_min": e.start_min, "end_min": e.end_min,
                         "chargers": e.offline_chargers}
                        for e in config.stress_events
                        if e.fleet_kind == spec.kind and e.offline_chargers],
        })
    return {
        "charging_efficiency": config.power.charging_efficiency,
        "classes": classes,
        "parking": [{"release_min": j.release_min, "deadline_min": j.deadline_min,
                     "kwh": j.energy_kwh, "kw": j.charger_kw} for j in world.parking_jobs],
    }


def basis_from_series(series: list[dict], config: CoupledConfig, *, world: CoupledWorld,
                      day_minutes: int, start_min: int, day_start_utc: str, policy: str | None,
                      run_id: str | None) -> dict:
    """Spalten statt Zeilen, gerundet: kompakt fuer den Browser (rund 1.800 Minuten)."""
    p = config.power
    rows = sorted(series, key=lambda r: r["minute"])

    def col(fn) -> list[float]:
        return [round(float(fn(r)), ROUND) for r in rows]

    return {
        "available": True,
        "run_id": run_id,
        "policy": policy,
        "day_start_utc": day_start_utc,
        "day_minutes": day_minutes,
        # Erste Minute der Reihe (Intervallbeginn), negativ = Vorlauf vor Mitternacht.
        "start_min": start_min,
        "requested_kw": col(lambda r: r.get("charging_requested_kw", 0.0)),
        "delivered_kw": col(lambda r: r["ground_charging_kw"] + r["parking_kw"]),
        "background_kw": col(lambda r: r["background_served_kw"] + r["background_unserved_kw"]),
        "pv_kw": col(lambda r: r["pv_kw"]),
        "chp_kw": col(lambda r: r["chp_kw"]),
        "grid_cap_kw": col(lambda r: r["effective_grid_cap_kw"]),
        "grid_import_kw": col(lambda r: r["grid_import_kw"]),
        # Positiv = Batterie gibt ab, negativ = Batterie laedt.
        "battery_kw": col(lambda r: r["battery_discharge_kw"] - r["battery_charge_kw"]),
        "fleet": fleet_block(world),
        "power": {
            "grid_import_limit_kw": p.grid_import_limit_kw,
            "pv_capacity_kwp": p.pv_capacity_kwp,
            "battery_capacity_kwh": p.battery_capacity_kwh,
            "battery_power_kw": p.battery_power_kw,
            "battery_initial_soc_pct": p.battery_initial_soc_pct,
            "battery_reserve_pct": p.battery_reserve_pct,
            "battery_efficiency": p.battery_efficiency,
            "battery_grid_charge_below_kw": p.battery_grid_charge_below_kw,
            "transformer_efficiency": p.transformer_efficiency,
            "charging_efficiency": p.charging_efficiency,
            "charging_limit_kw": round(
                (p.apron_transformer_kva + p.parking_transformer_kva) * p.power_factor, ROUND),
            # Jeder Sektor hat seine eigene Trafogrenze (coupled_power.PowerBalance.step).
            "apron_limit_kw": round(p.apron_transformer_kva * p.power_factor, ROUND),
            "parking_limit_kw": round(p.parking_transformer_kva * p.power_factor, ROUND),
        },
    }


# Ein Backend-Prozess (AGENTS.md): Vorschauen nacheinander, nie parallel zur selben Zeit.
_PREVIEW_LOCK = Lock()
PREVIEW_WAIT_S = 8
DEPARTURE_BIN_MIN = 30


class PreviewRequest(BaseModel):
    """Regler-Stellung; alles optional, leer = heutiger Stand."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    grid_import_limit_kw: float | None = Field(default=None, ge=0, le=100000)
    storage_kwh: float | None = Field(default=None, ge=0, le=50000)
    storage_kw: float | None = Field(default=None, gt=0, le=20000)
    pv_factor: float | None = Field(default=None, ge=0, le=3)
    extra_vehicles: dict[FleetKind, int] = Field(default_factory=dict)
    charging_policy: CoupledPolicy | None = None
    # Krisenfall der Szenario-Bibliothek als Stoerung ueber den ganzen Tag (siehe crisis.py).
    crisis: str | None = Field(default=None, pattern=r"^airport_case_0[1-8]_[a-z_]+_v1$")

    def changes(self) -> dict:
        out = self.model_dump(exclude_none=True, exclude_defaults=True)
        out.pop("crisis", None)
        # 0 kWh heisst nicht "Batterie entfernen" (VariantChanges kann das nicht ausdruecken):
        # Eine Batterie des Projekts bleibt in der Rechnung, 0 und fehlend sind dasselbe.
        if out.get("storage_kwh") == 0:
            out.pop("storage_kwh")
            out.pop("storage_kw", None)
        return out


def departures_by_half_hour(result) -> tuple[list[dict], int]:
    bins: dict[int, list[int]] = {}
    for d in result.departures:
        bucket = bins.setdefault(int(d["published_min"]) // DEPARTURE_BIN_MIN, [0, 0])
        bucket[0] += 1
        if not d.get("ready_on_time"):
            bucket[1] += 1
    delayed = sum(b[1] for b in bins.values())
    return [{"start_min": i * DEPARTURE_BIN_MIN, "count": c[0], "delayed": c[1]}
            for i, c in sorted(bins.items())], delayed


def preview(variants, project_id: str, request: PreviewRequest) -> dict:
    """Genaue Rechnung eines Tages fuer eine Regler-Stellung; nichts wird gespeichert."""
    from .variants import VariantChanges, apply_changes, invalid_variant_detail

    base, plan = variants._require_base(project_id)
    changes = request.changes()
    try:
        world0 = build_world(plan, base["config"], base["seed"])
        config, policy = base["config"], base["policy"]
        if changes:
            config, policy, _ = apply_changes(config, policy, VariantChanges.model_validate(
                changes), world0.day_minutes)
        stress = None
        if request.crisis:
            stress = crisis_stress(request.crisis)
            config = crisis_config(config, request.crisis, world0.day_minutes)
        world = build_world(plan, config, base["seed"]) if changes or stress else world0
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=invalid_variant_detail(exc)) from exc
    if not _PREVIEW_LOCK.acquire(timeout=PREVIEW_WAIT_S):
        raise HTTPException(status_code=429, detail="Run-Queue voll. Vorschau gleich erneut.")
    try:
        started = perf_counter()
        result = simulate_coupled(world, plan, policy)
        elapsed = perf_counter() - started
    finally:
        _PREVIEW_LOCK.release()
    departures, delayed = departures_by_half_hour(result)
    total = len(result.departures)
    kpis = result.kpis
    waits = float(kpis.energy_wait_total_min) + float(kpis.resource_wait_total_min)
    return {
        **basis_from_series(result.series, config, world=world, day_minutes=world.day_minutes,
                            start_min=world.start_min, day_start_utc=world.day_start_utc,
                            policy=policy, run_id=None),
        "preview": True,
        "evidence_level": "synthetic",
        "changes": changes,
        "crisis": ({"id": request.crisis, "name": stress.name, "assumption": stress.assumption}
                   if stress else None),
        "base_source": base["source"],
        "departures": departures,
        "kpis": {
            "departures_total": total,
            "delayed_departures": delayed,
            "on_time_pct": round((total - delayed) / total * 100, 2) if total else None,
            "minutes_at_limit": minutes_at_limit(result.series, world.day_minutes),
            # Verbrauch des uebrigen Flughafens, den der Anschluss nicht mehr deckt.
            "background_unserved_kwh": round(float(kpis.background_unserved_kwh), 1),
            "energy_wait_share_pct": round(float(kpis.energy_wait_total_min) / waits * 100, 1)
            if waits else 0.0,
            "bottleneck": kpis.bottleneck,
        },
        "compute_ms": round(elapsed * 1000),
    }
