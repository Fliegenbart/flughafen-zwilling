"""Bounded exports with explicit provenance and spreadsheet-safe imported strings."""
from __future__ import annotations

import csv
import json
import textwrap
from io import StringIO
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .coupled_models import CoupledWorld
from .coupled_simulator import CoupledResult
from .flightplan import FlightPlanSnapshot

ARTIFACT_NAMES = {"missions.csv", "departures.csv", "vehicles.csv", "parking.csv",
                  "coupled-evidence.json"}


def csv_text(rows: list[dict]) -> str:
    output = StringIO(newline="")
    if not rows:
        return "no_rows\r\n"
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader()
    for row in rows:
        payload = {}
        for key, value in row.items():
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=True)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            payload[key] = value
        writer.writerow(payload)
    return output.getvalue()


def build_artifacts(
    result: CoupledResult, world: CoupledWorld, plan: FlightPlanSnapshot, policy: str,
) -> dict[str, str]:
    return {
        "missions.csv": csv_text(result.missions), "departures.csv": csv_text(result.departures),
        "vehicles.csv": csv_text(result.vehicles), "parking.csv": csv_text(result.parking),
        "coupled-evidence.json": json.dumps({
            "engine_version": world.engine_version, "policy": policy,
            "evidence_level": result.kpis.evidence_level,
            "world_hash": result.world_hash, "source_plan_sha256": plan.content_sha256,
            "source_pdf_sha256": plan.source_pdf_sha256, "service_date": str(plan.service_date),
            "source_data_date": str(plan.source_data_date), "day_start_utc": world.day_start_utc,
            "time_axis": "elapsed_minutes_from_local_midnight_UTC_continuous",
            "day_minutes": world.day_minutes, "start_min": world.start_min,
            "end_min": world.end_min, "warnings": world.warnings,
            "series_interval_min": 1, "vehicle_trace_interval_min": 5,
            "sample_semantics": "power_and_state_for_last_interval_energy_at_interval_end",
            "missions": result.missions, "departures": result.departures,
            "parking": result.parking, "series": result.series,
        }, ensure_ascii=True, separators=(",", ":"), allow_nan=False),
    }


def write_coupled_pdf(path: Path, payload: dict) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Airport Twin Core / Flugplan-Fahrzeuge-Energie")
    c.setSubject("Unkalibriertes, flugplanbasiertes Aufgabenmodell; keine echte OTP")
    y = A4[1] - 40

    def line(text: str, heading: bool = False) -> None:
        nonlocal y
        for part in textwrap.wrap(text, 95, break_long_words=True) or [""]:
            if y < 50:
                c.showPage()
                y = A4[1] - 40
            c.setFont("Helvetica-Bold" if heading else "Helvetica", 11 if heading else 9)
            c.drawString(40, y, part)
            y -= 14

    line("Airport Twin Core / Flugplan - Fahrzeuge - Energie", True)
    line("UNKALIBRIERTER METHODENPROTOTYP / KEINE ECHTE FLUG-OTP", True)
    line("Planzeiten aus manuellem PDF-Import; "
         "Flotte, Fristen, Verbrauch und Lastprofile angenommen.")
    line("Keine Anlagensteuerung, kein Netzschutz/Lastfluss, "
         "keine FMG-Partnerschaft oder ROI-Aussage.")
    line(f"Run-ID: {payload['run_id']} | Seed: {payload['seed']} | SIL, 1-Minuten-Schritte")
    meta = payload["model_pack_snapshot"]["calibration_meta"]
    world, plan = meta["coupled_world"], meta["flight_plan_snapshot"]
    line(f"Regel: {payload['model_pack_snapshot']['parameter_set']['policy']}")
    line(f"Verkehrstag {plan['service_date']} / Stand {plan['source_data_date']} / Europe/Berlin")
    line(f"Engine: {world['engine_version']} / "
         f"Modellhorizont {world['start_min']}..{world['end_min']} min")
    line("Zeitachse: fortlaufende UTC-Minuten relativ zur lokalen Mitternacht; mit Vor-/Nachlauf.")
    line(f"Welt-Hash: {world['world_hash']}")
    line(f"Flugplan-Hash: {plan['content_sha256']} / PDF-Hash: {plan['source_pdf_sha256']}")
    line(f"Backend/Execution: {payload['build_meta'].get('backend_git_commit', 'n/a')} / "
         f"{payload['build_meta'].get('execution_backend_git_commit', 'n/a')}")
    line("Modellkriterien " + ("erfuellt" if payload["pass_fail"] else "nicht erfuellt")
         + "; technisch completed ist nicht fachlich PASS.")
    for section, fields in [
        ("Aufgaben-/Fahrzeug-KPIs", "coupled_kpis"),
        ("Wirkleistung/Energie; Ladefristenfelder nur Parkhaus", "energy_kpis"),
    ]:
        line(section, True)
        for key, value in payload["summary"][fields].items():
            line(f"{key}: {value:.6f}" if isinstance(value, float) else f"{key}: {value}")
    line("Eingefrorene Annahmen", True)
    for kind, config in [("Versorgung", world["config"]["power"])] + [
        (fleet["kind"], fleet) for fleet in world["config"]["fleets"]
    ]:
        line(kind, True)
        for key, value in config.items():
            line(f"{key}: {value}")
    line(f"Stoerungen: {json.dumps(world['config']['stress_events'], ensure_ascii=True)}")
    line("Modellgrenzen", True)
    for warning in world["warnings"]:
        line(warning)
    line("Fehlende Aufgaben bleiben im Nenner. Unfertige Fristverletzungen sind Untergrenzen.")
    line("Alle Energie-KPIs umfassen den Vor-/Nachlauf. Kein 24h-Verbrauch ohne diese Abgrenzung.")
    line("BHKW exogen; Anfangs-Speicherenergie unbekannter Herkunft, keine Gruenstromquote.")
    line("Modellpruefungen", True)
    for check in payload["assertions"]:
        line(f"{check['name']}: {check['observed']} {check['op']} {check['threshold']} / "
             f"{'erfuellt' if check['passed'] else 'nicht erfuellt'}")
    line("Einzelnachweise: missions.csv, departures.csv, vehicles.csv, parking.csv, "
         "coupled-evidence.json. SHA256-Pruefung ueber /safety; kein externer Echtheitsnachweis.")
    c.save()
