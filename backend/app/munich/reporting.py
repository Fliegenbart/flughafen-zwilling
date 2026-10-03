from __future__ import annotations

import csv
import textwrap
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..models import RunSummary


def write_charging_csv(path: Path, summary: RunSummary) -> None:
    if not summary.energy_sessions:
        columns = ["id", "sector", "arrival_min", "deadline_min", "required_energy_kwh",
                   "delivered_kwh", "unmet_kwh", "deadline_met"]
    else:
        columns = list(summary.energy_sessions[0].model_dump())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for session in summary.energy_sessions:
            writer.writerow(session.model_dump())


def write_energy_pdf(path: Path, payload: dict) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Airport Twin Core / Muenchen-Energiepilot")
    c.setAuthor("Airport Twin Core")
    c.setSubject("Synthetischer Referenztest, nicht kalibriert, keine FMG-Betriebsdaten")
    _, height = A4
    y = height - 40

    def footer() -> None:
        c.setFont("Helvetica", 7)
        c.drawString(40, 25, "Muenchen-Referenzpilot / synthetisch, nicht kalibriert")
        c.drawRightString(550, 25, f"Seite {c.getPageNumber()}")

    def line(text: str, heading: bool = False) -> None:
        nonlocal y
        c.setFont("Helvetica-Bold" if heading else "Helvetica", 11 if heading else 9)
        for part in textwrap.wrap(text, width=96, break_long_words=True) or [""]:
            if y < 50:
                footer()
                c.showPage()
                c.setFont("Helvetica-Bold" if heading else "Helvetica", 11 if heading else 9)
                y = height - 40
            c.drawString(40, y, part)
            y -= 15

    line("Airport Twin Core / Muenchen-Energiepilot", True)
    line("SYNTHETISCHER REFERENZTEST / NICHT KALIBRIERT", True)
    line("Keine FMG-Betriebsdaten, keine Flughafenpartnerschaft und keine Anlagensteuerung.")
    line("Kein Netz-/Schutz-/Spannungsnachweis, keine reale CO2-/Kosten- oder OTP-Aussage.")
    line(f"Run-ID: {payload['run_id']} | Seed: {payload['seed']}")
    meta = payload.get("model_pack_snapshot", {}).get("calibration_meta", {})
    policy = payload.get("model_pack_snapshot", {}).get("parameter_set", {}).get("policy", "n/a")
    line(f"Regel: {policy} | Modellzeit: 24 Stunden, 5-Minuten-Intervalle")
    line("Modellkriterien: " + ("erfuellt" if payload["pass_fail"] else "nicht erfuellt"))
    line("Das ist ausschliesslich eine interne Modellpruefung, keine empirische Validierung.")
    line(f"Gemeinsamer Welt-Hash: {payload['summary'].get('energy_world_hash', '')}")
    line(f"Audit-Fingerprint: {payload['summary'].get('audit_fingerprint_sha256', '')}")
    line(f"Backend-Commit: {payload.get('build_meta', {}).get('backend_git_commit', 'n/a')}")
    execution_commit = payload.get("build_meta", {}).get("execution_backend_git_commit", "n/a")
    line(f"Ausfuehrungs-Commit: {execution_commit}")
    plan = meta.get("flight_plan_snapshot")
    if plan:
        line("Flugplan-Kontext (nicht betrieblich gekoppelt)", True)
        line(f"Verkehrstag: {plan['service_date']} | Datenstand: {plan['source_data_date']}")
        line(f"Zeitzone: {plan['timezone']} | Manueller PDF-Import, geplante Zeiten, "
             "kein Live-Status")
        line(f"Ankunftseintraege: {plan['arrival_entry_count']} | "
             f"Abflugseintraege: {plan['departure_entry_count']}")
        line(f"Ungeklaerte Mehrfachgruppen: {plan['possible_shared_flight_groups']}")
        line("Eintraege sind keine bestaetigte Zahl physischer Flugbewegungen.")
        line("Energie-v1 nutzt den Plan nur als Kontext; "
             "Ladebedarf und Fristen bleiben synthetisch.")
        line("Keine Fahrzeugauftraege, Positionen oder Flugzeugumlaeufe "
             "aus dem Flugplan ableitbar.")
        line(f"Snapshot/Inhalts-Hash: {plan['content_sha256']}")
        line(f"Original-PDF-SHA256: {plan['source_pdf_sha256']}")
        line(f"Parser: {plan['parser_version']} | Referenzquelle: {plan['source_url']}")
        line("Quellenangabe und Hash sind kein externer Echtheitsnachweis.")
    line("Energie-KPIs (kW / kWh / Anzahl gemaess Feldname)", True)
    for key, value in payload["summary"].get("energy_kpis", {}).items():
        line(f"{key}: {value:.6f}" if isinstance(value, float) else f"{key}: {value}")
    line("Eingefrorene Betriebsannahmen (alle synthetisch)", True)
    for key, value in meta.get("munich_assumptions", {}).items():
        line(f"{key}: {value}")
    line("Bilanz-Konventionen und Grenzen", True)
    line("BHKW-Leistung ist exogen; keine Optimierung ohne Waerme-/Kaelteplanung.")
    line("PV: 3 MWp auf P43/P44 sind Teil der 7 MWp Campus-Referenz, nicht zusaetzlich.")
    line("Quellenzuordnung: BHKW zuerst, PV fuer Restlast/Speicher; keine Gruenstromquote.")
    line("PV-Nutzung umfasst Speicherladung, nicht gesicherte spaetere Nutzung.")
    line("Anfangsenergie im Speicher hat unbekannte Herkunft. Speicher ist hypothetisch.")
    line("Nicht absetzbare BHKW-Erzeugung wird als Modellverletzung ausgewiesen, nicht geregelt.")
    line("kVA * angenommener Leistungsfaktor begrenzt die Ladeabgaenge. Kein Lastflussmodell.")
    line("Frequenz/Spannung/Schaltzeit-Kompatibilitaetsfelder sind Platzhalter, keine Messwerte.")
    line("Ladefristen sind synthetische Auftraege, keine realen Busumlauf-/Flug-OTP-Kennzahlen.")
    line("Quellenstand", True)
    dossier = meta.get("reference_dossier", {})
    line(f"Recherche: {dossier.get('researched_at', 'n/a')}")
    for source in dossier.get("sources", []):
        line(source["title"])
        line(source["url"])
    line("Modellpruefungen", True)
    for assertion in payload["assertions"]:
        status = "erfuellt" if assertion["passed"] else "nicht erfuellt"
        line(f"{assertion['name']}: {assertion['observed']} {assertion['op']} "
             f"{assertion['threshold']} / {status}")
    line("Ladeauftraege", True)
    line("Einzelnachweise und SOC in charging.csv; vollstaendige Quellen/Eingaben in record.json.")
    footer()
    c.save()
