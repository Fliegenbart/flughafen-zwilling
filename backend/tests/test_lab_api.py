from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import create_app
from app.lab.models import RunRequest
from app.lab.service import LabService
from app.lab.simulator import simulate


def wait(client, run_id):
    for _ in range(200):
        record = client.get(f"/api/v1/lab/runs/{run_id}").json()
        if record["state"] in ("completed", "failed", "cancelled"):
            return record
        time.sleep(0.01)
    raise AssertionError("No terminal state")


def test_import_lifecycle_exports_and_comparison(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/v1/lab/catalog").json()["live_connection"] is False
        content = client.get("/api/v1/lab/example.csv").text
        payload = {
            "csv_text": content,
            "filename": "example.csv",
            "label": "<script>alert(1)</script>",
        }
        response = client.post("/api/v1/lab/imports", json=payload)
        assert response.status_code == 202
        record = wait(client, response.json()["run_id"])
        assert record["state"] == "completed"
        assert record["source"] == "csv_import"
        assert len(record["source_sha256"]) == 64
        assert record["analysis"]["verdict"] == "pass"
        for name in ("record.json", "trace.csv", "report.html", "source.csv"):
            export = client.get(f"/api/v1/lab/runs/{record['run_id']}/artifacts/{name}")
            assert export.status_code == 200
        report = client.get(f"/api/v1/lab/runs/{record['run_id']}/artifacts/report.html").text
        assert "<script>alert(1)</script>" not in report
        assert "&lt;script&gt;" in report
        inline = client.get(
            f"/api/v1/lab/runs/{record['run_id']}/artifacts/report.html?inline=true"
        )
        assert inline.headers["content-disposition"].startswith("inline")
        assert "default-src 'none'" in inline.headers["content-security-policy"]
        second = client.post("/api/v1/lab/imports", json=payload).json()
        wait(client, second["run_id"])
        compare = client.get(
            f"/api/v1/lab/compare?baseline_id={record['run_id']}&candidate_id={second['run_id']}"
        )
        assert compare.status_code == 200
        assert compare.json()["deltas"]["peak_power_kw"] == 0
        compare_report = client.get(
            f"/api/v1/lab/compare/report.html?baseline_id={record['run_id']}&candidate_id={second['run_id']}"
        )
        assert compare_report.status_code == 200
        assert "BASELINE-VERGLEICH" in compare_report.text
        assert "<script>alert(1)</script>" not in compare_report.text
        bad = client.post(
            "/api/v1/lab/imports", json={**payload, "criteria": {"tolerance_kw": 4}}
        ).json()
        wait(client, bad["run_id"])
        assert (
            client.get(
                f"/api/v1/lab/compare?baseline_id={record['run_id']}&candidate_id={bad['run_id']}"
            ).status_code
            == 409
        )
        assert (
            client.get(f"/api/v1/lab/runs/{record['run_id']}/artifacts/secrets.txt").status_code
            == 404
        )
        assert client.get("/api/v1/lab/runs/not-a-uuid").status_code == 404


def test_invalid_csv_rejected_before_queue(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.post(
            "/api/v1/lab/imports", json={"filename": "bad.csv", "csv_text": "foo\n1\n"}
        )
        assert response.status_code == 422
        assert client.get("/api/v1/lab/runs").json() == []


def test_simulator_reproducible_and_quality_fault():
    request = RunRequest(duration_s=90)
    assert list(simulate(request)) == list(simulate(request))
    from app.lab.analysis import analyze

    assert analyze(list(simulate(request)), request.criteria).verdict == "pass"
    fault = request.model_copy(update={"case_id": "telemetry-loss"})
    assert analyze(list(simulate(fault)), fault.criteria).verdict == "inconclusive"


@pytest.mark.parametrize("state", ["queued", "running"])
def test_recovery_restarts_same_id(tmp_path, state):
    service = LabService(tmp_path)
    record = service.create_simulation(RunRequest(duration_s=60, playback_speed=100))
    path = tmp_path / "lab" / "runs" / record.run_id / "record.json"
    data = json.loads(path.read_text())
    data.update(state=state, progress=0.5, start_ts="old", error="old error")
    path.write_text(json.dumps(data))
    service.start()
    for _ in range(200):
        recovered = service.get(record.run_id)
        if recovered.state == "completed":
            break
        time.sleep(0.01)
    service.stop()
    assert recovered.state == "completed"
    assert recovered.run_id == record.run_id
    assert recovered.recovery_count == 1
    assert recovered.error is None


def test_cancel_queued_is_persistent(tmp_path):
    service = LabService(tmp_path)
    record = service.create_simulation(RunRequest())
    assert service.cancel(record.run_id).state == "cancelled"
    service.start()
    service.stop()
    assert service.get(record.run_id).state == "cancelled"


def test_running_cancel_never_overwrites_terminal_state(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        created = client.post("/api/v1/lab/runs", json={"playback_speed": 100}).json()
        for _ in range(50):
            if client.get(f"/api/v1/lab/runs/{created['run_id']}").json()["state"] == "running":
                break
            time.sleep(0.01)
        cancelled = client.post(f"/api/v1/lab/runs/{created['run_id']}/cancel")
        assert cancelled.json()["state"] == "cancelled"
        time.sleep(0.05)
        assert client.get(f"/api/v1/lab/runs/{created['run_id']}").json()["state"] == "cancelled"
        assert (
            client.get(f"/api/v1/lab/runs/{created['run_id']}/artifacts/report.html").status_code
            == 404
        )


def test_original_import_integrity_is_verified(tmp_path):
    from app.lab.models import ImportRequest

    service = LabService(tmp_path)
    record = service.create_import(
        ImportRequest(
            filename="x.csv",
            csv_text="ts_s,power_kw,setpoint_kw,limit_kw\n0,20,20,80\n20,20,20,80\n",
        )
    )
    (tmp_path / "lab" / "runs" / record.run_id / "source.csv").write_text("tampered")
    service.start()
    for _ in range(100):
        current = service.get(record.run_id)
        if current.state == "failed":
            break
        time.sleep(0.01)
    service.stop()
    assert current.state == "failed"
    assert "SHA256" in current.error
