"""Flotte und Anlagen je Projekt (Schritt "Daten" im Airport Energy Check).

Projektwerte fuer Fahrzeuge je Klasse, Ladepunkte, Netzanschluss, PV, BHKW und Speicher.
Jeder Wert traegt Einheit, Quelle und Quelldatum. Ohne Quelle bleibt er eine Annahme.
Die Werte ueberschreiben die entsprechenden Felder der Varianten-Basis (gekoppelte Laeufe
des Projekts); alle uebrigen Modellparameter bleiben Standardannahmen.

Originale bleiben erhalten: hochgeladene CSV/JSON-Dateien werden unveraendert mit SHA256
gespeichert, jede Umrechnung (MW -> kW usw.) behaelt Originalwert und Originaleinheit.
Keine Hardwarewrites, keine Anlagensteuerung.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from datetime import date
from io import StringIO
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..munich.coupled_models import MAX_FLEET_VEHICLES, MAX_VEHICLES_PER_KIND, CoupledConfig

MAX_IMPORT_BYTES = 256 * 1024
MAX_ENTRIES = 64
FLEET_KINDS = ("bus", "baggage_tractor", "pushback_tug", "gpu")
FLEET_LABELS = {"bus": "Busse", "baggage_tractor": "Gepäckschlepper",
                "pushback_tug": "Pushback-Schlepper", "gpu": "GPU"}
# Einheitengruppen: kanonische Einheit -> erlaubte Schreibweisen mit Faktor zur kanonischen.
UNITS: dict[str, dict[str, float]] = {
    "kW": {"kw": 1.0, "mw": 1000.0},
    "kWh": {"kwh": 1.0, "mwh": 1000.0},
    "kWp": {"kwp": 1.0, "mwp": 1000.0},
    "Stück": {"stück": 1.0, "stueck": 1.0, "stk": 1.0, "anzahl": 1.0},
}
APPLIED_TO = "Varianten-Basis der gekoppelten Läufe dieses Projekts"
NOTICE = ("Projektwerte ohne Quelle bleiben Annahmen. Nicht genannte Modellparameter sind "
          "Standardannahmen. Keine Hardwarewrites.")


_DEFAULTS = CoupledConfig()


def _default(path: tuple) -> float:
    """Vorbelegung = Standardannahme des Modells (im Formular als Annahme markiert)."""
    if path[0] == "power":
        return getattr(_DEFAULTS.power, path[1])
    fleet = next(f for f in _DEFAULTS.fleets if f.kind == path[1])
    return getattr(fleet, path[2])


def _field(key: str, label: str, group: str, unit: str, path: tuple, low: float, high: float,
           integer: bool = False, low_open: bool = False) -> dict:
    return {"key": key, "label": label, "group": group, "unit": unit, "path": path,
            "min": low, "max": high, "integer": integer, "min_exclusive": low_open,
            "default": _default(path)}


FIELDS: dict[str, dict] = {}
for _kind in FLEET_KINDS:
    _label = FLEET_LABELS[_kind]
    for _f in (
        _field(f"fleet.{_kind}.vehicles", f"{_label}: Fahrzeuge", "flotte", "Stück",
               ("fleet", _kind, "vehicles"), 0, 200, integer=True),
        _field(f"fleet.{_kind}.chargers", f"{_label}: Ladepunkte", "flotte", "Stück",
               ("fleet", _kind, "chargers"), 0, 200, integer=True),
        _field(f"fleet.{_kind}.charger_kw", f"{_label}: Ladeleistung je Ladepunkt", "flotte",
               "kW", ("fleet", _kind, "charger_kw"), 0, 500, low_open=True),
    ):
        FIELDS[_f["key"]] = _f
for _f in (
    _field("grid_import_limit_kw", "Netzanschluss (Bezugsgrenze)", "anlagen", "kW",
           ("power", "grid_import_limit_kw"), 0, 100000),
    _field("pv_capacity_kwp", "PV-Leistung", "anlagen", "kWp",
           ("power", "pv_capacity_kwp"), 0, 100000),
    _field("chp_output_kw", "BHKW-Leistung", "anlagen", "kW",
           ("power", "chp_output_kw"), 0, 100000),
    _field("battery_capacity_kwh", "Speicher: Kapazität", "anlagen", "kWh",
           ("power", "battery_capacity_kwh"), 0, 50000),
    _field("battery_power_kw", "Speicher: Leistung", "anlagen", "kW",
           ("power", "battery_power_kw"), 0, 20000),
):
    FIELDS[_f["key"]] = _f


class AssetEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    key: str = Field(min_length=1, max_length=64)
    value: float
    unit: str = Field(min_length=1, max_length=16)
    source: str = Field(default="", max_length=500)
    source_date: str | None = Field(default=None, max_length=10)


class AssetsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    entries: list[AssetEntry] = Field(default_factory=list, max_length=MAX_ENTRIES)
    note: str = Field(default="", max_length=1_000)


def _canonical(payload: object) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _num(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def invalid(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=f"invalid_assets: {message}")


def normalize(entries: list[AssetEntry]) -> list[dict]:
    """Prueft Schluessel, Einheit, Wertebereich und Datum; rechnet in die kanonische Einheit um.

    Originalwert und Originaleinheit bleiben erhalten. Fehler -> 422 mit deutscher Meldung.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for entry in entries:
        key = entry.key.strip()
        spec = FIELDS.get(key)
        if spec is None:
            raise invalid(f"Unbekannter Wert „{key}“.")
        if key in seen:
            raise invalid(f"„{spec['label']}“ ist doppelt angegeben.")
        seen.add(key)
        unit_raw = entry.unit.strip()
        factor = UNITS[spec["unit"]].get(unit_raw.casefold())
        if factor is None:
            allowed = ", ".join(sorted({spec["unit"], *(
                u for u in ("MW", "MWh", "MWp") if u.casefold() in UNITS[spec["unit"]])}))
            raise invalid(f"„{spec['label']}“: Einheit „{unit_raw}“ passt nicht, "
                          f"erwartet {allowed}.")
        if not math.isfinite(entry.value):
            raise invalid(f"„{spec['label']}“: Wert ist keine Zahl.")
        value = entry.value * factor
        if spec["integer"]:
            if abs(value - round(value)) > 1e-9:
                raise invalid(f"„{spec['label']}“: nur ganze Zahlen.")
            value = int(round(value))
        low_ok = value > spec["min"] if spec["min_exclusive"] else value >= spec["min"]
        if not low_ok or value > spec["max"]:
            raise invalid(f"„{spec['label']}“: {_num(value)} {spec['unit']} liegt außerhalb "
                          f"{_num(spec['min'])} bis {_num(spec['max'])} {spec['unit']}.")
        source_date = (entry.source_date or "").strip() or None
        if source_date is not None:
            try:
                date.fromisoformat(source_date)
            except ValueError as exc:
                raise invalid(f"„{spec['label']}“: Quelldatum „{source_date}“ ist kein "
                              "Datum (JJJJ-MM-TT).") from exc
        source = re.sub(r"\s+", " ", entry.source).strip()
        out.append({
            "key": key, "label": spec["label"], "group": spec["group"],
            "value": value, "unit": spec["unit"],
            "original_value": entry.value, "original_unit": unit_raw,
            "source": source, "source_date": source_date,
            "status": "echt" if source else "annahme",
        })
    return out


