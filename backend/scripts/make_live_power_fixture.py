"""Beispieltag und Referenz fuer die Live-Regler: genaue Backend-Rechnung gegen die Naeherung.

Rechnet den Beispieltag (backend/app/exchange/demo_day.py) und schreibt zwei Dateien:

- src/aec/beispieltag.json: der heutige Stand als Minutenreihen, Abflugbloecke und Kennzahlen.
  Das Beispielprojekt ohne Server zeigt genau diesen Tag.
- src/aec/model/__fixtures__/livePowerReference.json: die genauen Kennzahlen fuer viele
  Regler-Stellungen. `cases` stimmen die Naeherung ab, `holdout` prueft sie an Stellungen, die
  beim Abstimmen nicht gesehen wurden. livePower.test.ts vergleicht beides.

Neu erzeugen, wenn sich Modell oder Beispieltag aendern:

    cd backend && python scripts/make_live_power_fixture.py

Die Regler gehen ueber dieselbe Funktion wie die Vorschau (variants.apply_changes).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.exchange.demo_day import SEED, TITLE, busy_day, heute_config  # noqa: E402
from app.exchange.live import basis_from_series, departures_by_half_hour  # noqa: E402
from app.exchange.variants import VariantChanges, apply_changes  # noqa: E402
from app.munich.coupled_simulator import simulate_coupled  # noqa: E402
from app.munich.coupled_world import build_world  # noqa: E402

LIMIT_TOLERANCE_KW = 0.5
SRC = ROOT.parent / "src" / "aec"
DAY_OUT = SRC / "beispieltag.json"
REFERENCE_OUT = SRC / "model" / "__fixtures__" / "livePowerReference.json"

# Zum Abstimmen der Naeherung.
CASES = [
    {"grid_import_limit_kw": 2200}, {"grid_import_limit_kw": 2600},
    {"grid_import_limit_kw": 3000}, {"grid_import_limit_kw": 4000},
    {"grid_import_limit_kw": 4500}, {"grid_import_limit_kw": 5500},
    {"battery_capacity_kwh": 1000, "battery_power_kw": 500},
    {"battery_capacity_kwh": 2000, "battery_power_kw": 1000},
    {"battery_capacity_kwh": 4000, "battery_power_kw": 2000},
    {"pv_factor": 0.5}, {"pv_factor": 2.0},
    {"grid_import_limit_kw": 4000, "battery_capacity_kwh": 2000, "battery_power_kw": 1000},
]
# Nur zum Pruefen: andere Stellen der Regler, Kombinationen, schwache und starke Batterien.
HOLDOUT = [
    {"grid_import_limit_kw": 2800}, {"grid_import_limit_kw": 3300},
    {"grid_import_limit_kw": 3800}, {"grid_import_limit_kw": 4200},
    {"grid_import_limit_kw": 5000}, {"grid_import_limit_kw": 7000},
    {"battery_capacity_kwh": 500, "battery_power_kw": 250},
    {"battery_capacity_kwh": 1500, "battery_power_kw": 750},
    {"battery_capacity_kwh": 3000, "battery_power_kw": 1500},
    {"battery_capacity_kwh": 6000, "battery_power_kw": 3000},
    {"battery_capacity_kwh": 2000, "battery_power_kw": 500},
    {"pv_factor": 0.0}, {"pv_factor": 1.5},
    {"grid_import_limit_kw": 3000, "battery_capacity_kwh": 1000, "battery_power_kw": 500},
    {"grid_import_limit_kw": 3000, "battery_capacity_kwh": 3000, "battery_power_kw": 1500},
    {"grid_import_limit_kw": 2600, "pv_factor": 2.0},
    {"grid_import_limit_kw": 4000, "battery_capacity_kwh": 1000, "battery_power_kw": 500,
     "pv_factor": 0.5},
    {"grid_import_limit_kw": 5000, "battery_capacity_kwh": 4000, "battery_power_kw": 2000},
]


def metrics(series, day_minutes):
    day = [r for r in series if 0 <= r["minute"] - 1 < day_minutes]
    at_limit = sum(1 for r in day if r["effective_grid_cap_kw"] > 0
                   and r["grid_import_kw"] >= r["effective_grid_cap_kw"] - LIMIT_TOLERANCE_KW)
    missing = [max(0.0, r.get("charging_requested_kw", 0.0)
                   - r["ground_charging_kw"] - r["parking_kw"]) for r in day]
    return {
        "minutes_at_limit": at_limit,
        "peak_import_kw": round(max(r["grid_import_kw"] for r in day), 3),
        "max_missing_kw": round(max(missing), 3),
        "missing_kwh": round(sum(missing) / 60, 3),
    }


def changes_for(lever: dict) -> VariantChanges:
    out = {}
    if "grid_import_limit_kw" in lever:
        out["grid_import_limit_kw"] = lever["grid_import_limit_kw"]
    if "battery_capacity_kwh" in lever:
        out["storage_kwh"] = lever["battery_capacity_kwh"]
        out["storage_kw"] = lever["battery_power_kw"]
    if "pv_factor" in lever:
        out["pv_factor"] = lever["pv_factor"]
    return VariantChanges.model_validate(out)


def run(plan, base_cfg, policy, lever, day_minutes):
    cfg, pol, _ = apply_changes(base_cfg, policy, changes_for(lever), day_minutes)
    result = simulate_coupled(build_world(plan, cfg, SEED), plan, pol)
    return {"lever": lever, "exact": metrics(result.series, day_minutes)}


def main() -> None:
    plan = busy_day()
    base_cfg = heute_config()
    policy = "uncontrolled"
    world = build_world(plan, base_cfg, SEED)
    base = simulate_coupled(world, plan, policy)
    cases = [run(plan, base_cfg, policy, lever, world.day_minutes) for lever in CASES]
    holdout = [run(plan, base_cfg, policy, lever, world.day_minutes) for lever in HOLDOUT]
    departures, delayed = departures_by_half_hour(base)
    note = f"{TITLE}; erzeugt von backend/scripts/make_live_power_fixture.py"
    day = {
        "note": note,
        "basis": basis_from_series(base.series, base_cfg, day_minutes=world.day_minutes,
                                   start_min=world.start_min, day_start_utc=world.day_start_utc,
                                   policy=policy, run_id=None),
        "departures": departures,
        "kpis": {"departures_total": len(base.departures), "delayed_departures": delayed},
    }
    reference = {"note": note, "base_exact": metrics(base.series, world.day_minutes),
                 "cases": cases, "holdout": holdout}
    REFERENCE_OUT.parent.mkdir(parents=True, exist_ok=True)
    for out, payload in ((DAY_OUT, day), (REFERENCE_OUT, reference)):
        out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{DAY_OUT.relative_to(ROOT.parent)} ({DAY_OUT.stat().st_size // 1024} KB), "
          f"{REFERENCE_OUT.relative_to(ROOT.parent)}: {len(cases)}+{len(holdout)} Faelle, "
          f"{len(base.departures)} Abfluege ({delayed} nicht rechtzeitig), "
          f"Basis {reference['base_exact']}")

if __name__ == "__main__":
    main()
