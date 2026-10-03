import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app
from app.models import RunRequest, RunState
from app.run_service import RunService
from app.storage import FileStorage


def completed(client, run_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        status = client.get(f"/api/v1/runs/{run_id}").json()
        if status["state"] in {"completed", "failed"}:
            assert status["state"] == "completed", status
            return client.get(f"/api/v1/runs/{run_id}/record").json()
        time.sleep(0.02)
    raise AssertionError("Run did not finish")


def test_pair_uses_identical_world_frozen_inputs_and_downloadable_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "true")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        reference = client.get("/api/v1/munich/reference").json()
        assert reference["defaults"]["battery_capacity_kwh"] == 0
        assert reference["evidence_level"] == "synthetic_uncalibrated"
        response = client.post("/api/v1/munich/comparisons", json={
            "seed": 42, "assumptions": {"grid_import_limit_kw": 2500},
        })
        assert response.status_code == 202
        pair = response.json()
        records = [completed(client, run["run_id"]) for run in pair["runs"]]
        base, priority = records
        assert base["summary"]["energy_world_hash"] == priority["summary"]["energy_world_hash"] == pair["world_hash"]
        assert base["model_pack_snapshot"]["calibration_meta"]["munich_sessions"] == priority["model_pack_snapshot"]["calibration_meta"]["munich_sessions"]
        assert priority["summary"]["energy_kpis"]["bus_ready_count"] > base["summary"]["energy_kpis"]["bus_ready_count"]
        for record in records:
            run_id = record["status"]["run_id"]
            assert record["summary"]["domain"] == "airport_energy_v1"
            assert record["summary"]["airport_kpis"] is None
            assert record["request"]["adapters"] == []
            assert client.get(f"/api/v1/runs/{run_id}/safety").json()["audit"]["fingerprint_match"]
            assert client.get(f"/api/v1/runs/{run_id}/artifacts/report.pdf").content.startswith(b"%PDF")
            report = client.get(f"/api/v1/runs/{run_id}/artifacts/report.json").json()
            assert report["evidence_level"] == "synthetic_uncalibrated"
            assert report["model_pack_snapshot"]["calibration_meta"]["munich_assumptions"]["grid_import_limit_kw"] == 2500
            csv = client.get(f"/api/v1/runs/{run_id}/artifacts/charging.csv")
            assert csv.status_code == 200
            assert "deadline_met" in csv.text and "BUS-001" in csv.text
            assert client.get(f"/api/v1/runs/{run_id}/telemetry.csv").status_code == 200
        rejected = client.post("/api/v1/playbook-jobs", json={
            "scenario_id": base["request"]["scenario_id"], "model_pack_id": base["request"]["model_pack_id"],
        })
        assert rejected.status_code == 400
        assert "playbook_only_supports" in rejected.text
        for source_kind, extra in [
            ("run_snapshot", {"source_run_id": base["status"]["run_id"]}),
            ("config_snapshot", {"model_pack_id": base["request"]["model_pack_id"]}),
        ]:
            rejected = client.post("/api/v1/playbook-jobs", json={"source_kind": source_kind, **extra})
            assert rejected.status_code == 400
        invalid_run = client.post("/api/v1/runs", json={
            "scenario_id": base["request"]["scenario_id"], "model_pack_id": base["request"]["model_pack_id"],
            "realtime_mode": "hil_realtime",
        })
        assert invalid_run.status_code == 400
        invalid_run = client.post("/api/v1/runs", json={
            "scenario_id": base["request"]["scenario_id"],
            "model_pack_id": base["request"]["model_pack_id"],
            "adapters": [{"name": "mqtt", "transport": "live"}],
        })
        assert invalid_run.status_code == 400


def test_cross_domain_packs_and_incomplete_assumptions_are_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        pair = client.post("/api/v1/munich/comparisons", json={}).json()
        original = completed(client, pair["runs"][0]["run_id"])
        completed(client, pair["runs"][1]["run_id"])
        client.post("/api/v1/scenarios", json={"id": "old-airport", "version": "1"})
        assert client.post("/api/v1/runs", json={
            "scenario_id": "old-airport", "model_pack_id": original["request"]["model_pack_id"],
        }).status_code == 400
        pack = original["model_pack_snapshot"]
        pack["calibration_meta"]["munich_assumptions"].pop("grid_import_limit_kw")
        client.post("/api/v1/model-packs", json=pack)
        assert client.post("/api/v1/runs", json=original["request"]).status_code == 400


def test_invalid_pilot_inputs_never_create_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        for payload in [{"assumptions": {"parking_sessions": 276}}, {"seed": -1},
                        {"assumptions": {"power_factor": 0}}, {"assumptions": {"real_site": True}}]:
            assert client.post("/api/v1/munich/comparisons", json=payload).status_code == 422
        assert client.get("/api/v1/runs").json() == []


def test_energy_run_recovery_keeps_world_and_audit(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        pair = client.post("/api/v1/munich/comparisons", json={"seed": 7}).json()
        original = completed(client, pair["runs"][0]["run_id"])
        completed(client, pair["runs"][1]["run_id"])
    storage = FileStorage(tmp_path)
    runs = RunService(storage, Settings.load())
    request = RunRequest.model_validate(original["request"])
    status = runs.queue_run(request)
    record = storage.get_run_record(status.run_id)
    record.status.state = RunState.running
    record.status.progress = 70
    storage.save_run_record(record)
    (storage.run_dir(status.run_id) / "charging.csv").write_text("partial")
    # The catalog can change, but the queue snapshot remains authoritative.
    model = storage.get_model_pack(request.model_pack_id)
    model.calibration_meta["munich_assumptions"]["background_load_kw"] = 1
    storage.save_model_pack(model)
    with TestClient(create_app(data_dir=tmp_path)) as client:
        recovered = completed(client, status.run_id)
        assert recovered["summary"]["energy_world_hash"] == original["summary"]["energy_world_hash"]
        assert recovered["summary"]["energy_kpis"] == original["summary"]["energy_kpis"]
        assert recovered["build_meta"]["recovery_count"] == 1
        assert recovered["build_meta"]["execution_backend_git_commit"] == Settings.load().build_git_commit
        assert client.get(f"/api/v1/runs/{status.run_id}/safety").json()["audit"]["fingerprint_match"]
        csv = client.get(f"/api/v1/runs/{status.run_id}/artifacts/charging.csv")
        assert csv.status_code == 200
        assert "partial" not in csv.text
