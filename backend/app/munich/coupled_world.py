"""Freeze schedule-derived demand; do not infer aircraft rotations or real fleet needs."""
from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from math import ceil
from zoneinfo import ZoneInfo

from .coupled_models import (
    CYCLIC_ENGINE_VERSION,
    ELECTRIFICATION_ENGINE_VERSION,
    ENGINE_VERSION,
    GRID_SIZING_ENGINE_VERSION,
    LEGACY_ENGINE_VERSIONS,
    PLANNING_ENGINE_VERSIONS,
    CoupledConfig,
    CoupledWorld,
    Mission,
    ParkingGroup,
    ParkingJob,
)
from .flightplan import FlightPlanSnapshot, verify_snapshot


def canonical_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode()).hexdigest()


def local_clock_minute(midnight: datetime, origin: datetime, clock_min: int) -> int:
    """Ortszeit (Europe/Berlin) als fortlaufende UTC-Minute seit lokaler Mitternacht."""
    wall = midnight.replace(tzinfo=None) + timedelta(minutes=clock_min)
    local = wall.replace(tzinfo=midnight.tzinfo, fold=0)
    if local.astimezone(timezone.utc).astimezone(midnight.tzinfo).replace(tzinfo=None) != wall:
        raise ValueError("Parkhaus-Ortszeit faellt in die Zeitumstellung")
    return int((local.astimezone(timezone.utc) - origin).total_seconds() // 60)


def steady_cycle(world: CoupledWorld) -> tuple[int, int]:
    """Messtag fuer den eingeschwungenen Betrieb (Engine v4): der vorletzte Tag des Horizonts.

    Davor schwingt der Betrieb vom Startstand ein, danach laeuft er normal weiter, sodass das
    Rechenende den Messtag nicht verzerrt. Fahrzeuge und Speicher muessen am Ende des Messtags
    mindestens so voll sein wie an seinem Anfang (gleiche Uhrzeit). Bei Horizonten unter zwei
    Tagen ist der Messtag der ganze Horizont, also die bisherige Bedingung (Ende >= Anfang).
    """
    if world.end_min - world.start_min < 2 * 1440:
        return world.start_min, world.end_min
    return world.end_min - 2 * 1440, world.end_min - 1440


# Parkhaus (Engine v4), Annahmen aus der Recherche 10/2026 (docs/ELECTRIFICATION_COMPARISON.md):
# Lademenge je Gruppe (kWh, gleichverteilt), Fristen der Tagesgaeste, Anteil Reisender, die
# am selben Tag zurueckkommen, und die Standardaufteilung ohne Angaben des Flughafens.
PARKING_ENERGY_KWH = {"traveler": (15, 30), "day": (5, 20), "dc": (20, 35)}
PARKING_DAY_DWELL_MIN = (600, 720, 840, 960)
PARKING_SAME_DAY_SHARE = 0.3
PARKING_DEFAULT_SPLIT = (("traveler", 2), ("day", 1))


def _hours(plan: FlightPlanSnapshot, directions: set[str]) -> list[float]:
    weights = [0.0] * 24
    for row in plan.rows:
        if row.direction in directions:
            weights[datetime.fromisoformat(row.scheduled_local).hour] += 1
    return weights


def parking_arrivals(departures: list[float], arrivals: list[float]) -> dict[str, list[float]]:
    """Ankuenfte im Parkhaus je Ortsstunde aus den Flugbewegungen: Reisende 2-3 h vor dem
    Abflug, Tagesgaeste 2 h vorher, Schnelllader mit allen Fluggaesten."""
    return {
        "traveler": [departures[(h + 2) % 24] + departures[(h + 3) % 24] for h in range(24)],
        "day": [departures[(h + 2) % 24] for h in range(24)],
        "dc": [departures[h] + arrivals[h] for h in range(24)],
    }


def scale_parking(groups: list[ParkingGroup], total: int) -> list[ParkingGroup]:
    """Gruppen auf eine andere Zahl von Ladevorgaengen je Tag, Anteile gleich."""
    counts = _split(total, [(str(i), g.sessions) for i, g in enumerate(groups)]) if total else []
    return [g.model_copy(update={"sessions": n}) for g, (_, n) in zip(groups, counts) if n]


def _split(total: int, parts: list[tuple[str, float]]) -> list[tuple[str, int]]:
    """Ganze Vorgaenge nach groessten Resten, Summe genau total."""
    weight = sum(w for _, w in parts)
    raw = [(name, total * w / weight) for name, w in parts]
    counts = [int(r) for _, r in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i][1] - counts[i]), i))
    for i in order[:total - sum(counts)]:
        counts[i] += 1
    return [(name, n) for (name, _), n in zip(raw, counts)]


