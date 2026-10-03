import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app
from app.munich.flightplan_store import FlightPlanStore
from app.run_service import RunService
from app.storage import FileStorage
from test_coupled_world import schedule
from test_munich_api import completed


@pytest.fixture
def evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    with TestClient(create_app(data_dir=tmp_path)) as client:
        pair = client.post("/api/v1/munich/coupled-comparisons", json={
            "flight_plan_snapshot_id": plan.snapshot_id,
        }).json()
        records = [completed(client, run["run_id"]) for run in pair["runs"]]
    storage = FileStorage(tmp_path)
    return storage, RunService(storage, Settings.load()), records[0]["status"]["run_id"]


@pytest.mark.parametrize("damage", ["missing", "empty", "subset", "unknown", "invalid_hash"])
def test_incomplete_result_manifest_never_retains_a_positive_audit(evidence, damage):
    storage, service, run_id = evidence
    record = storage.get_run_record(run_id)
    hashes = record.build_meta["result_artifact_hashes"]
    if damage == "missing":
        record.build_meta.pop("result_artifact_hashes")
    elif damage == "empty":
        record.build_meta["result_artifact_hashes"] = {}
    elif damage == "subset":
        record.build_meta["result_artifact_hashes"] = {"missions.csv": hashes["missions.csv"]}
    elif damage == "unknown":
        record.build_meta["result_artifact_hashes"]["unknown.json"] = "0" * 64
    else:
        record.build_meta["result_artifact_hashes"]["missions.csv"] = ["invalid"]
    storage.save_run_record(record)
    audit = service.get_run_safety(run_id).audit
    assert audit["fingerprint_match"] is True
    assert audit["artifact_hashes_match"] is False


@pytest.mark.parametrize("damage", ["summary", "verdict", "assertions", "execution_commit"])
def test_changed_displayed_result_is_rejected_against_the_saved_report(evidence, damage):
    storage, service, run_id = evidence
    record = storage.get_run_record(run_id)
    if damage == "summary":
        record.summary.coupled_kpis.mission_on_time_pct += 1
    elif damage == "verdict":
        record.status.pass_fail = not record.status.pass_fail
    elif damage == "assertions":
        record.assertion_results[0].passed = not record.assertion_results[0].passed
    else:
        record.build_meta["execution_backend_git_commit"] = "not-the-execution-build"
    storage.save_run_record(record)
    audit = service.get_run_safety(run_id).audit
    assert audit["fingerprint_match"] is True
    assert audit.get("report_consistent_match") is False


@pytest.mark.parametrize("name", ["report.json", "report.pdf"])
def test_new_runs_include_reports_in_hash_check(evidence, name):
    storage, service, run_id = evidence
    record = storage.get_run_record(run_id)
    assert {"report.json", "report.pdf"} <= set(record.build_meta["result_artifact_hashes"])
    (storage.run_dir(run_id) / name).write_bytes(b"changed")
    assert service.get_run_safety(run_id).audit["artifact_hashes_match"] is False


def test_missing_telemetry_returns_negative_audit_not_a_server_error(evidence):
    storage, service, run_id = evidence
    storage.telemetry_path(run_id).unlink()
    assert service.get_run_safety(run_id).audit["fingerprint_match"] is False


def test_missing_or_malformed_report_is_not_consistent(evidence):
    storage, service, run_id = evidence
    path = storage.run_dir(run_id) / "report.json"
    for invalid in ["{", json.dumps({"summary": None})]:
        path.write_text(invalid)
        assert service.get_run_safety(run_id).audit.get("report_consistent_match") is False
    path.unlink()
    assert service.get_run_safety(run_id).audit.get("report_consistent_match") is False


def test_completed_v2_result_has_all_seven_artifacts_and_positive_report_check(evidence):
    storage, service, run_id = evidence
    assert set(storage.get_run_record(run_id).build_meta["result_artifact_hashes"]) == {
        "missions.csv", "departures.csv", "vehicles.csv", "parking.csv",
        "coupled-evidence.json", "report.json", "report.pdf",
    }
    audit = service.get_run_safety(run_id).audit
    assert audit["fingerprint_match"] is True
    assert audit["artifact_hashes_match"] is True
    assert audit["report_consistent_match"] is True
    assert audit["reports_hashed"] is True
    assert audit["result_audit_scope"] == "data_and_reports_v2"


def test_legacy_format_remains_consistent_but_is_not_claimed_as_report_hash_proof(evidence):
    storage, service, run_id = evidence
    record = storage.get_run_record(run_id)
    record.build_meta.pop("result_audit_version")
    for name in ["report.json", "report.pdf"]:
        record.build_meta["result_artifact_hashes"].pop(name)
    storage.save_run_record(record)
    path = storage.run_dir(run_id) / "report.json"
    payload = json.loads(path.read_text())
    payload["build_meta"].pop("result_audit_version")
    path.write_text(json.dumps(payload))
    audit = service.get_run_safety(run_id).audit
    assert audit["fingerprint_match"] is True
    assert audit["artifact_hashes_match"] is True
    assert audit["report_consistent_match"] is True
    assert audit["reports_hashed"] is False
    assert audit["result_audit_scope"] == "data_and_report_consistency_v1"
    (storage.run_dir(run_id) / "report.pdf").unlink()
    assert service.get_run_safety(run_id).audit["report_consistent_match"] is False


def test_unknown_audit_version_does_not_downgrade_to_legacy(evidence):
    storage, service, run_id = evidence
    record = storage.get_run_record(run_id)
    record.build_meta["result_audit_version"] = "unknown"
    storage.save_run_record(record)
    audit = service.get_run_safety(run_id).audit
    assert audit["artifact_hashes_match"] is False
    assert audit["result_audit_scope"] == "invalid"
