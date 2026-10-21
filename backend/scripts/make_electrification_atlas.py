"""Rechnet die Anschlussstufen des Beispielflughafens fuer alle Reglerstufen vorab.

Ergebnis: backend/app/exchange/data/electrification_atlas.json (siehe electrification_atlas.py).
Laeuft parallel auf allen Kernen; auf einem Laptop rund ein bis zwei Stunden.
Neu erzeugen, wenn sich Modell, Referenz oder Raster aendern:

    cd backend && python scripts/make_electrification_atlas.py

Mit --peaks-only werden nur die Werte ohne Steuerung in eine vorhandene Datei ergaenzt
(wenige Minuten). Mit --airport FRA rechnet es die Tabelle eines echten Flughafens
(data/atlas/FRA.json, Achsen und Raster aus dem Steckbrief).
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
from app.exchange.electrification_atlas import (  # noqa: E402
    atlas_key,
    axes_for,
    path_for,
    peak_key,
    raster_for,
    reference_id_for,
)
from app.munich.coupled_models import PREDICTIVE_ENGINE_VERSION  # noqa: E402


def _short(result: dict) -> list:
    return [result["status"], result["required_grid_kw"]]


def group(share: int, pv: int, parking: int, airport: str | None = None) -> dict:
    """Direkt und vorausschauend einmal, mit Speicher fuer jede Speicherstufe."""
    direct = _short(size_solution("direct", share, 0, pv, parking, airport))
    managed = _short(size_solution("managed", share, 0, pv, parking, airport))
    out = {}
    for storage in axes_for(airport)["storage_kwh"]:
        with_storage = managed if storage == 0 else _short(
            size_solution("managed_storage", share, storage, pv, parking, airport))
        out[atlas_key(share, storage, pv, parking)] = [direct, managed, with_storage]
    return out


def peak(share: int, pv: int, parking: int, airport: str | None = None) -> dict:
    return {peak_key(share, pv, parking): _short(
        uncontrolled_need(share, pv, parking, airport)["grid_sizing"])}


def run(task, groups: list[tuple[int, int, int]], airport: str | None = None) -> dict:
    started, out = time.perf_counter(), {}
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1)) as pool:
        futures = [pool.submit(task, *g, airport) for g in groups]
        for done, future in enumerate(as_completed(futures), 1):
            out.update(future.result())
            print(f"{done}/{len(groups)} Gruppen, {time.perf_counter() - started:.0f} s",
                  flush=True)
    return dict(sorted(out.items()))


def main() -> None:
    airport = sys.argv[sys.argv.index("--airport") + 1] if "--airport" in sys.argv else None
    axes, (step, top), path = axes_for(airport), raster_for(airport), path_for(airport)
    groups = list(product(axes["electric_share_pct"], axes["pv_kwp"], axes["parking_sessions"]))
    if "--peaks-only" in sys.argv:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (payload.get("axes") != axes
                or payload.get("engine_version") != PREDICTIVE_ENGINE_VERSION):
            raise SystemExit("Vorhandene Datei passt nicht zum Modell; ganz neu rechnen.")
    else:
        payload = {"engine_version": PREDICTIVE_ENGINE_VERSION,
                   "reference_id": reference_id_for(airport),
                   "grid_step_kw": step, "grid_max_kw": top, "axes": axes,
                   "entries": run(group, groups, airport)}
    payload["peaks"] = run(peak, groups, airport)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    shown = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    print(f"{shown}: {len(payload['entries'])} Stellungen, "
          f"{len(payload['peaks'])} ohne Steuerung, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