def plain_message(exc: ValueError) -> str:
    """Ein Satz fuer den Kunden aus einer Modellpruefung (der Text steht in der Oberflaeche).

    Pydantic liefert mehrzeilige Texte mit Eingabewerten und Link. Davon bleibt nur die Meldung
    der eigenen Pruefungen (ValueError in einem Validator), sonst ein allgemeiner Satz.
    """
    if not isinstance(exc, ValidationError):
        return str(exc)
    first = exc.errors(include_url=False, include_input=False)[0]
    if first["type"] == "value_error":
        return str(first["ctx"]["error"])
    return "Die Werte liegen außerhalb dessen, was das Modell rechnet."


def check_fleet_limits(fleets: list[dict]) -> None:
    """Fahrzeuggrenzen des Modells vorab mit Zahlen im Satz; ValueError bei Verstoß."""
    for fleet in fleets:
        if fleet["vehicles"] > MAX_VEHICLES_PER_KIND:
            raise ValueError(
                f"Das Modell rechnet höchstens {MAX_VEHICLES_PER_KIND} Fahrzeuge je Art, "
                f"{FLEET_LABELS[fleet['kind']]} kämen auf {fleet['vehicles']}.")
    total = sum(fleet["vehicles"] for fleet in fleets)
    if total > MAX_FLEET_VEHICLES:
        raise ValueError(f"Das Modell rechnet höchstens {MAX_FLEET_VEHICLES} Fahrzeuge, "
                         f"die Flotte käme auf {total}.")


