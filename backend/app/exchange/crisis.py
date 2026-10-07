"""Krisenfaelle der Szenario-Bibliothek als Energie-Stresstest fuer Varianten.

Die acht Faelle sind Abfertigungsstoerungen (Positionen, Slots, Personal, Enteisung). Das
gekoppelte Energiemodell kennt davon nichts; es kennt Netzgrenzen je Zeitfenster, Ladepunkt-
ausfaelle je Flotte, PV-Leistung und Akkukapazitaet. Jeder Fall wird deshalb in ein offen
ausgewiesenes Buendel solcher Stoerungen uebersetzt. Das ist eine **Annahme**, keine
Ableitung: die Nachfrage (Auftraege) bleibt eingefroren, damit alle Varianten unter
demselben Stress vergleichbar bleiben. Zeitfenster in lokalen Minuten ab Mitternacht.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..munich.coupled_models import CoupledConfig, FleetKind

H = 60


@dataclass(frozen=True)
class GridCut:
    start_min: int
    end_min: int
    factor: float  # verbleibender Anteil der Netzimportgrenze


@dataclass(frozen=True)
class ChargerOutage:
    start_min: int
    end_min: int
    share: float  # Anteil der Ladepunkte offline
    kinds: tuple[FleetKind, ...] | None = None  # None = alle Flotten
    minimum: int = 0  # mindestens so viele je Flotte (z. B. "2 je Flotte")


@dataclass(frozen=True)
class CrisisStress:
    name: str
    assumption: str
    grid: tuple[GridCut, ...] = ()
    chargers: tuple[ChargerOutage, ...] = ()
    pv_factor: float | None = None
    battery_factor: float | None = None


CRISIS_STRESS: dict[str, CrisisStress] = {
    "airport_case_01_spitzenwelle_v1": CrisisStress(
        "Spitzenwelle",
        "Blockierte Positionen binden Ladepunkte: je Flotte 2 Ladepunkte offline 06–09 Uhr.",
        chargers=(ChargerOutage(6 * H, 9 * H, 0.0, minimum=2),),
    ),
    "airport_case_02_guillotine_v1": CrisisStress(
        "Guillotine",
        "Gleichzeitiger Einbruch: Netzimport −30 % und 25 % der Ladepunkte offline 07–11 Uhr.",
        grid=(GridCut(7 * H, 11 * H, 0.7),),
        chargers=(ChargerOutage(7 * H, 11 * H, 0.25),),
    ),
    "airport_case_03_wetter_kompression_v1": CrisisStress(
        "Wetter",
        "Bewölkung und kürzere Ladefenster: PV ×0,4 ganztags, Netzimport −10 % ganztags.",
        grid=(GridCut(0, 24 * H, 0.9),),
        pv_factor=0.4,
    ),
    "airport_case_04_gepaeckstau_v1": CrisisStress(
        "Gepäckstau",
        "Gepäckschlepper stehen im Stau statt am Lader: 30 % ihrer Ladepunkte offline 08–14 Uhr.",
        chargers=(ChargerOutage(8 * H, 14 * H, 0.3, kinds=("baggage_tractor",)),),
    ),
    "airport_case_05_personalengpass_v1": CrisisStress(
        "Personal",
        "Niemand steckt um: 20 % aller Ladepunkte ganztags ungenutzt.",
        chargers=(ChargerOutage(0, 24 * H, 0.2),),
    ),
    "airport_case_06_sicherheitswelle_v1": CrisisStress(
        "Sicherheit",
        "Busse warten an der Position: 25 % der Bus-Ladepunkte offline 10–16 Uhr.",
        chargers=(ChargerOutage(10 * H, 16 * H, 0.25, kinds=("bus",)),),
    ),
    "airport_case_07_enteisungsfenster_v1": CrisisStress(
        "Enteisung",
        "Kälte: Akkukapazität aller Fahrzeuge −20 %, PV ×0,3, Netzimport −15 % 05–09 Uhr.",
        grid=(GridCut(5 * H, 9 * H, 0.85),),
        pv_factor=0.3,
        battery_factor=0.8,
    ),
    "airport_case_08_schwarzstart_v1": CrisisStress(
        "Schwarzstart",
        "Gestufter Wiederanlauf: Netzimport −60 % 00–02 Uhr, −30 % 02–04 Uhr, −10 % 04–06 Uhr.",
        grid=(GridCut(0, 2 * H, 0.4), GridCut(2 * H, 4 * H, 0.7), GridCut(4 * H, 6 * H, 0.9)),
    ),
}


def crisis_stress(scenario_id: str) -> CrisisStress:
    try:
        return CRISIS_STRESS[scenario_id]
    except KeyError as exc:
        raise ValueError(f"Unbekannter Krisenfall: {scenario_id}") from exc


def crisis_config(config: CoupledConfig, scenario_id: str, day_minutes: int) -> CoupledConfig:
    """Basis- oder Variantenkonfiguration unter dem Energie-Abbild eines Krisenfalls."""
    stress = crisis_stress(scenario_id)
    values = config.model_dump(mode="json")
    limit = config.power.grid_import_limit_kw

    def window(start: int, end: int) -> tuple[int, int] | None:
        # Sommer-/Winterzeittage haben 1380 bzw. 1500 Minuten; Fenster auf den Tag kappen.
        end = min(end, day_minutes)
        return (start, end) if start < end else None

    for cut in stress.grid:
        span = window(cut.start_min, cut.end_min)
        if span:
            values["stress_events"].append({
                "start_min": span[0], "end_min": span[1],
                "grid_import_limit_kw": round(limit * cut.factor, 3), "offline_chargers": 0,
            })
    for outage in stress.chargers:
        span = window(outage.start_min, outage.end_min)
        if not span:
            continue
        for fleet in config.fleets:
            if outage.kinds is not None and fleet.kind not in outage.kinds:
                continue
            # Variante kann schon Ladepunkte abschalten; nie mehr als vorhanden.
            taken = sum(e.offline_chargers for e in config.stress_events
                        if e.fleet_kind == fleet.kind
                        and e.start_min < span[1] and span[0] < e.end_min)
            wanted = max(outage.minimum, round(fleet.chargers * outage.share))
            count = min(wanted, fleet.chargers - taken)
            if count:
                values["stress_events"].append({
                    "start_min": span[0], "end_min": span[1], "fleet_kind": fleet.kind,
                    "offline_chargers": count,
                })
    if stress.pv_factor is not None:
        values["power"]["pv_capacity_kwp"] = config.power.pv_capacity_kwp * stress.pv_factor
    if stress.battery_factor is not None:
        for fleet in values["fleets"]:
            fleet["battery_capacity_kwh"] = fleet["battery_capacity_kwh"] * stress.battery_factor
    return CoupledConfig.model_validate(values)


def crisis_catalog() -> list[dict]:
    return [{"id": key, "name": value.name, "assumption": value.assumption}
            for key, value in sorted(CRISIS_STRESS.items())]