def parking_jobs_v4(plan: FlightPlanSnapshot, config: CoupledConfig, seed: int, midnight,
                    origin, start_min: int, end_min: int) -> list[ParkingJob]:
    """Parkvorgaenge nach Nutzergruppen, jeden Tag gleich, ueber den ganzen Horizont.

    Reisende kommen 2-3 h vor ihrem Abflug (Frist hoechstens 24 h), Tagesgaeste 2 h vorher
    (Frist 10-16 h), Schnelllader mit Fluggaesten (Frist = Ladezeit + 5 min). Ankunftsminuten
    zufaellig (fester Seed), damit sich Vorgaenge auch ueberlagern koennen. Der erste Tag beginnt
    ohne Autos vom Vortag (er dient dem Einschwingen); Fristen nach dem Horizontende bleiben
    stehen, werden aber nicht geprueft (coupled_simulator).
    """
    p = config.power
    groups = p.parking_groups
    if groups is None:
        groups = [ParkingGroup(group=name, sessions=n, charger_kw=p.parking_charger_kw)
                  for name, n in _split(p.parking_sessions, list(PARKING_DEFAULT_SPLIT)) if n]
    derived = parking_arrivals(_hours(plan, {"departure"}), _hours(plan, {"arrival"}))
    rng = random.Random(f"coupled-parking-v4:{seed}")
    efficiency = p.charging_efficiency
    templates = []
    for g in groups:
        weights = g.arrival_by_hour or derived[g.group]
        if g.sessions and sum(weights) <= 0:
            raise ValueError("Parkhaus-Gruppe ohne Ankunftsstunden")
        low, high = PARKING_ENERGY_KWH[g.group]
        for _ in range(g.sessions):
            minute = rng.choices(range(24), weights)[0] * 60 + rng.randrange(60)
            energy = rng.randint(low, high)
            if g.group == "dc":
                dwell = ceil(60 * energy / (g.charger_kw * efficiency)) + 5
            elif g.group == "day":
                dwell = rng.choice(PARKING_DAY_DWELL_MIN)
            else:
                dwell = 720 if rng.random() < PARKING_SAME_DAY_SHARE else 1440
            if g.max_dwell_min:
                dwell = min(dwell, g.max_dwell_min)
            # Nur was in der Standzeit ladbar ist (mit Luft fuer geteilte Leistung).
            energy = min(energy, 0.9 * g.charger_kw * efficiency * dwell / 60)
            templates.append((g.group, minute, dwell, energy, g.charger_kw))
    jobs = []
    for day in range(config.repeat_days):
        for i, (group, minute, dwell, energy, kw) in enumerate(templates):
            release = local_clock_minute(midnight, origin, day * 1440 + minute)
            if not start_min <= release < end_min:
                continue
            jobs.append(ParkingJob(
                id=f"P-{group}-{i + 1:04d}-day-{day + 1}", release_min=release,
                deadline_min=release + dwell, energy_kwh=round(energy, 6), charger_kw=kw,
                group=group,
            ))
    return jobs


