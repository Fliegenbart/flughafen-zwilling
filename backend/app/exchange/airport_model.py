"""Ein echter Flughafen im Elektrifizierungsmodell: Flugplan, Flotte und Raster aus dem Steckbrief.

Gerechnet wird das ganze Vorfeld (vier Fahrzeugklassen) an einem typischen Tag im Spitzenmonat.
"Anschluss" heisst hier: die Leistung, die das Flughafennetz fuer das Laden bereitstellt
(Reserve fuer das Vorfeld, inklusive Laden im Parkhaus). Die uebrige Last des Flughafens ist darin
schon abgezogen, deshalb rechnet das Modell keine Grundlast und keine Flughafen-PV mit.
Fahrzeugdaten (Akku, Energie je Einsatz, Ladeleistung) sind dieselben wie im Beispielflughafen.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from math import ceil

from ..munich.coupled_models import CoupledConfig, ParkingGroup, PowerConfig, trusted_scale
from ..munich.coupled_world import parking_arrivals
from ..munich.flightplan import parse_pages
from .airport_spec import FLEET_KINDS, AirportSpec, load_spec
from .demo import _HEADER, _airport_code, _canonical_hash
from .electrification_reference import reference_config

AIRPORT_MODEL_VERSION = "airport_profile_v1"
# Bezugsgroesse fuer das Raster: der Beispielflughafen hat 180 Abfluege am Tag.
REFERENCE_DEPARTURES = 180
REFERENCE_GRID_MAX_KW = 8000
# Speicherstufen des Beispielflughafens, je Flughafen mit seiner Groesse skaliert.
STORAGE_STEPS = (0, 500, 1000, 2000, 3000, 4000, 6000)


def _spread(count: int, weights: list[float]) -> list[int]:
    """Ganze Fluege je Stunde nach groessten Resten, Summe genau count."""
    total = sum(weights)
    raw = [count * w / total for w in weights]
    base = [int(r) for r in raw]
    for hour in sorted(range(24), key=lambda h: (-(raw[h] - base[h]), h))[:count - sum(base)]:
        base[hour] += 1
    return base


def _minutes(per_hour: list[int]) -> list[int]:
    """Gleichmaessig in der Stunde verteilt, in Minuten ab Mitternacht (Ortszeit)."""
    out = []
    for hour, n in enumerate(per_hour):
        out.extend(hour * 60 + int((i + 0.5) * 60 / n) for i in range(n))
    return out


@lru_cache(maxsize=16)
def airport_day(airport: str):
    spec = load_spec(airport)
    count = round(spec.departures_per_day)

    def clock(minute: int) -> str:
        minute %= 1440
        return f"{minute // 60:02d}:{minute % 60:02d}"

    rows = []
    departures = _minutes(_spread(count, spec.departures_by_hour))
    arrivals = _minutes(_spread(count, spec.arrivals_by_hour))
    for number, minute in enumerate(departures, 1):
        rows.append(f"S XY {10000 + number} {clock(minute)} {clock(minute + 90)} 1234567 "
                    f"{_airport_code(number)} 03.10.26 27.03.27 1 Airport Profile {spec.id}")
    for number, minute in enumerate(arrivals, 1):
        rows.append(f"L XY {20000 + number} {clock(minute - 90)} {clock(minute)} 1234567 "
                    f"{_airport_code(number)} 03.10.26 27.03.27 1 Airport Profile {spec.id}")
    text = _HEADER + "\n".join(rows)
    snapshot = parse_pages([text], date(2026, 10, 3), '0' * 64)
    snapshot.source_url = f"urn:airport-twin:profile:{spec.id}:{spec.as_of}"
    snapshot.import_method = 'synthetic_generator'
    snapshot.evidence_level = 'synthetic_reference'
    snapshot.generated_input_sha256 = _canonical_hash({'text': text})
    snapshot.warnings = [
        (f'Tagesprofil {spec.id} aus veroeffentlichten Eckdaten konstruiert, kein echter Flugplan.'
         if spec.profile_basis.assumption else
         f'Tagesprofil {spec.id} aus dem veroeffentlichten Flugplan ausgezaehlt, auf einen '
         'typischen Tag im Spitzenmonat skaliert.'),
        'Kein PDF-Upload: source_pdf_sha256 ist ein Null-Platzhalter.',
    ]
    digest = _canonical_hash(snapshot.model_dump(mode='json', exclude={
        'snapshot_id', 'content_sha256', 'imported_at'}))
    snapshot.snapshot_id = snapshot.content_sha256 = digest
    return snapshot


def scale(spec: AirportSpec) -> float:
    return spec.departures_per_day / REFERENCE_DEPARTURES


def grid_raster(spec: AirportSpec) -> tuple[int, int]:
    """Rasterweite und Obergrenze der Anschlusssuche, mit der Groesse des Flughafens.

    Rund 1-2 % Aufloesung statt Scheingenauigkeit von 25 kW bei vielen Megawatt; so bleibt
    die Zahl der Rechnungen je Suche etwa gleich (scripts/make_electrification_atlas.py).
    """
    k = scale(spec)
    step = 25 if k <= 1.25 else 50 if k <= 2.5 else 100
    top = max(REFERENCE_GRID_MAX_KW, REFERENCE_GRID_MAX_KW * k * 1.5)
    return step, int(ceil(top / step) * step)


def storage_axis(spec: AirportSpec) -> list[int]:
    k = max(1.0, scale(spec))
    return sorted({int(round(s * k / 500) * 500) for s in STORAGE_STEPS})


def parking_groups(spec: AirportSpec) -> list[ParkingGroup]:
    """Parkhaus je Standort und Nutzergruppe; Ankuenfte folgen den Passagierfluegen."""
    arrival = parking_arrivals(spec.passenger_departures_by_hour or spec.departures_by_hour,
                               spec.passenger_arrivals_by_hour or spec.arrivals_by_hour)
    out = []
    for i, group, sessions in spec.parking_sessions():
        point = spec.parking_points[i]
        out.append(ParkingGroup(group=group, sessions=sessions, charger_kw=point.kw,
                                max_dwell_min=point.max_dwell_min,
                                arrival_by_hour=arrival[group]))
    return out


def airport_config(spec: AirportSpec, vehicles: dict[str, int] | None = None,
                   chargers: dict[str, int] | None = None) -> CoupledConfig:
    """Konfiguration fuer das ganze Vorfeld; Flotte aus dem Steckbrief oder ausdruecklich."""
    if vehicles is None:
        if spec.fleet is None:
            raise ValueError(f"Flotte fuer {spec.id} noch nicht bemessen "
                             "(scripts/size_airport_fleets.py)")
        vehicles, chargers = spec.fleet.vehicles, spec.fleet.chargers
    reference = reference_config()
    fleets = []
    for fleet in reference.fleets:
        fleets.append(fleet.model_copy(update={
            "vehicles": vehicles[fleet.kind],
            "chargers": (chargers or {})[fleet.kind] if chargers else fleet.chargers,
            "coverage_pct": spec.coverage_pct[fleet.kind],
        }))
    with trusted_scale():
        return CoupledConfig(
            fleets=fleets, repeat_days=3,
            # Nachtverkehr: Einsaetze vor Mitternacht und nach dem dritten Tag abdecken.
            warmup_min=90, drain_min=120,
            power=PowerConfig(
                background_load_kw=0, chp_output_kw=0, pv_capacity_kwp=0, pv_peak_factor=0.2,
                parking_sessions=spec.parking_sessions_per_day,
                parking_groups=parking_groups(spec),
                grid_import_limit_kw=grid_raster(spec)[1],
                # Kein Trafo-Deckel vor der Reserve: gefragt ist, was das Netz bereitstellt.
                apron_transformer_kva=200000,
                parking_transformer_kva=200000,
            ),
        )


def kinds() -> tuple[str, ...]:
    return FLEET_KINDS


def _on_time_by_kind(plan, config: CoupledConfig, seed: int) -> dict[str, bool]:
    """Schafft jede Klasse alle Einsaetze rechtzeitig? Ohne Strom (0 % elektrisch)."""
    from ..munich.coupled_models import PREDICTIVE_ENGINE_VERSION
    from ..munich.coupled_simulator import simulate_coupled
    from ..munich.coupled_world import build_world

    world = build_world(plan, config, seed, PREDICTIVE_ENGINE_VERSION)
    result = simulate_coupled(world, plan, "uncontrolled", capture_traces=False)
    done: dict[str, bool] = {kind: True for kind in FLEET_KINDS}
    for task in result.kpis.readiness_by_task:
        if task.missions_on_time != task.mission_count:
            done[task.kind] = False
    return done


def minimal_fleet(plan, config: CoupledConfig, seed: int, upper: dict[str, int]) -> dict[str, int]:
    """Kleinste Flotte je Klasse, die alle Einsaetze rechtzeitig schafft (Bisektion, alle Klassen
    gleichzeitig; ohne Elektrofahrzeuge beeinflussen sich die Klassen nicht)."""
    lo = {kind: 0 for kind in FLEET_KINDS}
    hi = dict(upper)
    from ..munich.coupled_models import PREDICTIVE_ENGINE_VERSION
    from ..munich.coupled_world import build_world

    with trusted_scale():
        # Klassen ohne Einsaetze (z. B. keine Vorfeldbusse bei Walk-Boarding) brauchen 0.
        used = {m.kind for m in build_world(plan, config, seed, PREDICTIVE_ENGINE_VERSION).missions}
        for kind in FLEET_KINDS:
            if kind not in used:
                hi[kind] = 0
        while any(hi[k] - lo[k] > 1 for k in FLEET_KINDS):
            mid = {k: (lo[k] + hi[k]) // 2 if hi[k] - lo[k] > 1 else hi[k] for k in FLEET_KINDS}
            trial = config.model_copy(update={"fleets": [
                f.model_copy(update={"vehicles": mid[f.kind], "electric_vehicles": 0,
                                     "chargers": 0})
                for f in config.fleets]})
            trial = CoupledConfig.model_validate(trial.model_dump())
            done = _on_time_by_kind(plan, trial, seed)
            for k in FLEET_KINDS:
                if hi[k] - lo[k] <= 1:
                    continue
                if done[k]:
                    hi[k] = mid[k]
                else:
                    lo[k] = mid[k]
    return hi