def apply_assets(config: CoupledConfig, entries: list[dict]) -> CoupledConfig:
    """Projektwerte auf eine Modellkonfiguration legen. ValueError (ein Satz) bei Widerspruch."""
    values = config.model_dump(mode="json")
    fleets = {f["kind"]: f for f in values["fleets"]}
    for entry in entries:
        path = FIELDS[entry["key"]]["path"]
        if path[0] == "power":
            values["power"][path[1]] = entry["value"]
        else:
            fleet = fleets.get(path[1])
            if fleet is None:
                raise ValueError(f"Fahrzeugklasse {FLEET_LABELS[path[1]]} ist im Modell nicht "
                                 "enthalten")
            fleet[path[2]] = entry["value"]
    keys = {e["key"] for e in entries}
    if "battery_capacity_kwh" in keys and "battery_power_kw" not in keys:
        cap = values["power"]["battery_capacity_kwh"]
        values["power"]["battery_power_kw"] = cap / 2 if cap > 0 else 0
    for fleet in values["fleets"]:
        # Ladepunkte ohne Fahrzeuge sind keine sinnvolle Flotte: klare Meldung statt Modellfehler.
        if fleet["chargers"] > fleet["vehicles"]:
            raise ValueError(f"{FLEET_LABELS[fleet['kind']]}: mehr Ladepunkte "
                             f"({fleet['chargers']}) als Fahrzeuge ({fleet['vehicles']})")
    check_fleet_limits(values["fleets"])
    try:
        return CoupledConfig.model_validate(values)
    except ValidationError as exc:
        raise ValueError(plain_message(exc)) from exc


def data_status(entries: list[dict]) -> str:
    """fehlt: keine Projektwerte; echt: Netzanschluss und mindestens eine Fahrzeugklasse,
    alle Werte mit Quelle; sonst annahme."""
    if not entries:
        return "fehlt"
    keys = {e["key"] for e in entries}
    has_fleet = any(k.endswith(".vehicles") for k in keys)
    if "grid_import_limit_kw" in keys and has_fleet and all(e["source"] for e in entries):
        return "echt"
    return "annahme"


# ---- Dateien ---------------------------------------------------------------------

CSV_COLUMNS = ("key", "value", "unit", "source", "source_date")


def _parse_number(text: str, line: int) -> float:
    raw = text.strip().replace(" ", "").replace(" ", "")
    if "," in raw and "." not in raw:
        raw = raw.replace(",", ".")
    try:
        value = float(raw)
    except ValueError as exc:
        raise invalid(f"Zeile {line}: „{text.strip()}“ ist keine Zahl.") from exc
    if not math.isfinite(value):
        raise invalid(f"Zeile {line}: Wert ist keine endliche Zahl.")
    return value


