"""Beispieltag und Referenz fuer die Live-Regler: genaue Backend-Rechnung gegen die Naeherung.

Rechnet den Beispieltag (backend/app/exchange/demo_day.py) und schreibt zwei Dateien:

- src/aec/beispieltag.json: der heutige Stand als Minutenreihen, Abflugbloecke und Kennzahlen.
  Das Beispielprojekt ohne Server zeigt genau diesen Tag.
- src/aec/model/__fixtures__/livePowerReference.json: die genauen Kennzahlen fuer viele
  Regler-Stellungen (`cases`: Anschluss, Batterie, PV, Kombinationen, Randwerte, nahe heute).
  Die Naeherung hat keine abgestimmten Konstanten (liveFleet.ts bildet die Regeln des Backends
  nach); die Faelle sind reine Pruefstellungen. livePower.test.ts vergleicht sie.

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
from app.exchange.situation import day_rows, minutes_at_limit  # noqa: E402
from app.exchange.variants import VariantChanges, apply_changes  # noqa: E402
from app.munich.coupled_simulator import simulate_coupled  # noqa: E402
from app.munich.coupled_world import build_world  # noqa: E402

SRC = ROOT.parent / "src" / "aec"
DAY_OUT = SRC / "beispieltag.json"
REFERENCE_OUT = SRC / "model" / "__fixtures__" / "livePowerReference.json"

G, BC, BP, PV = "grid_import_limit_kw", "battery_capacity_kwh", "battery_power_kw", "pv_factor"
# Pruefstellungen: Anschluss, Batterie (schwach/stark), PV, Kombinationen, Randwerte, nahe heute.
CASES = [
    {G: 1500}, {G: 1900}, {G: 2200}, {G: 2450}, {G: 2600}, {G: 2800}, {G: 3000}, {G: 3150},
    {G: 3300}, {G: 3430}, {G: 3490}, {G: 3580}, {G: 3650}, {G: 3800}, {G: 3950}, {G: 4000},
    {G: 4200}, {G: 4350}, {G: 4500}, {G: 4800}, {G: 5000}, {G: 5500}, {G: 7000}, {G: 8000},
    {BC: 500, BP: 250}, {BC: 900, BP: 300}, {BC: 1000, BP: 500}, {BC: 1200, BP: 600},
    {BC: 1500, BP: 750}, {BC: 2000, BP: 500}, {BC: 2000, BP: 1000}, {BC: 2500, BP: 625},
    {BC: 3000, BP: 1500}, {BC: 4000, BP: 2000}, {BC: 5000, BP: 2500}, {BC: 6000, BP: 3000},
    {PV: 0.0}, {PV: 0.25}, {PV: 0.5}, {PV: 0.75}, {PV: 0.97}, {PV: 1.5}, {PV: 2.0}, {PV: 3.0},
    {G: 2600, PV: 2.0}, {G: 3200, PV: 0.75}, {G: 3400, PV: 0.25}, {G: 3800, PV: 0.5},
    {G: 4600, PV: 0.0}, {G: 2700, PV: 2.5},
    {G: 3000, BC: 1000, BP: 500}, {G: 3000, BC: 3000, BP: 1500}, {G: 2900, BC: 1800, BP: 900},
    {G: 3250, BC: 600, BP: 300}, {G: 4000, BC: 2000, BP: 1000}, {G: 5000, BC: 4000, BP: 2000},
    {G: 1500, BC: 6000, BP: 3000}, {G: 8000, BC: 6000, BP: 3000},
    {G: 4000, BC: 1000, BP: 500, PV: 0.5}, {G: 3700, BC: 750, BP: 375, PV: 0.6},
    {G: 2400, BC: 2200, BP: 1100, PV: 1.25}, {G: 3300, BC: 3500, BP: 1750, PV: 0.4},
    {G: 3100, BC: 400, BP: 400, PV: 1.5}, {G: 3550, BC: 1000, BP: 250, PV: 0.8},
]


def metrics(series, day_minutes):
    day = day_rows(series, day_minutes)
    missing = [max(0.0, r.get("charging_requested_kw", 0.0)
                   - r["ground_charging_kw"] - r["parking_kw"]) for r in day]
    return {
        "minutes_at_limit": minutes_at_limit(series, day_minutes),
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


def build() -> tuple[dict, dict]:
    """Beispieltag und Referenzstellungen als JSON-faehige Daten (nichts wird geschrieben)."""
    plan = busy_day()
    base_cfg = heute_config()
    policy = "uncontrolled"
    world = build_world(plan, base_cfg, SEED)
    base = simulate_coupled(world, plan, policy)
    cases = [run(plan, base_cfg, policy, lever, world.day_minutes) for lever in CASES]
    departures, delayed = departures_by_half_hour(base)
    note = f"{TITLE}; erzeugt von backend/scripts/make_live_power_fixture.py"
    day = {
        "note": note,
        "basis": basis_from_series(base.series, base_cfg, world=world,
                                   day_minutes=world.day_minutes,
                                   start_min=world.start_min, day_start_utc=world.day_start_utc,
                                   policy=policy, run_id=None),
        "departures": departures,
        "kpis": {"departures_total": len(base.departures), "delayed_departures": delayed},
    }
    reference = {"note": note, "base_exact": metrics(base.series, world.day_minutes),
                 "cases": cases}
    return day, reference


def main() -> None:
    day, reference = build()
    REFERENCE_OUT.parent.mkdir(parents=True, exist_ok=True)
    for out, payload in ((DAY_OUT, day), (REFERENCE_OUT, reference)):
        out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    kpis = day["kpis"]
    print(f"{DAY_OUT.relative_to(ROOT.parent)} ({DAY_OUT.stat().st_size // 1024} KB), "
          f"{REFERENCE_OUT.relative_to(ROOT.parent)}: {len(reference['cases'])} Faelle, "
          f"{kpis['departures_total']} Abfluege ({kpis['delayed_departures']} nicht rechtzeitig), "
          f"Basis {reference['base_exact']}")


if __name__ == "__main__":
    main()
