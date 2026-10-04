"""Strict day extraction from the public MUC seasonal timetable, not a flight feed."""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field

PARSER_VERSION = "muc_season_pdf_v1"
SOURCE_URL = (
    "https://www.munich-airport.de/"
    "_b/0000000000000027589260bb6718b5d0/flugplan.pdf"
)
TIMEZONE = "Europe/Berlin"
MAX_PDF_BYTES = 6 * 1024 * 1024
MAX_PAGES = 160
MAX_TEXT_CHARS = 2_000_000
MAX_SCHEDULE_ROWS = 12_000


class FlightPlanError(ValueError):
    pass


class FlightEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_id: str = Field(pattern=r"^[a-f0-9]{16}$")
    direction: Literal["arrival", "departure"]
    flight_number: str = Field(pattern=r"^[A-Z0-9]{2,3}[0-9]{1,5}[A-Z]?$")
    airline: str = Field(min_length=1, max_length=100)
    counterpart_iata: str = Field(pattern=r"^[A-Z]{3}$")
    terminal: str = Field(pattern=r"^[12][A-Z]?$")
    scheduled_local: str
    scheduled_utc: str
    source_pages: list[int]
    possible_shared_group: str | None = None


class HourlyFlights(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hour: int = Field(ge=0, le=23)
    arrivals: int = Field(ge=0)
    departures: int = Field(ge=0)


class FlightPlanSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_pdf_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_url: Literal[SOURCE_URL] = SOURCE_URL
    import_method: Literal["manual_user_upload"] = "manual_user_upload"
    parser_version: Literal[PARSER_VERSION] = PARSER_VERSION
    evidence_level: Literal["published_schedule_not_actual"] = "published_schedule_not_actual"
    timezone: Literal[TIMEZONE] = TIMEZONE
    source_data_date: date
    service_date: date
    imported_at: str
    parsed_schedule_rows: int = Field(ge=1, le=MAX_SCHEDULE_ROWS)
    arrival_entry_count: int = Field(ge=0)
    departure_entry_count: int = Field(ge=0)
    duplicate_rows_removed: int = Field(ge=0)
    possible_shared_flight_groups: int = Field(ge=0)
    hourly_counts: list[HourlyFlights] = Field(min_length=24, max_length=24)
    rows: list[FlightEntry] = Field(min_length=1, max_length=2500)
    warnings: list[str]


def _hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode()).hexdigest()


def verify_snapshot(snapshot: FlightPlanSnapshot) -> None:
    payload = snapshot.model_dump(mode="json", exclude={
        "snapshot_id", "content_sha256", "imported_at",
    })
    digest = _hash(payload)
    if digest != snapshot.content_sha256 or digest != snapshot.snapshot_id:
        raise FlightPlanError("Flugplan-Hash stimmt nicht mit dem Snapshot ueberein")


def _date(text: str) -> date:
    try:
        day, month, year = map(int, text.split("."))
        return date(year + 2000 if year < 100 else year, month, day)
    except ValueError as exc:
        raise FlightPlanError("Ungueltiges Datum in Flugplan-Zeile") from exc