def build_world(
    plan: FlightPlanSnapshot, config: CoupledConfig, seed: int,
    engine_version: str = ENGINE_VERSION,
) -> CoupledWorld:
    if engine_version not in (
        ENGINE_VERSION, ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
        *PLANNING_ENGINE_VERSIONS, *LEGACY_ENGINE_VERSIONS,
    ):
        raise ValueError("Unbekannte Engine-Version der Kopplungswelt")
    verify_snapshot(plan)
    config = CoupledConfig.model_validate(config.model_dump())
    if (any(f.electric_vehicles is not None for f in config.fleets)
            and engine_version not in (ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
                                       *PLANNING_ENGINE_VERSIONS)):
        raise ValueError("Gemischte Flotte benoetigt die Elektrifizierungs-Engine")
    if config.repeat_days != 1 and engine_version not in (
        GRID_SIZING_ENGINE_VERSION, *PLANNING_ENGINE_VERSIONS,
    ):
        raise ValueError("Wiederholte Tage benoetigen die Anschlussvergleich-Engine")
    if config.repeat_days != 1 and config.stress_events:
        raise ValueError("Mehrtagereferenz erlaubt keine mehrdeutigen Tages-Stoerungen")
    if not 0 <= seed <= 2147483647:
        raise ValueError("Ungueltiger Seed")
    if plan.possible_shared_flight_groups and config.shared_group_policy == "reject_unresolved":
        raise ValueError("Ungeklaerte Mehrfachgruppen: unabhaengige Eintraege explizit bestaetigen")
    zone = ZoneInfo(plan.timezone)
    midnight = datetime.combine(plan.service_date, datetime.min.time(), zone)
    next_midnight = datetime.combine(
        plan.service_date + timedelta(days=1), datetime.min.time(), zone,
    )
    origin = midnight.astimezone(timezone.utc)
    day_minutes = int((next_midnight.astimezone(timezone.utc) - origin).total_seconds() / 60)
    start_min, end_min = -config.warmup_min, day_minutes + config.drain_min
    fleets = {f.kind: f for f in config.fleets}
    for event in config.stress_events:
        if event.end_min > day_minutes:
            raise ValueError("Stoerung liegt ausserhalb des Verkehrstags")
        if event.fleet_kind not in fleets and event.fleet_kind is not None:
            raise ValueError("Ladepunkte-Ausfall fuer unbekannte Fahrzeugklasse")
    for kind, fleet in fleets.items():
        for minute in {e.start_min for e in config.stress_events}:
            offline = sum(e.offline_chargers for e in config.stress_events
                          if e.fleet_kind == kind and e.start_min <= minute < e.end_min)
            if offline > fleet.chargers:
                raise ValueError("Stoerung betrifft mehr Ladepunkte als vorhanden")
    missions = []
    for entry in plan.rows:
        published = int((datetime.fromisoformat(entry.scheduled_utc) - origin).total_seconds() / 60)
        if not 0 <= published < day_minutes:
            raise ValueError("Flugplaneintrag liegt nicht im UTC-Verkehrstag")
        for fleet in config.fleets:
            if entry.direction == "arrival" and fleet.kind in {"pushback_tug", "gpu"}:
                continue
            coverage = int(canonical_hash({
                "entry": entry.entry_id, "kind": fleet.kind, "seed": seed,
            })[:16], 16) / 2**64 * 100
            if coverage >= fleet.coverage_pct:
                continue
            release = (published if entry.direction == "arrival"
                       else published - fleet.departure_lead_min)
            deadline = (published + fleet.arrival_allowance_min if entry.direction == "arrival"
                        else published - fleet.departure_buffer_min)
            if release < start_min or deadline + fleet.return_min > end_min:
                raise ValueError("Modell-Horizont deckt Servicefenster/Rueckkehr nicht ab")
            missions.append(Mission(
                mission_id=f"{fleet.kind}-{entry.entry_id}", source_entry_id=entry.entry_id,
                kind=fleet.kind, direction=entry.direction, published_min=published,
                release_min=release, deadline_min=deadline,
                duration_min=fleet.service_duration_min, return_min=fleet.return_min,
                energy_kwh=fleet.mission_energy_kwh,
            ))
    missions.sort(key=lambda m: (m.release_min, m.deadline_min, m.mission_id))
    if not missions:
        raise ValueError("Keine modellierten Auftraege; Einsatzabdeckung pruefen")
    rng = random.Random(f"coupled-parking:{seed}")
    if engine_version in LEGACY_ENGINE_VERSIONS:
        # v1 (nur Nachweis alter Laeufe): Minuten seit UTC-Ursprung, an DST-Tagen verschoben.
        def window(clock_min: int) -> int:
            return clock_min
    else:
        # Ankunft/Frist sind Ortszeiten 00:00..01:30 bzw. 09:00..14:00 Europe/Berlin.
        def window(clock_min: int) -> int:
            return local_clock_minute(midnight, origin, clock_min)
    parking = []
    for i in range(0 if engine_version == CYCLIC_ENGINE_VERSION else config.power.parking_sessions):
        release, deadline = rng.choice([0, 30, 60, 90]), rng.choice([540, 600, 720, 840])
        parking.append(ParkingJob(
            id=f"P44-{i + 1:03d}", release_min=window(release), deadline_min=window(deadline),
            energy_kwh=rng.randint(20, 45), charger_kw=config.power.parking_charger_kw,
        ))
    warnings = [
        "Veroeffentlichte Planzeiten; Flotte, Aufgaben, Verbrauch und Versorgung sind Annahmen.",
        "Aufgabenbereitschaft ist keine reale Flug-OTP/TOBT oder Gate-/Sicherheitsprognose.",
        "Gleicher EDF-Auftragsdispatcher; Regeln unterscheiden nur Ladeverteilung/-punktbelegung.",
        "Ladepunktwechsel ohne Ruestzeit; kein Kabelweg, thermisches oder Netzschutz-Modell.",
        "Start-SOC bezieht sich auf den Beginn des expliziten Vorlaufs, nicht auf Mitternacht.",
        "Synthetische Tagesprofile; keine Wetter-/Lastmessung oder bestaetigte Netz-Topologie.",
        "Eintrag erzeugt je abgedeckter Klasse einen Auftrag, ohne Gate-/Umlauf-Verknuepfung.",
        "Serviceende ist Aufgabenbereitschaft; Rueckfahrt kann am Horizont noch andauern.",
    ]
    if plan.evidence_level == 'synthetic_reference':
        warnings[0] = ('Synthetische Planzeiten; keine gemessenen oder '
                       'veroeffentlichten Flughafenablaeufe.')
    if engine_version in (ENGINE_VERSION, ELECTRIFICATION_ENGINE_VERSION,
                          GRID_SIZING_ENGINE_VERSION, *PLANNING_ENGINE_VERSIONS):
        warnings.append("Parkhausfenster als Ortszeit Europe/Berlin (DST-sicher); "
                        "Ladefrist je Fahrzeug aus der naechsten noch erreichbaren Frist.")
    if engine_version in (ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
                          *PLANNING_ENGINE_VERSIONS):
        warnings.append("Feste Gesamtflotte; nicht-elektrische Fahrzeuge haben gleiche "
                        "Einsatzzeiten, ohne Kraftstoff-, Betankungs- oder Emissionsmodell.")
    if engine_version in PLANNING_ENGINE_VERSIONS:
        warnings[2] = ('Feste Fahrzeugzuordnung je Auftrag, unabhaengig von Laderegel und Netz; '
                       'keine Ersatzfahrzeuge bei Energiemangel.')
        warnings.append('Ladeplanung kennt alle modellierten Einsaetze und Lastprofile; '
                        'vorausschauende Heuristik, keine Optimalitaetsgarantie '
                        'oder reale Prognose.')
    if engine_version == CYCLIC_ENGINE_VERSION:
        warnings.append('Ladeplanung rechnet mit dem echten Ladestand und einer Planreserve auf '
                        'den Verbrauch; Erfolg heisst: der vorletzte Tag endet mit mindestens dem '
                        'Stand, mit dem er begann (Fahrzeuge und Speicher, eingeschwungen).')
    if plan.possible_shared_flight_groups:
        warnings.append("Mehrfachgruppen bewusst als unabhaengige Nachfrageannahmen verwendet; "
                        "keine bestaetigte Zahl physischer Fluege.")
    if config.repeat_days > 1:
        first_missions, first_parking = missions, parking
        missions, parking = [], []
        entries = {entry.entry_id: entry for entry in plan.rows}
        for day in range(config.repeat_days):
            for mission in first_missions:
                local = datetime.fromisoformat(entries[mission.source_entry_id].scheduled_local)
                published = local_clock_minute(
                    midnight, origin, day * 1440 + local.hour * 60 + local.minute)
                offset = published - mission.published_min
                identity = canonical_hash({'id': mission.mission_id, 'day': day})[:16]
                missions.append(mission.model_copy(update={
                    "mission_id": (mission.mission_id if day == 0 else
                                   f"{mission.kind}-{identity}"),
                    "service_day": day, "published_min": published,
                    "release_min": mission.release_min + offset,
                    "deadline_min": mission.deadline_min + offset,
                }))
            for job in first_parking:
                def repeated_minute(value: int, day=day) -> int:
                    local = (origin + timedelta(minutes=value)).astimezone(zone)
                    return local_clock_minute(
                        midnight, origin, day * 1440 + local.hour * 60 + local.minute)
                parking.append(job.model_copy(update={
                    "id": f"{job.id}-day-{day + 1}",
                    "release_min": repeated_minute(job.release_min),
                    "deadline_min": repeated_minute(job.deadline_min),
                }))
        missions.sort(key=lambda m: (m.release_min, m.deadline_min, m.mission_id))
        finish = datetime.combine(plan.service_date + timedelta(days=config.repeat_days),
                                  datetime.min.time(), zone).astimezone(timezone.utc)
        day_minutes = int((finish - origin).total_seconds() / 60)
        end_min = day_minutes + config.drain_min
        warnings.append("Identische Referenztage mit durchlaufenden Fahrzeug-/Speicherzustaenden; "
                        "kein taeglicher SOC-Neustart und kein Jahresnachweis.")
    if engine_version == CYCLIC_ENGINE_VERSION:
        parking = parking_jobs_v4(plan, config, seed, midnight, origin, start_min, end_min)
        warnings.append("Parkhaus nach Nutzergruppen (Reisende, Tagesgaeste, Schnelllader); "
                        "Ankuenfte, Standzeiten und Lademengen sind belegte Annahmen.")
    payload = {
        "engine_version": engine_version, "seed": seed,
        "source_plan_sha256": plan.content_sha256, "config": config.model_dump(mode="json"),
        "day_start_utc": origin.isoformat(), "day_minutes": day_minutes,
        "start_min": start_min, "end_min": end_min,
        "missions": [m.model_dump() for m in missions],
        "parking_jobs": [p.model_dump() for p in parking], "warnings": warnings,
    }
    return CoupledWorld(**payload, world_hash=canonical_hash(payload))


def verify_world(world: CoupledWorld, plan: FlightPlanSnapshot) -> None:
    payload = world.model_dump(mode="json", exclude={"world_hash"})
    if canonical_hash(payload) != world.world_hash:
        raise ValueError("Welt-Hash stimmt nicht mit eingefrorenen Auftraegen ueberein")
    regenerated = build_world(plan, world.config, world.seed, world.engine_version)
    if regenerated.world_hash != world.world_hash:
        raise ValueError("Welt-Hash passt nicht zum Flugplan und Engine-Vertrag")
