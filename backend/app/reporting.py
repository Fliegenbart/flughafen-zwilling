from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .models import AssertionResult, RunRecord, RunSummary


def build_report_payload(
    run_record: RunRecord,
    summary: RunSummary,
    assertion_results: list[AssertionResult],
) -> dict[str, Any]:
    return {
        "run_id": run_record.status.run_id,
        "scenario_id": run_record.status.scenario_id,
        "model_pack_id": run_record.status.model_pack_id,
        "seed": run_record.status.seed,
        "realtime_mode": run_record.status.realtime_mode,
        "pass_fail": run_record.status.pass_fail,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary.model_dump(mode="json"),
        "build_meta": run_record.build_meta,
        "hardware_meta": run_record.hardware_meta,
        "watchdog_summary": run_record.watchdog_summary.model_dump(mode="json"),
        "assertions": [a.model_dump(mode="json") for a in assertion_results],
    }


def write_pdf_report(pdf_path: Path, payload: dict[str, Any]) -> None:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    width, height = A4

    y = height - 40
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Airport Twin Core Report")

    c.setFont("Helvetica", 10)
    y -= 24
    c.drawString(40, y, f"Run ID: {payload['run_id']}")
    y -= 14
    c.drawString(40, y, f"Scenario: {payload['scenario_id']} | Model Pack: {payload['model_pack_id']}")
    y -= 14
    c.drawString(40, y, f"Seed: {payload['seed']} | Mode: {payload['realtime_mode']}")
    y -= 14
    c.drawString(40, y, f"Pass/Fail: {'PASS' if payload['pass_fail'] else 'FAIL'}")
    y -= 20

    airport_kpis = payload.get("summary", {}).get("airport_kpis") or {}
    if airport_kpis:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(40, y, "Airport KPIs")
        y -= 16
        c.setFont("Helvetica", 10)
        for key in [
            "otp_rate_pct",
            "avg_turnaround_min",
            "gate_utilization_avg_pct",
            "ground_crew_utilization_avg_pct",
            "departure_queue_avg_flights",
            "baggage_queue_avg_flights",
            "delay_avg_min",
            "completed_departures",
            "delayed_departures",
        ]:
            if key in airport_kpis:
                c.drawString(50, y, f"{key}: {airport_kpis[key]}")
                y -= 13
                if y < 80:
                    c.showPage()
                    y = height - 40
        y -= 8

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Audit Fingerprint (SHA-256)")
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawString(50, y, payload.get("summary", {}).get("audit_fingerprint_sha256", ""))
    y -= 18

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Build/Firmware")
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawString(50, y, f"backend_git_commit: {payload.get('build_meta', {}).get('backend_git_commit', '')}")
    y -= 13
    firmware_versions = payload.get("hardware_meta", {}).get("firmware_versions", {})
    if isinstance(firmware_versions, dict) and firmware_versions:
        for asset_id, version in firmware_versions.items():
            c.drawString(50, y, f"fw[{asset_id}]: {version}")
            y -= 13
            if y < 80:
                c.showPage()
                y = height - 40
    else:
        c.drawString(50, y, "fw: n/a")
        y -= 13

    y -= 8
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Timing / Jitter")
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawString(50, y, f"Target Tick: {payload.get('summary', {}).get('tick_target_ms', 'scenario.tick_ms')} ms")
    y -= 13
    c.drawString(50, y, f"Avg Drift: {payload.get('summary', {}).get('tick_drift_avg_ms', 0)} ms")
    y -= 13
    c.drawString(50, y, f"Max Drift: {payload.get('summary', {}).get('tick_drift_max_ms', 0)} ms")
    y -= 13
    c.drawString(50, y, f"P99 Drift: {payload.get('summary', {}).get('tick_drift_p99_ms', 0)} ms")
    y -= 18

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Watchdog")
    y -= 16
    c.setFont("Helvetica", 10)
    watchdog = payload.get("watchdog_summary", {})
    c.drawString(50, y, f"config_loaded: {watchdog.get('watchdog_config_loaded', False)}")
    y -= 13
    c.drawString(50, y, f"ticks_ok: {watchdog.get('watchdog_ticks_ok', 0)} | misses: {watchdog.get('watchdog_misses', 0)}")
    y -= 13
    c.drawString(50, y, f"fail_safe: {watchdog.get('watchdog_fail_safe', False)}")
    y -= 13
    if watchdog.get("fail_reason"):
        c.drawString(50, y, f"reason: {watchdog.get('fail_reason')}")
        y -= 13
    y -= 8

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Summary")
    y -= 16
    c.setFont("Helvetica", 10)
    for key, value in payload["summary"].items():
        c.drawString(50, y, f"{key}: {value}")
        y -= 13
        if y < 80:
            c.showPage()
            y = height - 40

    y -= 8
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Assertions")
    y -= 16
    c.setFont("Helvetica", 10)

    for assertion in payload["assertions"]:
        line = (
            f"[{ 'PASS' if assertion['passed'] else 'FAIL' }] "
            f"{assertion['name']} | {assertion['metric']} {assertion['op']} {assertion['threshold']} "
            f"(observed={assertion['observed']})"
        )
        c.drawString(50, y, line)
        y -= 13
        if y < 60:
            c.showPage()
            y = height - 40

    c.save()
