"""Referenz fuer die Live-Regler: genaue Backend-Rechnung gegen die Browser-Naeherung.

Baut einen vollen, synthetischen Verkehrstag (drei Abflugwellen), rechnet ihn genau fuer
mehrere Regler-Stellungen und schreibt Basis-Minutenreihen plus die genauen Kennzahlen nach
src/aec/model/__fixtures__/livePowerReference.json. Der Test livePower.test.ts vergleicht die
Naeherung damit. Neu erzeugen, wenn sich das Leistungsmodell aendert:

    cd backend && python scripts/make_live_power_fixture.py
"""

from __future__ import annotations

import json
import random
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.exchange.live import basis_from_series, departures_by_half_hour  # noqa: E402
from app.exchange.variants import STORAGE_GRID_CHARGE_SHARE  # noqa: E402
from app.munich.coupled_models import CoupledConfig, PowerConfig  # noqa: E402
from app.munich.coupled_simulator import simulate_coupled  # noqa: E402
from app.munich.coupled_world import build_world  # noqa: E402
from app.munich.flightplan import parse_pages  # noqa: E402

HEADER = """Flugplan Muenchen
L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename
Datenstand: 02.10.2026
Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag
"""
LIMIT_TOLERANCE_KW = 0.5
OUT = ROOT.parent / "src" / "aec" / "model" / "__fixtures__" / "livePowerReference.json"


def code(n: int) -> str:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return letters[n // 676 % 26] + letters[n // 26 % 26] + letters[n % 26]


def busy_day():
    """~330 Umlaeufe in drei Wellen; deterministisch (Seed 7)."""
    rng = random.Random(7)
    rows = []
    waves = [(6 * 60, 75, 120), (11 * 60 + 30, 60, 80), (17 * 60, 70, 110)]
    n = 0
    for center, spread, count in waves:
        for _ in range(count):
            dep = int(rng.gauss(center, spread / 2))
            dep = max(5 * 60, min(23 * 60, dep))
            arr = dep - rng.choice([45, 50, 55, 60, 70])
            n += 1
            rows.append(
                f"S XY {1000 + n} {arr // 60:02d}:{arr % 60:02d} {dep // 60:02d}:{dep % 60:02d} "
                f"1234567 {code(n)} 03.10.26 27.03.27 1 Test Air")
    return parse_pages([HEADER + "\n".join(rows)], date(2026, 10, 3), "b" * 64)


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


def main() -> None:
    plan = busy_day()
    base_power = PowerConfig(grid_import_limit_kw=3500)
    base_cfg = CoupledConfig(power=base_power)
    policy = "uncontrolled"
    world = build_world(plan, base_cfg, 42)
    base = simulate_coupled(world, plan, policy)
    cases = []
    levers = [
        {"grid_import_limit_kw": 2200}, {"grid_import_limit_kw": 2600},
        {"grid_import_limit_kw": 3000}, {"grid_import_limit_kw": 4000},
        {"grid_import_limit_kw": 4500}, {"grid_import_limit_kw": 5500},
        {"battery_capacity_kwh": 1000, "battery_power_kw": 500},
        {"battery_capacity_kwh": 2000, "battery_power_kw": 1000},
        {"battery_capacity_kwh": 4000, "battery_power_kw": 2000},
        {"pv_factor": 0.5}, {"pv_factor": 2.0},
        {"grid_import_limit_kw": 4000, "battery_capacity_kwh": 2000, "battery_power_kw": 1000},
    ]
    for lever in levers:
        values = base_power.model_dump(mode="json")
        values.pop("battery_grid_charge_below_kw", None)
        if "grid_import_limit_kw" in lever:
            values["grid_import_limit_kw"] = lever["grid_import_limit_kw"]
        if "battery_capacity_kwh" in lever:
            values.update(
                battery_capacity_kwh=lever["battery_capacity_kwh"],
                battery_power_kw=lever["battery_power_kw"],
                battery_initial_soc_pct=max(values["battery_reserve_pct"], 50.0),
                battery_grid_charge_below_kw=round(
                    values["grid_import_limit_kw"] * STORAGE_GRID_CHARGE_SHARE, 3),
            )
        if "pv_factor" in lever:
            values["pv_capacity_kwp"] = values["pv_capacity_kwp"] * lever["pv_factor"]
        cfg = CoupledConfig(power=PowerConfig(**values))
        exact = simulate_coupled(build_world(plan, cfg, 42), plan, policy)
        cases.append({"lever": lever, "exact": metrics(exact.series, world.day_minutes)})
    payload = {
        "note": "Synthetischer Verkehrstag; erzeugt von backend/scripts/make_live_power_fixture.py",
        "basis": basis_from_series(base.series, base_cfg, day_minutes=world.day_minutes,
                                   start_min=world.start_min, day_start_utc=world.day_start_utc,
                                   policy=policy, run_id=None),
        "departures": departures_by_half_hour(base)[0],
        "kpis": {
            "departures_total": len(base.departures),
            "delayed_departures": departures_by_half_hour(base)[1],
        },
        "base_exact": metrics(base.series, world.day_minutes),
        "cases": cases,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT.parent)}: {len(cases)} Faelle, "
          f"Basis {payload['base_exact']}, {OUT.stat().st_size // 1024} KB")
    for c in cases:
        print(c["lever"], c["exact"])


if __name__ == "__main__":
    main()
