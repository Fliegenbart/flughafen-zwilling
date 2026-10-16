"""Freeze schedule-derived demand; do not infer aircraft rotations or real fleet needs."""
from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .coupled_models import (
    ELECTRIFICATION_ENGINE_VERSION,
    ENGINE_VERSION,
    GRID_SIZING_ENGINE_VERSION,
    LEGACY_ENGINE_VERSIONS,
    PREDICTIVE_ENGINE_VERSION,
    CoupledConfig,
    CoupledWorld,
    Mission,
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


def build_world(
    plan: FlightPlanSnapshot, config: CoupledConfig, seed: int,
    engine_version: str = ENGINE_VERSION,
) -> CoupledWorld:
    if engine_version not in (
        ENGINE_VERSION, ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
        PREDICTIVE_ENGINE_VERSION,
        *LEGACY_ENGINE_VERSIONS,
    ):
        raise ValueError("Unbekannte Engine-Version der Kopplungswelt")
    verify_snapshot(plan)
    config = CoupledConfig.model_validate(config.model_dump())
    if (any(f.electric_vehicles is not None for f in config.fleets)
            and engine_version not in (ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
                                       PREDICTIVE_ENGINE_VERSION)):
        raise ValueError("Gemischte Flotte benoetigt die Elektrifizierungs-Engine")
    if config.repeat_days != 1 and engine_version not in (
        GRID_SIZING_ENGINE_VERSION, PREDICTIVE_ENGINE_VERSION,
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
    for i in range(config.power.parking_sessions):
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
                          GRID_SIZING_ENGINE_VERSION, PREDICTIVE_ENGINE_VERSION):
        warnings.append("Parkhausfenster als Ortszeit Europe/Berlin (DST-sicher); "
                        "Ladefrist je Fahrzeug aus der naechsten noch erreichbaren Frist.")
    if engine_version in (ELECTRIFICATION_ENGINE_VERSION, GRID_SIZING_ENGINE_VERSION,
                          PREDICTIVE_ENGINE_VERSION):
        warnings.append("Feste Gesamtflotte; nicht-elektrische Fahrzeuge haben gleiche "
                        "Einsatzzeiten, ohne Kraftstoff-, Betankungs- oder Emissionsmodell.")
    if engine_version == PREDICTIVE_ENGINE_VERSION:
        warnings[2] = ('Feste Fahrzeugzuordnung je Auftrag, unabhaengig von Laderegel und Netz; '
                       'keine Ersatzfahrzeuge bei Energiemangel.')
        warnings.append('Ladeplanung kennt alle modellierten Einsaetze und Lastprofile; '
                        'vorausschauende Heuristik, keine Optimalitaetsgarantie '
                        'oder reale Prognose.')
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
