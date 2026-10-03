import json
import sys
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.munich.flightplan import MAX_PDF_BYTES


def synthetic_pdf(rows=None):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, invariant=1)
    text = pdf.beginText(30, 780)
    for line in [
        "Flugplan Muenchen", "Datenstand: 02.10.2026",
        "L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename",
        "Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag",
        *(rows or [
            "L XY 101 - 23:10 06:25 1234567 AAA 03.10.26 24.10.26 2 Test Air",
            "S XY 102 22:40 + 07:10 1234567 BBB 03.10.26 24.10.26 1 Test Air",
        ]),
    ]:
        text.textLine(line)
    pdf.drawText(text)
    pdf.save()
    return buffer.getvalue()


def upload(client, pdf=None, day="2026-10-03"):
    return client.post(
        f"/api/v1/munich/flight-plans?service_date={day}",
        content=pdf if pdf is not None else synthetic_pdf(),
        headers={"Content-Type": "application/pdf"},
    )


def test_pdf_import_is_persistent_idempotent_and_exports_auditable_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.get("/api/v1/munich/flight-plans").json() == []
        first = upload(client)
        assert first.status_code == 201, first.text
        plan = first.json()
        assert plan["arrival_entry_count"] == plan["departure_entry_count"] == 1
        assert plan["service_date"] == "2026-10-03"
        assert plan["source_data_date"] == "2026-10-02"
        assert plan["evidence_level"] == "published_schedule_not_actual"
        second = upload(client)
        assert second.json() == plan
        assert len(client.get("/api/v1/munich/flight-plans").json()) == 1
        endpoint = "/api/v1/munich/flight-plans/" + plan["snapshot_id"]
        assert client.get(endpoint).json() == plan
        csv = client.get(endpoint + "/export.csv")
        assert csv.status_code == 200
        assert "2026-10-03T06:25:00+02:00" in csv.text
        assert "source_pdf_sha256" in csv.text and "source_pages" in csv.text
        assert "XY101" in csv.text
    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.get(endpoint).json() == plan
    assert not list(tmp_path.rglob("*.pdf")), "Raw foreign PDFs must not be retained"


@pytest.mark.parametrize("content,status", [
    (b"not a pdf", 422), (b"%PDF-broken", 422), (b"x" * (MAX_PDF_BYTES + 1), 413),
], ids=["not-pdf", "broken-pdf", "too-large"])
def test_invalid_or_oversized_upload_cannot_create_a_snapshot(content, status, tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert upload(client, content).status_code == status
        assert client.get("/api/v1/munich/flight-plans").json() == []
        assert upload(client, day="../bad").status_code == 422
        assert client.get("/api/v1/munich/flight-plans/" + "a" * 64).status_code == 404
        assert client.post("/api/v1/munich/flight-plans?service_date=2026-10-03",
                           json={"url": "http://localhost:8000/private"}).status_code == 415


def test_comparison_freezes_same_schedule_context_without_fabricating_operational_effects(
    tmp_path, monkeypatch,
):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        plan = upload(client).json()
        request = {"seed": 42, "flight_plan_snapshot_id": plan["snapshot_id"]}
        response = client.post("/api/v1/munich/comparisons", json=request)
        assert response.status_code == 202, response.text
        pair = response.json()
        assert pair["flight_plan_snapshot_id"] == plan["snapshot_id"]
        for run in pair["runs"]:
            end = time.monotonic() + 15
            while time.monotonic() < end:
                status = client.get(f"/api/v1/runs/{run['run_id']}").json()
                if status["state"] in {"completed", "failed"}:
                    break
                time.sleep(0.02)
            assert status["state"] == "completed", status
            record = client.get(f"/api/v1/runs/{run['run_id']}/record").json()
            meta = record["model_pack_snapshot"]["calibration_meta"]
            assert meta["flight_plan_snapshot"] == plan
            assert meta["flight_plan_usage"] == "context_only_not_driving_energy"
            assert record["summary"]["airport_kpis"] is None
            assert record["summary"]["energy_kpis"]["bus_ready_count"] == 50
            assert record["summary"]["energy_world_hash"] == pair["world_hash"]
            assert client.get(f"/api/v1/runs/{run['run_id']}/safety").json()["audit"]["fingerprint_match"]
            from pypdf import PdfReader
            pdf = client.get(f"/api/v1/runs/{run['run_id']}/artifacts/report.pdf").content
            text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
            assert "Flugplan-Kontext" in text and "2026-10-03" in text
            assert plan["content_sha256"] in text.replace("\n", "")
        request["flight_plan_snapshot_id"] = "f" * 64
        assert client.post("/api/v1/munich/comparisons", json=request).status_code == 404
        assert len(client.get("/api/v1/runs").json()) == 2


def test_corrupt_flightplan_cannot_be_selected_and_pdf_parse_timeout_is_bounded(
    tmp_path, monkeypatch,
):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        plan = upload(client).json()
        path = tmp_path / "munich" / "flight_plans" / (plan["snapshot_id"] + ".json")
        payload = json.loads(path.read_text())
        payload["rows"][0]["flight_number"] = "ZZ999"
        path.write_text(json.dumps(payload))
        response = client.post("/api/v1/munich/comparisons", json={
            "flight_plan_snapshot_id": plan["snapshot_id"],
        })
        assert response.status_code == 409
    from app.munich.flightplan_pdf import extract_pages
    import subprocess
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 30)
    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(ValueError, match="Zeitlimit"):
        extract_pages(synthetic_pdf())


def test_slow_upload_releases_the_import_lock_without_creating_partial_data(tmp_path, monkeypatch):
    import asyncio
    from starlette.requests import Request
    from app.munich import flightplan_router

    async def slow_stream(self):
        await asyncio.sleep(0.1)
        yield b"%PDF-incomplete"

    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        with monkeypatch.context() as patch:
            patch.setattr(flightplan_router, "UPLOAD_TIMEOUT_SEC", 0.01)
            patch.setattr(Request, "stream", slow_stream)
            assert upload(client).status_code == 408
        assert client.get("/api/v1/munich/flight-plans").json() == []
        assert upload(client).status_code == 201
