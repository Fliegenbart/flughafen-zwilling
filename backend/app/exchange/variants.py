"""Varianten je Projekt: "Was hilft?" mit gekoppelten Modelllaeufen (docs/EXCHANGE_API.md).

Jede Variante aendert Parameter gegenueber der Projekt-Basis. Ein Variantenlauf rechnet Basis
und alle Varianten seriell auf demselben Flugplan-Snapshot und Seed; die Auftragsnachfrage
(Missionssignatur) ist fuer alle identisch, sonst wird der Lauf abgewiesen. Kennzahlen kommen
ausschliesslich aus abgeschlossenen, sicherheitsgeprueften Laufartefakten.
"""

from __future__ import annotations

import hashlib
import json
import math
from threading import Lock
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..models import ModelPack, RunRequest, ScenarioDefinition
from ..munich.coupled_models import (
    COUPLED_DOMAIN,
    ENGINE_VERSION,
    MAX_FLEET_VEHICLES,
    MAX_VEHICLES_PER_KIND,
    CoupledConfig,
    CoupledPolicy,
    FleetKind,
    StressEvent,
)
from ..munich.coupled_world import CoupledWorld, build_world
from ..pilot.router import _verified_coupled_series
from .assets import base_assets
from .crisis import crisis_config, crisis_stress
from .situation import minutes_at_limit

MAX_VARIANTS = 8
# Varianten-Batches duerfen die Queue ueber das Vergleichslimit (10) hinaus fuellen;
# der Worker rechnet seriell, das Limit schuetzt nur vor unbegrenztem Aufstauen.
VARIANT_QUEUE_LIMIT = 24
# Schwellen fuer "messbarer Unterschied" (Pünktlichkeit in Prozentpunkten, Minuten am Limit).
EPS_ON_TIME_PCT = 0.5
EPS_LIMIT_MIN = 1.0
BALANCE_TOLERANCE_KWH = 1e-6
STORAGE_GRID_CHARGE_SHARE = 0.8
STRESS_GRID_FACTOR = 0.8
DEFAULT_SEED = 42
DEFAULT_POLICY: CoupledPolicy = "uncontrolled"
FLEET_LABELS = {"bus": "Busse", "baggage_tractor": "Gepäckschlepper",
                "pushback_tug": "Pushback-Schlepper", "gpu": "GPU"}
KPI_FIELDS = (
    "on_time_pct", "departures_total", "departures_on_time", "delayed_departures",
    "minutes_at_limit", "peak_kw", "missing_kw_peak", "grid_energy_mwh_day",
    "background_unserved_kwh", "energy_wait_min", "resource_wait_min",
)
DELTA_FIELDS = (
    "on_time_pct", "delayed_departures", "minutes_at_limit", "peak_kw", "missing_kw_peak",
    "grid_energy_mwh_day", "background_unserved_kwh",
)