def parse_csv(text: str) -> list[AssetEntry]:
    """CSV: key,value,unit,source,source_date. Zeilen mit # sind Kommentare."""
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        raise invalid("Die Datei enthält keine Werte.")
    sample = lines[0]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(StringIO("\n".join(lines)), delimiter=delimiter)
    rows = list(reader)
    header = [h.strip().lower().lstrip("﻿") for h in rows[0]]
    if header[:3] != ["key", "value", "unit"] or len(set(header)) != len(header) or (
            set(header) - set(CSV_COLUMNS)):
        raise invalid("Kopfzeile muss key,value,unit,source,source_date lauten "
                      "(source und source_date optional).")
    entries: list[AssetEntry] = []
    for number, row in enumerate(rows[1:], start=2):
        if len(row) > len(header):
            raise invalid(f"Zeile {number}: mehr Spalten als in der Kopfzeile.")
        record = dict(zip(header, [c.strip() for c in row]))
        if not record.get("key"):
            raise invalid(f"Zeile {number}: Schlüssel (key) fehlt.")
        if not record.get("unit"):
            raise invalid(f"Zeile {number}: Einheit (unit) fehlt.")
        entries.append(AssetEntry(
            key=record["key"], value=_parse_number(record.get("value", ""), number),
            unit=record["unit"], source=record.get("source", ""),
            source_date=record.get("source_date") or None))
    if len(entries) > MAX_ENTRIES:
        raise invalid(f"Höchstens {MAX_ENTRIES} Werte je Datei.")
    return entries


def parse_json(text: str) -> list[AssetEntry]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise invalid(f"JSON nicht lesbar (Zeile {exc.lineno}, Spalte {exc.colno}).") from exc
    raw = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raise invalid("JSON muss eine Liste „entries“ mit key, value, unit, source enthalten.")
    if len(raw) > MAX_ENTRIES:
        raise invalid(f"Höchstens {MAX_ENTRIES} Werte je Datei.")
    entries = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise invalid(f"Eintrag {index}: kein Objekt.")
        if "unit" not in item or not str(item.get("unit") or "").strip():
            raise invalid(f"Eintrag {index}: Einheit (unit) fehlt.")
        value = item.get("value")
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise invalid(f"Eintrag {index}: Wert (value) fehlt oder ist keine Zahl.")
        try:
            entries.append(AssetEntry(
                key=str(item.get("key", "")), unit=str(item["unit"]),
                value=_parse_number(str(value), index),
                source=str(item.get("source") or ""),
                source_date=(str(item["source_date"]) if item.get("source_date") else None)))
        except ValueError as exc:  # pydantic: Feldlaengen, Zusatzfelder
            raise invalid(f"Eintrag {index}: Felder ungültig.") from exc
    return entries


# ---- Speicher --------------------------------------------------------------------

