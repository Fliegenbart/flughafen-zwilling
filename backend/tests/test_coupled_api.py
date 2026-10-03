import json
import csv
import sys
from io import StringIO
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app
from app.models import RunRequest, RunState
from app.munich.flightplan_store import FlightPlanStore
from app.run_service import RunService
from app.storage import FileStorage
from test_coupled_world import schedule
from test_munich_api import completed


def test_coupled_pair_and_artifacts_audit_and_existing_domain_guards(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "true")
    plan = FlightPlanStore(tmp_path).save(schedule())
    with TestClient(create_app(data_dir=tmp_path)) as client:
        ref = client.get("/api/v1/munich/coupled-reference")
        assert ref.status_code == 200
        assert ref.json()["recommendation_only"]
        assert ref.json()["defaults"]["shared_group_policy"] == "reject_unresolved"
        response = client.post("/api/v1/munich/coupled-comparisons", json={
            "flight_plan_snapshot_id": plan.snapshot_id,
        })
        assert response.status_code == 202, response.text
        pair = response.json()
        records = [completed(client, r["run_id"]) for r in pair["runs"]]
        assert len(records) == 2
        for record in records:
            run = record["status"]["run_id"]
            s = record["summary"]
            assert s["domain"] == "airport_coupled_v1"
            assert s["airport_kpis"] is None
            assert s["energy_world_hash"] == pair["world_hash"]
            assert s["coupled_kpis"]["published_entry_count"] == 2
            assert s["coupled_kpis"]["fleet_energy_balance_error_kwh"] < 1e-7
            assert record["request"]["adapters"] == []
            meta = record["model_pack_snapshot"]["calibration_meta"]
            assert meta["flight_plan_snapshot"]["content_sha256"] == plan.content_sha256
            assert meta["flight_plan_usage"] == "drives_explicit_hypothetical_missions"
            for artifact in ["missions.csv", "departures.csv", "vehicles.csv", "parking.csv",
                             "coupled-evidence.json", "report.pdf", "report.json"]:
                fetched = client.get(f"/api/v1/runs/{run}/artifacts/{artifact}")
                assert fetched.status_code == 200, fetched.text
            assert client.get(f"/api/v1/runs/{run}/artifacts/report.pdf").content.startswith(b"%PDF")
            evidence = client.get(f"/api/v1/runs/{run}/artifacts/coupled-evidence.json").json()
            assert len(evidence["missions"]) == s["coupled_kpis"]["mission_count"]
            assert evidence["world_hash"] == pair["world_hash"]
            audit = client.get(f"/api/v1/runs/{run}/safety").json()["audit"]
            assert audit["fingerprint_match"] and audit["artifact_hashes_match"]
            request = record["request"]
            assert client.post("/api/v1/runs", json={**request, "realtime_mode": "hil_realtime"}).status_code == 400
            assert client.post("/api/v1/runs", json={**request, "seed": request["seed"] + 1}).status_code == 400
        assert records[0]["model_pack_snapshot"]["calibration_meta"]["coupled_world"] == records[1]["model_pack_snapshot"]["calibration_meta"]["coupled_world"]
        client.post("/api/v1/scenarios", json={"id": "old-airport", "version": "1"})
        assert client.post("/api/v1/playbook-jobs", json={
            "source_kind": "config_snapshot", "model_pack_id": records[0]["request"]["model_pack_id"],
        }).status_code == 400
        assert client.post("/api/v1/runs", json={
            "scenario_id": "old-airport", "model_pack_id": records[0]["request"]["model_pack_id"],
        }).status_code == 400
    # A damaged result artifact must not retain a positive audit check.
    run = records[0]["status"]["run_id"]
    (FileStorage(tmp_path).run_dir(run) / "missions.csv").write_text("tampered")
    audit = RunService(FileStorage(tmp_path), Settings.load()).get_run_safety(run).audit
    assert audit["fingerprint_match"] and not audit["artifact_hashes_match"]


def test_rejects_ambiguous_unknown_and_invalid_world_without_queued_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule(
        "S XY 101 07:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S XY 102 07:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    ))
    with TestClient(create_app(data_dir=tmp_path)) as client:
        base = {"flight_plan_snapshot_id": plan.snapshot_id}
        assert client.post("/api/v1/munich/coupled-comparisons", json=base).status_code == 400
        assert client.post("/api/v1/munich/coupled-comparisons", json={
            "flight_plan_snapshot_id": "f" * 64,
        }).status_code == 404
        for config in [{"power": {"real_grid": 50}}, {"fleets": []},
                       {"power": {"parking_sessions": 276}}]:
            assert client.post("/api/v1/munich/coupled-comparisons", json={
                **base, "config": config,
            }).status_code == 422
        assert client.get("/api/v1/runs").json() == []


def test_restart_uses_frozen_world_and_replaces_partial_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    with TestClient(create_app(data_dir=tmp_path)) as client:
        pair = client.post("/api/v1/munich/coupled-comparisons", json={
            "flight_plan_snapshot_id": plan.snapshot_id,
        }).json()
        original = completed(client, pair["runs"][0]["run_id"])
        completed(client, pair["runs"][1]["run_id"])
    storage = FileStorage(tmp_path)
    service = RunService(storage, Settings.load())
    queued = service.queue_run(RunRequest.model_validate(original["request"]))
    record = storage.get_run_record(queued.run_id)
    record.status.state = RunState.running
    storage.save_run_record(record)
    (storage.run_dir(queued.run_id) / "missions.csv").write_text("partial")
    pack = storage.get_model_pack(original["request"]["model_pack_id"])
    pack.calibration_meta["coupled_world"]["seed"] = 999
    storage.save_model_pack(pack)
    # The original separate plan file is not needed to recover frozen run input.
    (tmp_path / "munich" / "flight_plans" / (plan.snapshot_id + ".json")).unlink()
    with TestClient(create_app(data_dir=tmp_path)) as client:
        recovered = completed(client, queued.run_id)
        assert recovered["summary"]["coupled_kpis"] == original["summary"]["coupled_kpis"]
        assert recovered["summary"]["energy_world_hash"] == original["summary"]["energy_world_hash"]
        assert recovered["build_meta"]["recovery_count"] == 1
        assert "partial" not in client.get(f"/api/v1/runs/{queued.run_id}/artifacts/missions.csv").text
        assert client.get(f"/api/v1/runs/{queued.run_id}/safety").json()["audit"]["artifact_hashes_match"]


def test_artifact_csv_does_not_execute_strings_as_spreadsheet_formulas():
    from app.munich.coupled_evidence import csv_text
    text = csv_text([{"id": " =HYPERLINK(1)", "minute": -120, "pages": [1, 2]}])
    assert "' =HYPERLINK(1)" in text
    assert "-120" in text and "'-120" not in text
    row = next(csv.DictReader(StringIO(text)))
    assert json.loads(row["pages"]) == [1, 2]
