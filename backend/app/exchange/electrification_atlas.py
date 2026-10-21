"""Vorab gerechnete Anschlussstufen des Beispielflughafens fuer die Live-Regler.

Die Werte sind echte Modellrechnungen (dieselbe Raster-Suche wie im Vergleich), einmal fuer
alle Reglerstufen gerechnet von scripts/make_electrification_atlas.py. Liegt eine Stellung
auf dem Raster, antwortet der Vergleich sofort; sonst rechnet er wie bisher. Passt die
Datei nicht mehr zum Modell (Engine, Referenz oder Speicherregel geaendert), wird sie nicht
benutzt.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ..munich.coupled_models import PREDICTIVE_ENGINE_VERSION
from .electrification_reference import REFERENCE_ID, STORAGE_RULE
from .grid_sizing import GRID_MAX_KW, GRID_STEP_KW

ATLAS_PATH = Path(__file__).resolve().parent / "data" / "electrification_atlas.json"
AXES = {
    "electric_share_pct": list(range(0, 101, 10)),
    "storage_kwh": list(range(0, 6001, 500)),
    "pv_kwp": [0, 500, 1000, 2000, 4000],
    "parking_sessions": [0, 40, 100, 200],
}
SOLUTIONS = ("direct", "managed", "managed_storage")


def atlas_key(share: int, storage: float, pv: float, parking: int) -> str:
    return f"{int(share)}|{int(storage)}|{int(pv)}|{int(parking)}"


def peak_key(share: int, pv: float, parking: int) -> str:
    """Laden ohne Steuerung haengt nicht vom Speicher ab."""
    return f"{int(share)}|{int(pv)}|{int(parking)}"


@lru_cache(maxsize=1)
def load_atlas() -> dict | None:
    try:
        data = json.loads(ATLAS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if (data.get("engine_version") != PREDICTIVE_ENGINE_VERSION
            or data.get("reference_id") != REFERENCE_ID
            or data.get("storage_rule") != STORAGE_RULE
            or data.get("grid_step_kw") != GRID_STEP_KW or data.get("grid_max_kw") != GRID_MAX_KW
            or data.get("axes") != AXES):
        return None
    return data


def atlas_sizes(share: int, storage: float, pv: float, parking: int) -> dict | None:
    """Antwort im Format von grid_sizing.search_connection, oder None ausserhalb des Rasters."""
    data = load_atlas()
    if data is None or any(float(v) != int(v) for v in (storage, pv)):
        return None
    entry = data["entries"].get(atlas_key(share, storage, pv, parking))
    if entry is None:
        return None
    return {
        solution: {"status": status, "required_grid_kw": required, "step_kw": GRID_STEP_KW,
                   "max_kw": GRID_MAX_KW, "evaluations": [], "source": "atlas"}
        for solution, (status, required) in zip(SOLUTIONS, entry)
    }


def public_atlas() -> dict:
    """Kompakte Tabelle fuer den Browser: je Stellung der Bedarf der drei Ladeloesungen in kW,
    dazu je Flotte, PV und Parkhaus der Bedarf ganz ohne Steuerung (peaks)."""
    data = load_atlas()
    if data is None or not data.get("peaks"):
        return {"available": False}
    return {
        "available": True, "engine_version": data["engine_version"],
        "reference_id": data["reference_id"], "grid_step_kw": data["grid_step_kw"],
        "grid_max_kw": data["grid_max_kw"], "axes": data["axes"], "solutions": list(SOLUTIONS),
        "entries": {k: [required for _, required in v] for k, v in data["entries"].items()},
        "peaks": {k: required for k, (_, required) in data["peaks"].items()},
        "evidence_level": "synthetic_uncalibrated",
    }
