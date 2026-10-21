"""Vorab gerechnete Anschlussstufen des Beispielflughafens fuer die Live-Regler.

Die Werte sind echte Modellrechnungen (dieselbe Raster-Suche wie im Vergleich), einmal fuer
alle Reglerstufen gerechnet von scripts/make_electrification_atlas.py. Liegt eine Stellung
auf dem Raster, antwortet der Vergleich sofort; sonst rechnet er wie bisher. Passt die
Datei nicht mehr zum Modell (Engine oder Referenz geaendert), wird sie nicht benutzt.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from ..munich.coupled_models import CYCLIC_ENGINE_VERSION
from .airport_model import AIRPORT_MODEL_VERSION, grid_raster, storage_axis
from .airport_spec import load_spec
from .demo import _canonical_hash
from .electrification_reference import REFERENCE_ID, reference_config
from .grid_sizing import GRID_MAX_KW, GRID_STEP_KW

ATLAS_PATH = Path(__file__).resolve().parent / "data" / "electrification_atlas.json"
# Je Flughafen eine Tabelle: data/atlas/<IATA>.json.
ATLAS_DIR = Path(os.environ.get("TWIN_ATLAS_DIR")
                 or Path(__file__).resolve().parent / "data" / "atlas")
AXES = {
    "electric_share_pct": list(range(0, 101, 10)),
    "storage_kwh": list(range(0, 6001, 500)),
    "pv_kwp": [0, 500, 1000, 2000, 4000],
    "parking_sessions": [0, 40, 100, 200],
}
SOLUTIONS = ("direct", "managed", "managed_storage")


def axes_for(airport: str | None) -> dict:
    if airport is None:
        return AXES
    spec = load_spec(airport)
    return {
        "electric_share_pct": list(range(0, 101, 10)),
        "storage_kwh": storage_axis(spec),
        # Die PV des Flughafens steckt schon in der Reserve; Parkhaus aus oder wie veroeffentlicht.
        "pv_kwp": [0],
        "parking_sessions": sorted({0, spec.parking_sessions_per_day}),
    }


def reference_id_for(airport: str | None) -> str:
    """Kennung des Modells; aendert sich mit allem, was die Rechnung des Flughafens treibt."""
    if airport is None:
        return REFERENCE_ID
    spec = load_spec(airport)
    model = spec.model_dump(include={"departures_per_day", "departures_by_hour",
                                     "arrivals_by_hour", "coverage_pct",
                                     "parking_sessions_per_day", "fleet"})
    model["fleet"] = {k: v for k, v in (model["fleet"] or {}).items() if k != "basis"}
    # Fahrzeugdaten kommen aus dem Beispielflughafen: aendert der sich, gilt die Tabelle nicht mehr.
    model["reference"] = [REFERENCE_ID, _canonical_hash(reference_config().model_dump(mode="json"))]
    return f"{AIRPORT_MODEL_VERSION}:{airport}:{_canonical_hash(model)[:16]}"


def raster_for(airport: str | None) -> tuple[int, int]:
    return (GRID_STEP_KW, GRID_MAX_KW) if airport is None else grid_raster(load_spec(airport))


def path_for(airport: str | None) -> Path:
    return ATLAS_PATH if airport is None else ATLAS_DIR / f"{airport}.json"


def atlas_key(share: int, storage: float, pv: float, parking: int) -> str:
    return f"{int(share)}|{int(storage)}|{int(pv)}|{int(parking)}"


def peak_key(share: int, pv: float, parking: int) -> str:
    """Laden ohne Steuerung haengt nicht vom Speicher ab."""
    return f"{int(share)}|{int(pv)}|{int(parking)}"


@lru_cache(maxsize=32)
def load_atlas(airport: str | None = None) -> dict | None:
    try:
        data = json.loads(path_for(airport).read_text(encoding="utf-8"))
        step, top = raster_for(airport)
        expected = (reference_id_for(airport), axes_for(airport))
    except (OSError, ValueError, KeyError):
        return None
    if (data.get("engine_version") != CYCLIC_ENGINE_VERSION
            or data.get("reference_id") != expected[0]
            or data.get("grid_step_kw") != step or data.get("grid_max_kw") != top
            or data.get("axes") != expected[1]):
        return None
    return data


def atlas_sizes(share: int, storage: float, pv: float, parking: int,
                airport: str | None = None) -> dict | None:
    """Antwort im Format von grid_sizing.search_connection, oder None ausserhalb des Rasters."""
    data = load_atlas(airport)
    if data is None or any(float(v) != int(v) for v in (storage, pv)):
        return None
    entry = data["entries"].get(atlas_key(share, storage, pv, parking))
    if entry is None:
        return None
    step, top = raster_for(airport)
    out = {
        solution: {"status": cell[0], "required_grid_kw": cell[1], "step_kw": step,
                   "max_kw": top, "evaluations": [], "source": "atlas"}
        for solution, cell in zip(SOLUTIONS, entry)
    }
    # Dritter Wert der Speicherspalte: "off", wenn der Speicher dort ausgeschaltet bleibt.
    out["managed_storage"]["storage_mode"] = (entry[2][2] if len(entry[2]) > 2 else "on")
    return out


def public_atlas(airport: str | None = None) -> dict:
    """Kompakte Tabelle fuer den Browser: je Stellung der Bedarf der drei Ladeloesungen in kW,
    dazu je Flotte, PV und Parkhaus der Bedarf ganz ohne Steuerung (peaks)."""
    data = load_atlas(airport)
    if data is None or not data.get("peaks"):
        return {"available": False}
    return {
        "available": True, "engine_version": data["engine_version"],
        "reference_id": data["reference_id"], "grid_step_kw": data["grid_step_kw"],
        "airport": airport,
        "grid_max_kw": data["grid_max_kw"], "axes": data["axes"], "solutions": list(SOLUTIONS),
        "entries": {k: [cell[1] for cell in v] for k, v in data["entries"].items()},
        "peaks": {k: required for k, (_, required) in data["peaks"].items()},
        "evidence_level": "synthetic_uncalibrated",
    }