class AssetStore:
    """Versionierte Projektwerte (neueste Version gilt) im Pilot-SQLite mit Audit-Hashkette."""

    def __init__(self, exchange_store):
        self.store = exchange_store
        with self.store.pilot._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS project_assets (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    entries_json TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    source_kind TEXT NOT NULL CHECK(source_kind IN ('form', 'csv', 'json')),
                    filename TEXT,
                    original_text TEXT,
                    original_sha256 TEXT,
                    note TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS project_assets_by_project
                    ON project_assets(project_id, created_at, id);
                """
            )

    def latest(self, project_id: str) -> dict | None:
        with self.store.pilot._connect() as connection:
            self.store._project(connection, project_id)
            row = connection.execute(
                "SELECT * FROM project_assets WHERE project_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT 1", (project_id,)).fetchone()
        if row is None:
            return None
        return {"id": row["id"], "entries": json.loads(row["entries_json"]),
                "sha256": row["content_sha256"], "source_kind": row["source_kind"],
                "filename": row["filename"], "original_sha256": row["original_sha256"],
                "note": row["note"], "created_by": json.loads(row["created_by_json"]),
                "created_at": row["created_at"]}

    def entries(self, project_id: str) -> list[dict]:
        latest = self.latest(project_id)
        return latest["entries"] if latest else []

    def payload(self, project_id: str) -> dict:
        latest = self.latest(project_id)
        entries = latest["entries"] if latest else []
        return {
            "project_id": project_id,
            "status": data_status(entries),
            "entries": entries,
            "version": None if latest is None else {
                k: latest[k] for k in ("id", "sha256", "source_kind", "filename",
                                       "original_sha256", "note", "created_by", "created_at")},
            "fields": [{k: v for k, v in f.items() if k != "path"} for f in FIELDS.values()],
            "applied_to": APPLIED_TO,
            "notice": NOTICE,
        }

    def save(self, project_id: str, request: AssetsRequest, actor, *, source_kind: str = "form",
             filename: str | None = None, original_text: str | None = None) -> dict:
        from .router import _forbid

        _forbid(actor, {"airport", "admin"}, "set project assets")
        entries = normalize(request.entries)
        try:
            apply_assets(CoupledConfig(), entries)
        except ValueError as exc:
            raise invalid(str(exc)) from exc
        content = {"entries": entries}
        sha = hashlib.sha256(_canonical(content).encode()).hexdigest()
        original_sha = (hashlib.sha256(original_text.encode("utf-8")).hexdigest()
                        if original_text is not None else None)
        row_id = str(uuid4())
        with self.store.pilot._connect() as connection:
            self.store._project(connection, project_id)
            connection.execute(
                "INSERT INTO project_assets(id, project_id, entries_json, content_sha256, "
                "source_kind, filename, original_text, original_sha256, note, created_by_json, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row_id, project_id, _canonical(entries), sha, source_kind, filename,
                 original_text, original_sha, request.note.strip(),
                 _canonical(actor.model_dump()), self.store.pilot._now()))
            self.store._audit(connection, project_id, "assets_set", row_id, actor, {
                "sha256": sha, "source_kind": source_kind, "filename": filename,
                "original_sha256": original_sha, "keys": sorted(e["key"] for e in entries)})
        return self.payload(project_id)

    def import_file(self, project_id: str, body: bytes, content_type: str, filename: str,
                    actor) -> dict:
        from .router import _forbid

        _forbid(actor, {"airport", "admin"}, "set project assets")
        if len(body) > MAX_IMPORT_BYTES:
            raise HTTPException(status_code=413, detail="invalid_assets: Datei größer als 256 KiB.")
        name = filename.strip().replace("\\", "/").rsplit("/", 1)[-1][:200]
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise invalid("Datei ist nicht UTF-8-kodiert.") from exc
        kind = ("json" if content_type == "application/json" or name.lower().endswith(".json")
                else "csv")
        entries = parse_json(text) if kind == "json" else parse_csv(text)
        return self.save(project_id, AssetsRequest(entries=entries, note=f"Import {name}"),
                         actor, source_kind=kind, filename=name or None, original_text=text)


def base_assets(asset_store: AssetStore | None, project_id: str,
                config: CoupledConfig) -> tuple[CoupledConfig, dict[str, Any]]:
    """Projektwerte auf die Varianten-Basis legen; Ergebnis plus Herkunftsangabe."""
    if asset_store is None:
        return config, {"applied": False, "keys": [], "sha256": None, "error": None}
    latest = asset_store.latest(project_id)
    if latest is None or not latest["entries"]:
        return config, {"applied": False, "keys": [], "sha256": None, "error": None}
    info = {"applied": True, "keys": sorted(e["key"] for e in latest["entries"]),
            "sha256": latest["sha256"], "status": data_status(latest["entries"]),
            "error": None}
    try:
        return apply_assets(config, latest["entries"]), info
    except ValueError as exc:
        return config, {**info, "applied": False, "error": str(exc)}