def _local_time(day: date, clock: str) -> datetime:
    try:
        naive = datetime.combine(day, datetime.strptime(clock, "%H:%M").time())
    except ValueError as exc:
        raise FlightPlanError("Ungueltige Uhrzeit in Flugplan-Zeile") from exc
    zone = ZoneInfo(TIMEZONE)
    candidates = set()
    for fold in (0, 1):
        candidate = naive.replace(tzinfo=zone, fold=fold)
        utc = candidate.astimezone(timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == naive:
            candidates.add(utc)
    if len(candidates) != 1:
        raise FlightPlanError(
            "MUC-Ortszeit bei Zeitumstellung mehrdeutig oder nicht vorhanden; "
            "manuell aufgeloeste UTC-Zeit erforderlich",
        )
    return next(iter(candidates)).astimezone(zone)


# Whitespace-normalized rows retain both remote and MUC time columns, including +/- markers.
ROW = re.compile(
    r"^(?P<kind>[LS])\s+(?P<carrier>[A-Z0-9]{2,3})\s*(?P<number>\d{1,5}[A-Z]?)\s+"
    r"(?P<previous>-\s+)?(?P<first>\d{2}:\d{2})\s+"
    r"(?P<following>\+\s+)?(?P<second>\d{2}:\d{2})\s+"
    r"(?P<days>[1-7-]{7})\s+(?P<airport>[A-Z]{3})\s+"
    r"(?:(?P<stop>[A-Z]{3})\s+)?(?P<start>\d{2}\.\d{2}\.\d{2})\s+"
    r"(?P<end>\d{2}\.\d{2}\.\d{2})\s+(?P<terminal>[12][A-Z]?)\s+(?P<airline>.+)$",
)


def parse_pages(pages: list[str], service_date: date, pdf_sha256: str) -> FlightPlanSnapshot:
    if not pages or len(pages) > MAX_PAGES or sum(map(len, pages)) > MAX_TEXT_CHARS:
        raise FlightPlanError("PDF-Umfang ueberschreitet Importgrenzen")
    text = "\n".join(pages)
    if not all(word in text for word in ("Flugplan", "L/S", "Ortszeiten", "Montag")):
        raise FlightPlanError(
            "Unbekanntes Flugplan-Format; offizielles Saisonflugplan-PDF erwartet",
        )
    if "München" not in text and "Muenchen" not in text:
        raise FlightPlanError("Unbekanntes Flughafen-Format")
    data_dates = {_date(t) for t in re.findall(r"Datenstand:\s*(\d{2}\.\d{2}\.\d{4})", text)}
    if len(data_dates) != 1:
        raise FlightPlanError("Einheitlicher Datenstand fehlt im Flugplan")
    source_data_date = next(iter(data_dates))
    # Schluessel inkl. planmaessiger Ortszeit: dieselbe Flugnummer darf am Tag mehrfach
    # (zu verschiedenen Zeiten) verkehren. Gleiche Zeit mit anderen Daten bleibt Widerspruch.
    entries: dict[tuple[str, str, str, str], FlightEntry] = {}
    parsed_count = duplicate_count = 0
    for page_number, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = " ".join(raw.split())
            if not re.match(r"^[LS](?:\s|$)", line):
                continue
            match = ROW.fullmatch(line)
            if not match:
                raise FlightPlanError(f"Flugplan-Zeile auf Seite {page_number} nicht lesbar")
            parts = match.groupdict()
            start, end = _date(parts["start"]), _date(parts["end"])
            if start > end or not any(c != "-" for c in parts["days"]):
                raise FlightPlanError(f"Ungueltige Flugplan-Zeile auf Seite {page_number}")
            if any(c not in ("-", str(i)) for i, c in enumerate(parts["days"], 1)):
                raise FlightPlanError(f"Ungueltige Verkehrstage auf Seite {page_number}")
            # Validate both clocks even outside the chosen day. Never accept partial parsing.
            for clock in (parts["first"], parts["second"]):
                try:
                    datetime.strptime(clock, "%H:%M")
                except ValueError as exc:
                    raise FlightPlanError(f"Ungueltige Uhrzeit auf Seite {page_number}") from exc
            if (parts["kind"] == "S" and parts["previous"]) or (
                parts["kind"] == "L" and parts["following"]
            ):
                raise FlightPlanError(f"Unbekannter MUC-Tageswechsel auf Seite {page_number}")
            parsed_count += 1
            if parsed_count > MAX_SCHEDULE_ROWS:
                raise FlightPlanError("Zu viele Flugplan-Zeilen")
            if not start <= service_date <= end or parts["days"][service_date.weekday()] == "-":
                continue
            direction = "arrival" if parts["kind"] == "L" else "departure"
            clock = parts["second"] if direction == "arrival" else parts["first"]
            local = _local_time(service_date, clock)
            number = parts["carrier"] + parts["number"]
            key = (direction, number, parts["airport"], local.isoformat())
            if key in entries:
                old = entries[key]
                if (old.terminal, old.airline) != (parts["terminal"], parts["airline"]):
                    raise FlightPlanError("Flugplan enthaelt widerspruechliche Eintraege")
                old.source_pages = sorted(set([*old.source_pages, page_number]))
                duplicate_count += 1
                continue
            entries[key] = FlightEntry(
                # ID-Format unveraendert (3er-Schluessel + Zeit): bestehende Snapshots bleiben
                # reproduzierbar, Mehrfachverkehr bekommt ueber die Zeit eigene IDs.
                entry_id=_hash({"key": key[:3], "time": local.isoformat()})[:16],
                direction=direction, flight_number=number, airline=parts["airline"],
                counterpart_iata=parts["airport"], terminal=parts["terminal"],
                scheduled_local=local.isoformat(),
                scheduled_utc=local.astimezone(timezone.utc).isoformat(),
                source_pages=[page_number],
            )
    if not entries:
        raise FlightPlanError("Keine Flugplaneintraege fuer diesen Verkehrstag; Geltung pruefen")
    # Mehrfachgruppen nach UTC-Zeitpunkt (eindeutig, auch an Umstellungstagen).
    groups: dict[tuple[str, str, str], list[FlightEntry]] = defaultdict(list)
    rows = sorted(entries.values(), key=lambda r: (r.scheduled_utc, r.direction, r.flight_number))
    hourly = [HourlyFlights(hour=hour, arrivals=0, departures=0) for hour in range(24)]
    for entry in rows:
        groups[(entry.direction, entry.counterpart_iata, entry.scheduled_utc)].append(entry)
        hour = datetime.fromisoformat(entry.scheduled_local).hour
        if entry.direction == "arrival":
            hourly[hour].arrivals += 1
        else:
            hourly[hour].departures += 1
    shared_groups = 0
    for group in groups.values():
        if len(group) > 1:
            shared_groups += 1
            # Gruppen-ID weiter aus dem Ortszeit-Schluessel (bijektiv zur UTC-Zeit, da
            # mehrdeutige Ortszeiten abgelehnt werden): alte Snapshot-Hashes bleiben gleich.
            first = group[0]
            label = (first.direction, first.counterpart_iata, first.scheduled_local)
            for entry in group:
                entry.possible_shared_group = _hash({"group": label})[:16]
    warnings = [
        "Geplanter Saisonflugplan, keine beobachteten Starts/Landungen oder Live-Statusdaten.",
        "Manueller Upload: Quellenangabe und PDF-Hash sind kein Echtheitsnachweis.",
        "Keine Flugzeugumlaeufe, Positionen, Fahrzeugauftraege oder Ladebedarfe enthalten.",
    ]
    if shared_groups:
        warnings.append(
            f"{shared_groups} moegliche Codeshare-/Mehrfachgruppen: verschiedene Flugnummern "
            "wurden mangels Zuordnungsnachweis nicht zusammengelegt. Eintraege sind keine "
            "bestaetigte Anzahl physischer Flugbewegungen.",
        )
    if service_date < source_data_date:
        warnings.append("Verkehrstag vor Datenstand: kein historischer As-of-Nachweis.")
    payload = {
        "source_pdf_sha256": pdf_sha256, "source_url": SOURCE_URL,
        "import_method": "manual_user_upload", "parser_version": PARSER_VERSION,
        "evidence_level": "published_schedule_not_actual", "timezone": TIMEZONE,
        "source_data_date": source_data_date.isoformat(), "service_date": service_date.isoformat(),
        "parsed_schedule_rows": parsed_count,
        "arrival_entry_count": sum(r.direction == "arrival" for r in rows),
        "departure_entry_count": sum(r.direction == "departure" for r in rows),
        "duplicate_rows_removed": duplicate_count, "possible_shared_flight_groups": shared_groups,
        "hourly_counts": [h.model_dump() for h in hourly],
        "rows": [r.model_dump() for r in rows], "warnings": warnings,
    }
    digest = _hash(payload)
    return FlightPlanSnapshot(
        **payload, snapshot_id=digest, content_sha256=digest,
        imported_at=datetime.now(timezone.utc).isoformat(),
    )
