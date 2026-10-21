"""Bemisst die Vorfeldflotte je Flughafen aus dem Modell und schreibt sie in den Steckbrief.

Je Klasse die kleinste Flotte, die mit Dieselfahrzeugen (ohne Ladebedarf) alle Einsaetze des
Tagesprofils rechtzeitig schafft, dazu derselbe Puffer wie im Beispielflughafen (dessen Flotte
geteilt durch seine eigene Mindestflotte). Ladepunkte im selben Verhaeltnis wie dort.

    cd backend && python scripts/size_airport_fleets.py [IATA ...]
"""
from __future__ import annotations

import json
import sys
from math import ceil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.exchange.airport_model import (  # noqa: E402
    FLEET_KINDS,
    airport_config,
    airport_day,
    minimal_fleet,
    scale,
)
from app.exchange.airport_spec import AIRPORTS_DIR, available_airports, load_spec  # noqa: E402
from app.exchange.electrification_reference import reference_config, reference_day  # noqa: E402
from app.exchange.variants import DEFAULT_SEED  # noqa: E402


def reference_buffer() -> tuple[dict[str, float], dict[str, float]]:
    config = reference_config()
    planned = {f.kind: f.vehicles for f in config.fleets}
    minimum = minimal_fleet(reference_day(), config, DEFAULT_SEED, {k: 200 for k in FLEET_KINDS})
    buffer = {k: planned[k] / minimum[k] if minimum[k] else 1.0 for k in FLEET_KINDS}
    chargers = {f.kind: f.chargers / f.vehicles for f in config.fleets}
    return buffer, chargers


def main() -> None:
    airports = sys.argv[1:] or available_airports()
    buffer, charger_ratio = reference_buffer()
    print("Puffer Beispielflughafen:", {k: round(v, 2) for k, v in buffer.items()})
    for airport in airports:
        spec = load_spec(airport)
        upper = {k: max(20, int(200 * scale(spec) * 1.5)) for k in FLEET_KINDS}
        start = {k: upper[k] for k in FLEET_KINDS}
        config = airport_config(spec, start, {k: 0 for k in FLEET_KINDS})
        minimum = minimal_fleet(airport_day(airport), config, DEFAULT_SEED, upper)
        if any(minimum[k] >= upper[k] for k in FLEET_KINDS):
            raise SystemExit(f"{airport}: Obergrenze erreicht, Suche erweitern: {minimum}")
        vehicles = {k: ceil(minimum[k] * buffer[k]) if minimum[k] else 0 for k in FLEET_KINDS}
        chargers = {k: max(1, ceil(vehicles[k] * charger_ratio[k])) if vehicles[k] else 0
                    for k in FLEET_KINDS}
        path = AIRPORTS_DIR / f"{airport}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["fleet"] = {
            "vehicles": vehicles, "chargers": chargers,
            "basis": {
                "text": ("Aus dem Modell bemessen: je Fahrzeugklasse die kleinste Flotte, die das "
                         "Tagesprofil mit Dieselfahrzeugen rechtzeitig schafft "
                         f"({', '.join(f'{k} {minimum[k]}' for k in FLEET_KINDS)}), dazu derselbe "
                         "Puffer wie im Beispielflughafen. Ladepunkte im selben Verhaeltnis "
                         "wie dort. Keine Angabe des Flughafens."),
                "sources": [], "assumption": True,
            },
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        load_spec.cache_clear()
        print(airport, "Mindestflotte", minimum, "Flotte", vehicles, "Ladepunkte", chargers)


if __name__ == "__main__":
    main()
