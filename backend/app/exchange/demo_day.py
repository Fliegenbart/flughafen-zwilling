"""Der Beispieltag fuer Vorfuehrung, Tests und die Browser-Referenz.

ERFUNDEN, keine Messdaten. Der Tag soll eine Geschichte erzaehlen, die man im Kundentermin
nachvollziehen kann: Der Netzanschluss reicht tagsueber fast, wird aber in zwei Phasen knapp
(frueh vor der Hauptwelle und abends nach Sonnenuntergang), und eine Batterie oder mehr
Anschluss loest das. Alle Abweichungen vom Modellstandard stehen hier und sind Annahmen.

Gemessen mit simulate_coupled (Seed 42, Regel "uncontrolled"): 205 Abfluege, Heute (3,5 MW,
keine Batterie) fehlt in 184 Minuten Ladeleistung, 33 Abfluege nicht rechtzeitig fertig; mit
2 MWh / 1 MW Batterie oder 4,5 MW Anschluss bleiben 2 Minuten mit 154 kW und 6 Abfluege.
"""

from __future__ import annotations

import random
from datetime import date

from ..munich.coupled_models import CoupledConfig, PowerConfig, default_fleets
from ..munich.flightplan import parse_pages

HEADER = """Flugplan Muenchen
L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename
Datenstand: 02.10.2026
Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag
"""
SERVICE_DATE = date(2026, 10, 3)
SEED = 42
# Abflugwellen: (Mitte, Streuung, Anzahl); Minuten seit Mitternacht, Ortszeit.
WAVES = [(7 * 60, 55, 95), (12 * 60, 40, 35), (18 * 60, 40, 75)]
TITLE = "Beispieltag (erfunden)"


def _code(n: int) -> str:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return letters[n // 676 % 26] + letters[n // 26 % 26] + letters[n % 26]


def busy_day():
    """205 Abfluege in drei Wellen; deterministisch (Seed 7).

    Abflugzeiten sind normalverteilte Zufallswerte um die Wellenmitten, auf 5 Minuten
    gerundet wie im Saisonflugplan. Spalte 1 ist die Abflugzeit ab MUC (die das Modell
    verwendet), Spalte 2 die Ankunft an der Gegenstelle.
    """
    rng = random.Random(7)
    times = []
    for center, spread, count in WAVES:
        for _ in range(count):
            dep = int(round(rng.gauss(center, spread)))
            dep = max(4 * 60, min(22 * 60 + 30, dep))
            times.append(int(round(dep / 5) * 5))
    times.sort()
    rows = []
    for n, dep in enumerate(times, 1):
        arr = dep + 60
        rows.append(
            f"S XY {1000 + n} {dep // 60:02d}:{dep % 60:02d} {arr // 60:02d}:{arr % 60:02d} "
            f"1234567 {_code(n)} 03.10.26 27.03.27 1 Test Air")
    return parse_pages([HEADER + "\n".join(rows)], SERVICE_DATE, "b" * 64)


def heute_fleets():
    """Standardflotte, an den Beispieltag angepasst; alles uebrige bleibt Standard.

    Annahmen: 20 Pushback-Schlepper mit 8 Ladepunkten (Standard 10/4); 26 Bodenstromgeraete mit
    80-kW-Ladern, 100-kWh-Akku und 35 kWh je Einsatz (Mix aus Schmal- und Grossraum mit
    Klimatisierung; Standard 35 Geraete, 50 kW, 150 kWh, 20 kWh).
    """
    fleets = default_fleets()
    for fleet in fleets:
        if fleet.kind == "pushback_tug":
            fleet.vehicles, fleet.chargers = 20, 8
        elif fleet.kind == "gpu":
            fleet.vehicles, fleet.chargers = 26, 10
            fleet.charger_kw = 80
            fleet.battery_capacity_kwh = 100
            fleet.mission_energy_kwh = 35
    return fleets


def heute_power(**overrides) -> PowerConfig:
    """Heutiger Stand: 3,5 MW Anschluss, keine Batterie.

    Annahmen: Blockheizkraftwerk im Teillastbetrieb mit 17,4 MW (Standard 18,0 MW) und
    100 statt 200 Ladevorgaenge im Parkhaus. Das BHKW traegt die Geschichte: mit 18,0 MW
    waeren nur 8 statt 33 Abfluege nicht rechtzeitig fertig.
    """
    values = dict(grid_import_limit_kw=3500, chp_output_kw=17400, parking_sessions=100)
    values.update(overrides)
    return PowerConfig(**values)


def heute_config(**power_overrides) -> CoupledConfig:
    return CoupledConfig(power=heute_power(**power_overrides), fleets=heute_fleets())
