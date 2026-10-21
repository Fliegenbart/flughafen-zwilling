"""Rechnet die Anschlussstufen des Beispielflughafens fuer alle Reglerstufen vorab.

Ergebnis: backend/app/exchange/data/electrification_atlas.json (siehe electrification_atlas.py).
Laeuft parallel auf allen Kernen; auf einem Laptop rund ein bis zwei Stunden.
Neu erzeugen, wenn sich Modell, Referenz, Speicherregel oder Raster aendern:

    cd backend && python scripts/make_electrification_atlas.py

Mit --peaks-only werden nur die Werte ohne Steuerung in eine vorhandene Datei ergaenzt
(wenige Minuten).
"""
from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.exchange.electrification import size_solution, uncontrolled_need  # noqa: E402
from app.exchange.electrification_atlas import ATLAS_PATH, AXES, atlas_key, peak_key  # noqa: E402
from app.exchange.electrification_reference import REFERENCE_ID, STORAGE_RULE  # noqa: E402
from app.exchange.grid_sizing import GRID_MAX_KW, GRID_STEP_KW  # noqa: E402
from app.munich.coupled_models import PREDICTIVE_ENGINE_VERSION  # noqa: E402


def _short(result: dict) -> list:
    return [result["status"], result["required_grid_kw"]]


def group(share: int, pv: int, parking: int) -> dict:
    """Direkt und vorausschauend einmal, mit Speicher fuer jede Speicherstufe."""
    direct = _short(size_solution("direct", share, 0, pv, parking))
    without = size_solution("managed", share, 0, pv, parking)
    managed = _short(without)
    out = {}
    for storage in AXES["storage_kwh"]:
        with_storage = managed if storage == 0 else _short(size_solution(
            "managed_storage", share, storage, pv, parking, without_storage=without))
        out[atlas_key(share, storage, pv, parking)] = [direct, managed, with_storage]
    return out


def peak(share: int, pv: int, parking: int) -> dict:
    return {peak_key(share, pv, parking): _short(
        uncontrolled_need(share, pv, parking)["grid_sizing"])}


def run(task, groups: list[tuple[int, int, int]]) -> dict:
    started, out = time.perf_counter(), {}
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1)) as pool:
        futures = [pool.submit(task, *g) for g in groups]
        for done, future in enumerate(as_completed(futures), 1):
            out.update(future.result())
            print(f"{done}/{len(groups)} Gruppen, {time.perf_counter() - started:.0f} s",
                  flush=True)
    return dict(sorted(out.items()))


def main() -> None:
    groups = list(product(AXES["electric_share_pct"], AXES["pv_kwp"], AXES["parking_sessions"]))
    if "--peaks-only" in sys.argv:
        payload = json.loads(ATLAS_PATH.read_text(encoding="utf-8"))
        if (payload.get("axes") != AXES
                or payload.get("engine_version") != PREDICTIVE_ENGINE_VERSION
                or payload.get("storage_rule") != STORAGE_RULE):
            raise SystemExit("Vorhandene Datei passt nicht zum Modell; ganz neu rechnen.")
    else:
        payload = {"engine_version": PREDICTIVE_ENGINE_VERSION, "reference_id": REFERENCE_ID,
                   "storage_rule": STORAGE_RULE, "grid_step_kw": GRID_STEP_KW,
                   "grid_max_kw": GRID_MAX_KW, "axes": AXES, "entries": run(group, groups)}
    payload["peaks"] = run(peak, groups)
    ATLAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ATLAS_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{ATLAS_PATH.relative_to(ROOT)}: {len(payload['entries'])} Stellungen, "
          f"{len(payload['peaks'])} ohne Steuerung, {ATLAS_PATH.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