class VariantChanges(BaseModel):
    """Parameteraenderungen gegenueber der Basis (alle optional, mindestens eine)."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    grid_import_limit_kw: float | None = Field(default=None, ge=0, le=100000)
    storage_kwh: float | None = Field(default=None, gt=0, le=50000)
    storage_kw: float | None = Field(default=None, gt=0, le=20000)
    extra_vehicles: dict[FleetKind, int] = Field(default_factory=dict)
    charging_policy: CoupledPolicy | None = None
    chargers_offline: dict[FleetKind, int] = Field(default_factory=dict)
    pv_factor: float | None = Field(default=None, ge=0, le=3)

    @model_validator(mode="after")
    def plausible(self) -> VariantChanges:
        if not self.model_dump(exclude_defaults=True):
            raise ValueError("Variante aendert keinen Parameter")
        if self.storage_kw is not None and self.storage_kwh is None:
            raise ValueError("Speicherleistung ohne Speicherkapazitaet")
        if self.storage_kwh is not None:
            power = self.storage_kw if self.storage_kw is not None else self.storage_kwh / 2
            # Fachliche Grenze: hoechstens 4C (volle Entladung in 15 min), mindestens 0,1C.
            if power > self.storage_kwh * 4 or power < self.storage_kwh * 0.1:
                raise ValueError("Speicherleistung ausserhalb 0,1C bis 4C der Kapazitaet")
        for kind, count in self.extra_vehicles.items():
            if not 1 <= count <= 100:
                raise ValueError(f"Zusaetzliche Fahrzeuge {kind}: 1 bis 100")
        for kind, count in self.chargers_offline.items():
            if not 1 <= count <= 200:
                raise ValueError(f"Ladepunkte offline {kind}: 1 bis 200")
        return self


class VariantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=80)
    changes: VariantChanges


class VariantRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stress: bool = False
    # Krisenfall der Szenario-Bibliothek als Stresstest (Energie-Abbild, siehe crisis.py).
    # Ersetzt den Standard-Stresstest (Netzimport -20 %) und schaltet `stress` ein.
    crisis: str | None = Field(default=None, pattern=r"^airport_case_0[1-8]_[a-z_]+_v1$")
    # Nur den Projekt-Basislauf rechnen (z. B. nach geaenderten Projektwerten), auch ohne Varianten.
    base_only: bool = False


def canonical(payload: object) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def mission_signature(world: CoupledWorld) -> str:
    """Nachfragedefinierende Auftraege; identisch fuer alle Varianten eines Laufs."""
    return hashlib.sha256(canonical(
        [m.model_dump(mode="json") for m in world.missions]).encode()).hexdigest()


def fleet_summary(config: CoupledConfig | None, source: str | None) -> dict:
    if config is None:
        return {"total_vehicles": None, "by_kind": [], "source": None}
    return {
        "total_vehicles": sum(f.vehicles for f in config.fleets),
        "total_chargers": sum(f.chargers for f in config.fleets),
        "by_kind": [{"kind": f.kind, "label": FLEET_LABELS[f.kind], "vehicles": f.vehicles,
                     "chargers": f.chargers} for f in config.fleets],
        "source": source,
    }


def invalid_variant_detail(exc: ValueError) -> str:
    """422-Text fuer eine unzulaessige Aenderung; der Kunde liest ihn (api/http.ts explain).

    Pydantic liefert mehrzeilige Texte mit Eingabewerten und Link. Davon bleibt nur die Meldung
    der eigenen Pruefungen (ValueError in einem Validator), sonst ein allgemeiner Satz.
    """
    if not isinstance(exc, ValidationError):
        return f"invalid_variant: {exc}"
    first = exc.errors(include_url=False, include_input=False)[0]
    if first["type"] == "value_error":
        return f"invalid_variant: {first['ctx']['error']}"
    return "invalid_variant: Die Werte liegen außerhalb dessen, was das Modell rechnet."


def apply_changes(
    base: CoupledConfig, base_policy: CoupledPolicy, changes: VariantChanges, day_minutes: int,
) -> tuple[CoupledConfig, CoupledPolicy, dict[str, Any]]:
    """Variante = Basis + Aenderungen. ValueError bei fachlich unzulaessiger Kombination."""
    values = base.model_dump(mode="json")
    power = values["power"]
    varied: dict[str, Any] = {}
    if changes.grid_import_limit_kw is not None:
        power["grid_import_limit_kw"] = changes.grid_import_limit_kw
        varied["power.grid_import_limit_kw"] = changes.grid_import_limit_kw
    if changes.storage_kwh is not None:
        kw = changes.storage_kw if changes.storage_kw is not None else changes.storage_kwh / 2
        power.update(
            battery_capacity_kwh=changes.storage_kwh, battery_power_kw=kw,
            battery_initial_soc_pct=max(power["battery_reserve_pct"], 50.0),
            battery_grid_charge_below_kw=round(
                power["grid_import_limit_kw"] * STORAGE_GRID_CHARGE_SHARE, 3),
        )
        varied.update({
            "power.battery_capacity_kwh": changes.storage_kwh, "power.battery_power_kw": kw,
            "power.battery_grid_charge_below_kw": power["battery_grid_charge_below_kw"],
        })
    if changes.pv_factor is not None:
        power["pv_capacity_kwp"] = power["pv_capacity_kwp"] * changes.pv_factor
        varied["power.pv_capacity_kwp"] = power["pv_capacity_kwp"]
    fleets = {fleet["kind"]: fleet for fleet in values["fleets"]}
    for kind, count in sorted(changes.extra_vehicles.items()):
        if kind not in fleets:
            raise ValueError(f"Fahrzeugklasse {kind} ist in der Basis nicht modelliert")
        fleets[kind]["vehicles"] += count
        if fleets[kind]["vehicles"] > MAX_VEHICLES_PER_KIND:
            raise ValueError(
                f"Das Modell rechnet höchstens {MAX_VEHICLES_PER_KIND} Fahrzeuge je Art, "
                f"{FLEET_LABELS[kind]} kämen auf {fleets[kind]['vehicles']}.")
        varied[f"fleets.{kind}.vehicles"] = fleets[kind]["vehicles"]
    total = sum(fleet["vehicles"] for fleet in fleets.values())
    if total > MAX_FLEET_VEHICLES:
        raise ValueError(f"Das Modell rechnet höchstens {MAX_FLEET_VEHICLES} Fahrzeuge, "
                         f"die Flotte käme auf {total}.")
    for kind, count in sorted(changes.chargers_offline.items()):
        if kind not in fleets:
            raise ValueError(f"Fahrzeugklasse {kind} ist in der Basis nicht modelliert")
        if count > fleets[kind]["chargers"]:
            raise ValueError(f"Mehr Ladepunkte offline als {kind} besitzt")
        event = StressEvent(start_min=0, end_min=day_minutes, fleet_kind=kind,
                            offline_chargers=count).model_dump(mode="json", exclude_none=True)
        values["stress_events"].append(event)
        varied[f"chargers_offline.{kind}"] = count
    policy = changes.charging_policy or base_policy
    if policy != base_policy:
        varied["policy"] = policy
    return CoupledConfig.model_validate(values), policy, varied


def stress_config(config: CoupledConfig, day_minutes: int) -> CoupledConfig:
    """Robustheits-Stresstest je Variante: Netzimport -20 % ueber den ganzen Verkehrstag."""
    values = config.model_dump(mode="json")
    values["stress_events"].append({
        "start_min": 0, "end_min": day_minutes,
        "grid_import_limit_kw": config.power.grid_import_limit_kw * STRESS_GRID_FACTOR,
        "offline_chargers": 0,
    })
    return CoupledConfig.model_validate(values)


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(value, digits)


def run_kpis(base_dir, record) -> dict:
    """Kennzahlen eines abgeschlossenen Laufs aus dem versiegelten Evidenzartefakt."""
    _, _, frozen = _verified_coupled_series(base_dir, record.status.run_id, "grid_import_kw")
    evidence = json.loads(frozen["coupled-evidence.json"])
    day_minutes = int(evidence.get("day_minutes") or 1440)
    peak, missing = 0.0, None
    grid_day: list[float] = []
    for row in evidence["series"]:
        grid = float(row["grid_import_kw"])
        peak = max(peak, grid)
        if 0 <= int(row["minute"]) - 1 < day_minutes:
            grid_day.append(grid)
        if "charging_requested_kw" in row:
            short = float(row["charging_requested_kw"]) - float(row["ground_charging_kw"]) - float(
                row["parking_kw"])
            missing = max(missing or 0.0, short if short > 1e-6 else 0.0)
    kpis = record.summary.coupled_kpis
    departures = evidence.get("departures", [])
    on_time = sum(1 for d in departures if d.get("ready_on_time"))
    energy_wait, resource_wait = float(kpis.energy_wait_total_min), float(
        kpis.resource_wait_total_min)
    waits = energy_wait + resource_wait
    shares = ({"energy": round(energy_wait / waits * 100, 1),
               "resource": round(resource_wait / waits * 100, 1)}
              if waits > 0 else {"energy": 0.0, "resource": 0.0})
    return {
        "on_time_pct": _round(on_time / len(departures) * 100 if departures else None, 2),
        "departures_total": len(departures),
        "departures_on_time": on_time,
        "delayed_departures": len(departures) - on_time,
        "minutes_at_limit": minutes_at_limit(evidence["series"], day_minutes),
        "peak_kw": _round(peak),
        "missing_kw_peak": _round(missing),
        "grid_energy_mwh_day": _round(math.fsum(grid_day) / 60 / 1000, 3),
        "background_unserved_kwh": _round(kpis.background_unserved_kwh),
        "energy_wait_min": int(energy_wait),
        "resource_wait_min": int(resource_wait),
        "bottleneck": evidence.get("bottleneck") or kpis.bottleneck,
        "cause_shares_pct": shares,
        "fleet_energy_balance_error_kwh": kpis.fleet_energy_balance_error_kwh,
        "storage_energy_balance_error_kwh": kpis.storage_energy_balance_error_kwh,
        "world_hash": evidence.get("world_hash"),
        "artifact_sha256": record.build_meta.get("result_artifact_hashes", {}).get(
            "coupled-evidence.json"),
    }


def delta(kpis: dict | None, base: dict | None) -> dict | None:
    if not kpis or not base:
        return None
    out: dict[str, float | None] = {}
    for field in DELTA_FIELDS:
        a, b = kpis.get(field), base.get(field)
        out[field] = None if a is None or b is None else round(a - b, 3)
    return out


def _better(a: dict, b: dict) -> bool:
    """a messbar besser als b: Pünktlichkeit, bei Gleichstand (Epsilon) Minuten am Limit."""
    diff = (a["on_time_pct"] or 0) - (b["on_time_pct"] or 0)
    if abs(diff) > EPS_ON_TIME_PCT:
        return diff > 0
    return b["minutes_at_limit"] - a["minutes_at_limit"] > EPS_LIMIT_MIN


def _num(value: float, digits: int = 1) -> str:
    text = f"{value:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return text


def _gain(e: dict, base: dict) -> float:
    return (e["kpis"]["on_time_pct"] or 0) - (base["kpis"]["on_time_pct"] or 0)


def _relief(e: dict, base: dict) -> float:
    """Eingesparte Minuten am Anschlusslimit gegenueber der Basis (>0 = entlastet)."""
    return base["kpis"]["minutes_at_limit"] - e["kpis"]["minutes_at_limit"]


def build_answer(entries: list[dict], finished: bool) -> dict:
    """Antwortsatz: Puenktlichkeit und Netzentlastung getrennt bewertet.

    Puenktlich messbar besser ab EPS_ON_TIME_PCT Prozentpunkten, Netz messbar entlastet bzw.
    belastet ab EPS_LIMIT_MIN Minuten am Anschlusslimit. Verbessert eine Variante die
    Puenktlichkeit, belastet aber das Netz staerker, wird das als Zielkonflikt genannt.
    """
    epsilon = {"on_time_pct": EPS_ON_TIME_PCT, "minutes_at_limit": EPS_LIMIT_MIN}
    base = next((e for e in entries if e["key"] == "base"), None)
    empty = {"status": "pending", "best_variant_id": None, "best_name": None, "tied": [],
             "no_effect": [], "worse": [], "headline": None, "details": [], "epsilon": epsilon,
             "punctuality_best_id": None, "grid_best_id": None, "tradeoffs": []}
    if not finished or base is None or not base.get("kpis"):
        return empty
    candidates = [e for e in entries if e["key"] != "base" and e.get("kpis")]
    if not candidates:
        return {**empty, "status": "no_variants",
                "headline": "Noch keine Lösung gerechnet."}
    no_effect = [e for e in candidates
                 if not _better(e["kpis"], base["kpis"]) and not _better(base["kpis"], e["kpis"])]
    worse = [e for e in candidates if _better(base["kpis"], e["kpis"])]
    punctual = [e for e in candidates if _gain(e, base) >= EPS_ON_TIME_PCT]
    relieving = [e for e in candidates if _relief(e, base) > EPS_LIMIT_MIN]
    tradeoffs = [e for e in punctual if -_relief(e, base) > EPS_LIMIT_MIN]
    grid_best = max(relieving, key=lambda e: (_relief(e, base), _gain(e, base)), default=None)
    grid_sentence = (f"„{grid_best['name']}“ entlastet den Anschluss am stärksten, um "
                     f"{int(round(_relief(grid_best, base)))} Minuten am Limit."
                     if grid_best else
                     "Keine Lösung verkürzt die Zeit am Limit um mehr als eine Minute.")
    details = []
    for e in tradeoffs:
        details.append(f"„{e['name']}“ bringt {_num(_gain(e, base))} Prozentpunkte mehr "
                       f"pünktliche Abflüge, hält den Anschluss aber "
                       f"{int(round(-_relief(e, base)))} Minuten länger am Limit.")
    if no_effect:
        details.append("Mit " + " und ".join(f"„{e['name']}“" for e in no_effect)
                       + " ändert sich weniger als ein halber Prozentpunkt.")
    if worse:
        details.append(", ".join(f"„{e['name']}“" for e in worse)
                       + (" schneidet" if len(worse) == 1 else " schneiden")
                       + " schlechter ab als heute.")
    result = {**empty, "no_effect": [e["key"] for e in no_effect],
              "worse": [e["key"] for e in worse], "details": details,
              "grid_best_id": grid_best["key"] if grid_best else None,
              "tradeoffs": [e["key"] for e in tradeoffs]}
    if not punctual:
        if grid_best:
            return {**result, "status": "grid_only", "best_variant_id": grid_best["key"],
                    "best_name": grid_best["name"],
                    "headline": "Keine Lösung bringt mehr als einen halben Prozentpunkt "
                                f"mehr pünktliche Abflüge. {grid_sentence}"}
        return {**result, "status": "no_measurable_difference",
                "headline": "Keine Lösung bringt mehr als einen halben Prozentpunkt mehr "
                            "pünktliche Abflüge oder eine Minute weniger am Limit."}
    best = max(punctual, key=lambda e: (_gain(e, base), _relief(e, base)))
    tied = [e for e in punctual if e is not best
            and abs(_gain(best, base) - _gain(e, base)) < EPS_ON_TIME_PCT]
    effect = (f"{_num(_gain(best, base))} Prozentpunkte mehr pünktliche Abflüge "
              f"({_num(best['kpis']['on_time_pct'])} % statt "
              f"{_num(base['kpis']['on_time_pct'])} %)")
    result = {**result, "punctuality_best_id": None if tied else best["key"]}
    if tied:
        names = " und ".join(f"„{e['name']}“" for e in [best, *tied])
        return {**result, "status": "tie", "best_variant_id": None, "best_name": None,
                "tied": [e["key"] for e in [best, *tied]],
                "headline": f"{names} bringen gleich viel, jeweils {effect}. {grid_sentence}"}
    if best in tradeoffs:
        grid_part = (f"Dafür ist der Anschluss "
                     f"{int(round(-_relief(best, base)))} Minuten länger am Limit.")
        details = [d for d in details if not d.startswith(f"„{best['name']}“ bringt")]
        if grid_best:
            details.insert(0, grid_sentence)
        result = {**result, "details": details}
    elif grid_best is best:
        grid_part = (f"Den Anschluss entlastet sie ebenfalls am stärksten, um "
                     f"{int(round(_relief(best, base)))} Minuten am Limit.")
    else:
        grid_part = grid_sentence
    return {**result, "status": "winner", "best_variant_id": best["key"],
            "best_name": best["name"],
            "headline": f"„{best['name']}“ hilft am meisten, mit {_num(_gain(best, base))} "
                        f"Prozentpunkten mehr pünktlichen Abflügen. {grid_part}"}


class VariantService:
    def __init__(self, store, service, enqueue: Callable[[str], None] | None, assets=None):
        self.store = store  # ExchangeStore
        self.assets = assets  # AssetStore: Projektwerte Flotte/Anlagen (Schritt "Daten")
        self.service = service
        self.enqueue = enqueue
        self.lock = Lock()
        self._kpi_cache: dict[str, dict] = {}
        with store.pilot._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS project_variants (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    name TEXT NOT NULL,
                    changes_json TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS project_variant_batches (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    content_json TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    # ---- Basis ---------------------------------------------------------------
    def base_context(self, project_id: str) -> dict | None:
        """Basis = Konfiguration des neuesten abgeschlossenen gekoppelten Projektlaufs;
        sonst verknuepfter Flugplan mit Standardannahmen. None ohne beides.
        Projektwerte (Flotte und Anlagen) ueberschreiben in beiden Faellen die passenden Felder."""
        base = self._raw_base(project_id)
        if base is None:
            return None
        config, info = base_assets(self.assets, project_id, base["config"])
        return {**base, "config": config, "project_assets": info}

    def _raw_base(self, project_id: str) -> dict | None:
        record = self.store.latest_coupled_record(project_id)
        if record is not None and record.model_pack_snapshot is not None:
            meta = record.model_pack_snapshot.calibration_meta
            try:
                world = meta["coupled_world"]
                return {
                    "source": "coupled_run", "run_id": record.status.run_id,
                    "flight_plan_snapshot_id": meta["flight_plan_snapshot"]["snapshot_id"],
                    "seed": int(world["seed"]),
                    "policy": record.model_pack_snapshot.parameter_set.get(
                        "policy", DEFAULT_POLICY),
                    "config": CoupledConfig.model_validate(world["config"]),
                }
            except (KeyError, TypeError, ValueError):
                pass
        plans = [link for link in self.store.list_links(project_id)
                 if link["kind"] == "flight_plan_snapshot"]
        if plans:
            return {"source": "flight_plan_default_assumptions", "run_id": None,
                    "flight_plan_snapshot_id": plans[-1]["ref_id"], "seed": DEFAULT_SEED,
                    "policy": DEFAULT_POLICY, "config": CoupledConfig()}
        return None

    def _require_base(self, project_id: str) -> tuple[dict, Any]:
        base = self.base_context(project_id)
        if base is None:
            raise HTTPException(
                status_code=409,
                detail="no_base: Projekt braucht einen gekoppelten Lauf oder Flugplan-Link")
        if base["project_assets"].get("error"):
            raise HTTPException(
                status_code=409,
                detail=f"invalid_assets: Projektwerte passen nicht zur Basis: "
                       f"{base['project_assets']['error']}")
        plan = self.store._flight_plan(base["flight_plan_snapshot_id"])
        return base, plan

    # ---- Varianten -------------------------------------------------------------
    def _rows(self, project_id: str) -> list[dict]:
        with self.store.pilot._connect() as connection:
            self.store._project(connection, project_id)
            rows = connection.execute(
                "SELECT * FROM project_variants WHERE project_id = ? AND deleted_at IS NULL "
                "ORDER BY created_at, id", (project_id,)).fetchall()
        return [{"id": r["id"], "name": r["name"], "changes": json.loads(r["changes_json"]),
                 "created_by": json.loads(r["created_by_json"]), "created_at": r["created_at"]}
                for r in rows]

    def create(self, project_id: str, request: VariantRequest, actor) -> dict:
        from .router import _forbid

        _forbid(actor, {"airport", "admin"}, "create variant")
        name = request.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="name must not be blank")
        existing = self._rows(project_id)
        if len(existing) >= MAX_VARIANTS:
            raise HTTPException(status_code=409, detail=f"Maximal {MAX_VARIANTS} Varianten")
        if any(v["name"].casefold() == name.casefold() for v in existing):
            raise HTTPException(status_code=409, detail="Variante mit diesem Namen existiert")
        base, plan = self._require_base(project_id)
        try:
            world = build_world(plan, base["config"], base["seed"])
            config, policy, varied = apply_changes(
                base["config"], base["policy"], request.changes, world.day_minutes)
            build_world(plan, config, base["seed"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=invalid_variant_detail(exc)) from exc
        if not varied:
            raise HTTPException(status_code=422,
                                detail="invalid_variant: aendert nichts gegenueber der Basis")
        changes = request.changes.model_dump(mode="json", exclude_defaults=True)
        payload = {"id": str(uuid4()), "name": name, "changes": changes,
                   "created_by": actor.model_dump(), "created_at": self.store.pilot._now()}
        with self.store.pilot._connect() as connection:
            connection.execute(
                "INSERT INTO project_variants(id, project_id, name, changes_json, "
                "created_by_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (payload["id"], project_id, name, canonical(changes),
                 canonical(payload["created_by"]), payload["created_at"]))
            self.store._audit(connection, project_id, "variant_created", payload["id"], actor,
                              {"name": name, "changes": changes})
        return {**payload, "varied_parameters": varied}

    def delete(self, project_id: str, variant_id: str, actor) -> None:
        from .router import _forbid

        _forbid(actor, {"airport", "admin"}, "delete variant")
        with self.store.pilot._connect() as connection:
            self.store._project(connection, project_id)
            updated = connection.execute(
                "UPDATE project_variants SET deleted_at = ? WHERE id = ? AND project_id = ? "
                "AND deleted_at IS NULL", (self.store.pilot._now(), variant_id, project_id))
            if updated.rowcount != 1:
                raise HTTPException(status_code=404, detail="variant not found")
            self.store._audit(connection, project_id, "variant_deleted", variant_id, actor, {})

    # ---- Lauf ------------------------------------------------------------------
    def _queue(self, batch_id: str, key: str, world: CoupledWorld, plan, policy: str,
               signature: str, varied: dict, project_id: str, reference: dict,
               stress: bool) -> str:
        suffix = f"{key}_{'stress' if stress else 'main'}"
        scenario_id = f"variant_{batch_id}_{suffix}_v1".replace("-", "")
        model_id = f"variant_model_{batch_id}_{suffix}_v1".replace("-", "")
        meta = {"project_id": project_id, "batch_id": batch_id, "variant_key": key,
                "mission_signature": signature, "stress": stress}
        self.service.create_scenario(ScenarioDefinition(
            id=scenario_id, version="1", domain=COUPLED_DOMAIN,
            description="Projekt-Variante, gekoppeltes Modell, unkalibriert",
            duration_ms=(world.end_min - world.start_min) * 60000, tick_ms=60000,
            metadata={**meta, "policy": policy},
        ))
        self.service.create_model_pack(ModelPack(
            id=model_id, site_profile="munich_coupled_reference_v1",
            parameter_set={"policy": policy}, calibration_meta={
                "calibrated": False, "engine_version": ENGINE_VERSION,
                "coupled_world": world.model_dump(mode="json"),
                "flight_plan_snapshot": plan.model_dump(mode="json"),
                "flight_plan_usage": "drives_explicit_hypothetical_missions",
                "reference_dossier": reference,
                "all_operational_parameters": "synthetic_assumptions",
                "compatibility_fields": "frequency_voltage_blackout_switching_not_modelled",
                "project_variant": meta, "varied_parameters": varied,
            },
        ))
        status = self.service.queue_run(RunRequest(
            scenario_id=scenario_id, model_pack_id=model_id, seed=world.seed,
            realtime_mode="sil", adapters=[], hardware_meta={
                "generated_by": "project_variants", "batch_id": batch_id,
                "variant_key": key, "policy": policy, "no_hardware_control": True,
            },
        ))
        return status.run_id

    def run(self, project_id: str, request: VariantRunRequest, actor) -> dict:
        from ..munich.router import read_reference
        from .router import _forbid

        _forbid(actor, {"airport", "admin"}, "run variants")
        if self.service is None or self.enqueue is None:
            raise HTTPException(status_code=503, detail="run service unavailable")
        with self.lock:
            if request.crisis is not None:
                try:
                    crisis = crisis_stress(request.crisis)
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=f"unknown_crisis: {exc}") from exc
                request = request.model_copy(update={"stress": True})
            variants = [] if request.base_only else self._rows(project_id)
            if not variants and not request.base_only:
                raise HTTPException(status_code=409, detail="no_variants: erst Varianten anlegen")
            base, plan = self._require_base(project_id)
            per_entry = 2 if request.stress else 1
            total = (len(variants) + 1) * per_entry
            pending = [r for r in self.service.list_runs()
                       if r.state.value in {"queued", "running"}]
            if len(pending) + total > VARIANT_QUEUE_LIMIT:
                raise HTTPException(status_code=429, detail="Run-Queue voll. Runs abwarten.")
            try:
                base_world = build_world(plan, base["config"], base["seed"])
                signature = mission_signature(base_world)
                prepared = [{"key": "base", "name": "Heute", "changes": {}, "varied": {},
                             "policy": base["policy"], "config": base["config"],
                             "world": base_world}]
                for variant in variants:
                    config, policy, varied = apply_changes(
                        base["config"], base["policy"],
                        VariantChanges.model_validate(variant["changes"]),
                        base_world.day_minutes)
                    prepared.append({"key": variant["id"], "name": variant["name"],
                                     "changes": variant["changes"], "varied": varied,
                                     "policy": policy, "config": config,
                                     "world": build_world(plan, config, base["seed"])})
                for entry in prepared:
                    if (mission_signature(entry["world"]) != signature
                            or entry["world"].source_plan_sha256 != plan.content_sha256):
                        raise RuntimeError("Variante veraendert die eingefrorene Nachfrage")
                    stressed = (
                        crisis_config(entry["config"], request.crisis, base_world.day_minutes)
                        if request.crisis else stress_config(entry["config"],
                                                             base_world.day_minutes))
                    entry["stress_world"] = (build_world(plan, stressed, base["seed"])
                                             if request.stress else None)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=invalid_variant_detail(exc)) from exc
            except RuntimeError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            batch_id = uuid4().hex
            reference = read_reference()
            queued: list[str] = []
            entries = []
            for entry in prepared:
                run_id = self._queue(batch_id, entry["key"], entry["world"], plan,
                                     entry["policy"], signature, entry["varied"], project_id,
                                     reference, False)
                queued.append(run_id)
                stress_run = None
                if entry["stress_world"] is not None:
                    stress_run = self._queue(batch_id, entry["key"], entry["stress_world"],
                                             plan, entry["policy"], signature, entry["varied"],
                                             project_id, reference, True)
                    queued.append(stress_run)
                entries.append({
                    "key": entry["key"], "name": entry["name"], "changes": entry["changes"],
                    "varied_parameters": entry["varied"], "policy": entry["policy"],
                    "world_hash": entry["world"].world_hash, "run_id": run_id,
                    "stress_world_hash": (entry["stress_world"].world_hash
                                          if entry["stress_world"] else None),
                    "stress_run_id": stress_run,
                    "fleet": fleet_summary(entry["config"], "variant"),
                })
            content = {
                "batch_id": batch_id, "engine_version": ENGINE_VERSION,
                "flight_plan_snapshot_id": plan.snapshot_id,
                "source_plan_sha256": plan.content_sha256, "seed": base["seed"],
                "mission_signature": signature, "base_source": base["source"],
                "base_run_id": base["run_id"], "stress": request.stress, "entries": entries,
                "stress_kind": "crisis" if request.crisis else (
                    "grid_minus_20" if request.stress else None),
                "crisis": ({"id": request.crisis, "name": crisis.name,
                            "assumption": crisis.assumption} if request.crisis else None),
                "base_only": request.base_only,
                "project_assets": base["project_assets"],
            }
            now = self.store.pilot._now()
            with self.store.pilot._connect() as connection:
                connection.execute(
                    "INSERT INTO project_variant_batches(id, project_id, content_json, "
                    "created_by_json, created_at) VALUES (?, ?, ?, ?, ?)",
                    (batch_id, project_id, canonical(content), canonical(actor.model_dump()),
                     now))
                self.store._audit(connection, project_id, "variants_run", batch_id, actor,
                                  {"runs": queued, "mission_signature": signature,
                                   "stress": request.stress, "crisis": request.crisis})
            for run_id in queued:
                self.enqueue(run_id)
        return self.list(project_id)

    # ---- Lesen -----------------------------------------------------------------
    def _run_result(self, run_id: str | None, signature: str) -> dict:
        if run_id is None:
            return {"run_id": None, "status": None, "kpis": None, "evidence_level": None}
        try:
            record = self.service.get_run_record(run_id)
        except Exception:  # noqa: BLE001 - fehlender Lauf wird als Status ausgewiesen
            return {"run_id": run_id, "status": "missing", "kpis": None,
                    "evidence_level": "assumption", "criteria": None}
        state = record.status.state.value
        result: dict[str, Any] = {"run_id": run_id, "status": state, "kpis": None,
                                  "evidence_level": "assumption", "criteria": None,
                                  "error": record.status.error if state == "failed" else None}
        if state != "completed":
            return result
        try:
            if run_id not in self._kpi_cache:
                self._kpi_cache[run_id] = run_kpis(self.store.base_dir, record)
            kpis = self._kpi_cache[run_id]
            verified = True
        except HTTPException:
            return {**result, "evidence_level": "synthetic",
                    "criteria": {"integrity_verified": False}}
        meta = (record.model_pack_snapshot.calibration_meta
                if record.model_pack_snapshot else {})
        world = meta.get("coupled_world") or {}
        try:
            same_world = mission_signature(CoupledWorld.model_validate(world)) == signature
        except ValueError:
            same_world = False
        criteria = {
            "integrity_verified": verified,
            "same_demand_world": same_world,
            "energy_balance_closed": (
                kpis["fleet_energy_balance_error_kwh"] <= BALANCE_TOLERANCE_KWH
                and kpis["storage_energy_balance_error_kwh"] <= BALANCE_TOLERANCE_KWH),
            "background_load_served": (kpis["background_unserved_kwh"] or 0) <= 1e-6,
        }
        return {**result, "kpis": {k: v for k, v in kpis.items()
                                   if k not in {"fleet_energy_balance_error_kwh",
                                                "storage_energy_balance_error_kwh"}},
                "criteria": criteria,
                "evidence_level": "model_checked" if all(criteria.values()) else "synthetic"}

    def latest_batch(self, project_id: str) -> dict | None:
        with self.store.pilot._connect() as connection:
            row = connection.execute(
                "SELECT * FROM project_variant_batches WHERE project_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT 1", (project_id,)).fetchone()
        if row is None:
            return None
        content = json.loads(row["content_json"])
        content["created_at"] = row["created_at"]
        return content

    def list(self, project_id: str) -> dict:
        variants = self._rows(project_id)
        base = self.base_context(project_id)
        batch = self.latest_batch(project_id)
        run = None
        if batch is not None:
            signature = batch["mission_signature"]
            entries, states = [], []
            for entry in batch["entries"]:
                main = self._run_result(entry["run_id"], signature)
                stress = (self._run_result(entry["stress_run_id"], signature)
                          if entry.get("stress_run_id") else None)
                states.append(main["status"])
                if stress:
                    states.append(stress["status"])
                entries.append({
                    "key": entry["key"], "name": entry["name"], "changes": entry["changes"],
                    "varied_parameters": entry["varied_parameters"], "policy": entry["policy"],
                    "world_hash": entry["world_hash"], "fleet": entry.get("fleet"),
                    **{k: main[k] for k in ("run_id", "status", "kpis", "evidence_level",
                                            "criteria")},
                    "error": main.get("error"),
                    "stress": stress,
                })
            base_entry = next((e for e in entries if e["key"] == "base"), None)
            for entry in entries:
                entry["delta_to_base"] = (None if entry["key"] == "base" else delta(
                    entry["kpis"], base_entry["kpis"] if base_entry else None))
            done = sum(s in {"completed", "failed", "cancelled", "missing"} for s in states)
            finished = done == len(states)
            status = ("running" if any(s == "running" for s in states) else
                      "queued" if not finished else
                      "completed" if all(s == "completed" for s in states) else "partial")
            current_ids = {v["id"] for v in variants}
            run = {
                "batch_id": batch["batch_id"], "created_at": batch["created_at"],
                "status": status, "progress": {"done": done, "total": len(states)},
                "engine_version": batch["engine_version"],
                "flight_plan_snapshot_id": batch["flight_plan_snapshot_id"],
                "source_plan_sha256": batch["source_plan_sha256"], "seed": batch["seed"],
                "mission_signature": signature, "base_source": batch["base_source"],
                "stress": batch["stress"],
                "stress_kind": batch.get("stress_kind", "grid_minus_20" if batch["stress"]
                                         else None),
                "crisis": batch.get("crisis"),
                "project_assets": batch.get("project_assets"),
                "stale": {e["key"] for e in entries if e["key"] != "base"} != current_ids,
                # Projektwerte oder Flugplan seit dem Lauf geaendert (Hash-Vergleich).
                "inputs_stale": base is not None and (
                    (batch.get("project_assets") or {}).get("sha256")
                    != base["project_assets"].get("sha256")
                    or batch["flight_plan_snapshot_id"] != base["flight_plan_snapshot_id"]),
                "entries": entries,
                "answer": build_answer(entries, finished),
            }
        return {
            "project_id": project_id,
            "base": None if base is None else {
                "source": base["source"], "run_id": base["run_id"],
                "flight_plan_snapshot_id": base["flight_plan_snapshot_id"],
                "seed": base["seed"], "policy": base["policy"],
                "grid_import_limit_kw": base["config"].power.grid_import_limit_kw,
                "storage_kwh": base["config"].power.battery_capacity_kwh,
                "pv_capacity_kwp": base["config"].power.pv_capacity_kwp,
                "chp_output_kw": base["config"].power.chp_output_kw,
                "battery_power_kw": base["config"].power.battery_power_kw,
                "fleet": fleet_summary(base["config"], base["source"]),
                "project_assets": base["project_assets"],
            },
            "variants": variants,
            "limits": {"max_variants": MAX_VARIANTS, "queue_limit": VARIANT_QUEUE_LIMIT,
                       "epsilon": {"on_time_pct": EPS_ON_TIME_PCT,
                                   "minutes_at_limit": EPS_LIMIT_MIN}},
            "latest_run": run,
            "evidence_note": ("model_checked nur bei geprueftem Artefakt, gleicher Nachfragewelt, "
                              "geschlossener Energiebilanz und versorgter Grundlast."),
            "data_status": "synthetic_assumptions_uncalibrated",
        }
