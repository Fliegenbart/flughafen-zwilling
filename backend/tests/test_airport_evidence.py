from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings
from app.main import create_app
from app.models import ModelPack, PlaybookJobState, PlaybookRequest, RunRequest, RunState, ScenarioDefinition
from app.playbook_service import PlaybookService
from app.run_service import RunService
from app.storage import FileStorage


@pytest.fixture
def services(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "true")
    storage = FileStorage(tmp_path / "data")
    scenario = ScenarioDefinition(id="frozen-airport", version="1", duration_ms=160, tick_ms=40)
    model = ModelPack(id="frozen-model", site_profile="airport", parameter_set={"base_turnaround_min": 44})
    storage.save_scenario(scenario)
    storage.save_model_pack(model)
    runs = RunService(storage, Settings.load())
    return storage, scenario, model, runs


def queue(runs):
    return runs.queue_run(RunRequest(
        scenario_id="frozen-airport", model_pack_id="frozen-model", seed=42,
        realtime_mode="sil", adapters=[],
    )).run_id


def replace_catalog(storage, scenario, model):
    storage.save_scenario(scenario.model_copy(update={"duration_ms": 80}))
    storage.save_model_pack(model.model_copy(update={"parameter_set": {"base_turnaround_min": 90}}))


def test_queued_run_keeps_original_inputs_after_catalog_edit(services):
    storage, scenario, model, runs = services
    run_id = queue(runs)
    replace_catalog(storage, scenario, model)
    runs.execute_run(run_id)
    record = runs.get_run_record(run_id)
    assert record.summary.airport_kpis.avg_turnaround_min < 55
    assert record.model_dump()["scenario_snapshot"]["duration_ms"] == 160
    assert record.model_dump()["model_pack_snapshot"]["parameter_set"]["base_turnaround_min"] == 44
    assert runs.get_run_safety(run_id).audit["fingerprint_match"]


def test_completed_run_audit_survives_later_catalog_edit(services):
    storage, scenario, model, runs = services
    run_id = queue(runs)
    runs.execute_run(run_id)
    replace_catalog(storage, scenario, model)
    assert runs.get_run_safety(run_id).audit["fingerprint_match"]


def test_recovered_run_restarts_with_the_same_frozen_inputs(services):
    storage, scenario, model, runs = services
    run_id = queue(runs)
    record = runs.get_run_record(run_id)
    record.status.state = RunState.running
    record.status.progress = 40
    storage.save_run_record(record)
    replace_catalog(storage, scenario, model)
    recovered = RunService(storage, Settings.load())
    assert run_id in recovered.recover_pending_runs()
    recovered.execute_run(run_id)
    result = recovered.get_run_record(run_id)
    assert result.summary.airport_kpis.avg_turnaround_min < 55
    assert result.build_meta["recovery_count"] == 1
    assert result.build_meta["input_freeze"] == "queued"


def test_run_artifacts_download_with_a_fixed_whitelist(services):
    storage, _, _, runs = services
    run_id = queue(runs)
    runs.execute_run(run_id)
    with TestClient(create_app(data_dir=storage.base_dir)) as client:
        prefix = f"/api/v1/runs/{run_id}/artifacts/"
        pdf = client.get(prefix + "report.pdf")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")
        assert pdf.headers["content-type"] == "application/pdf"
        record = client.get(prefix + "record.json")
        assert record.status_code == 200
        assert record.json()["scenario_snapshot"]["domain"] == "airport_turnaround_v1"
        assert client.get(prefix + "report.json").status_code == 200
        assert client.get(prefix + "telemetry.jsonl").status_code == 200
        (storage.run_dir(run_id) / "private.txt").write_text("not an artifact")
        assert client.get(prefix + "private.txt").status_code == 404
        assert client.get("/api/v1/runs/not-a-run/artifacts/report.pdf").status_code == 404


def test_queued_playbook_and_validation_keep_original_inputs(services):
    storage, scenario, model, runs = services
    planner = PlaybookService(storage, Settings.load(), runs)
    planner.set_run_dispatcher(runs.execute_run)
    status = planner.queue_job(PlaybookRequest(
        scenario_id=scenario.id, model_pack_id=model.id, seed=42,
        search_budget_sec=1, max_options=1,
    ))
    replace_catalog(storage, scenario, model)
    planner.execute_job(status.job_id)
    record = storage.get_playbook_record(status.job_id)
    assert record.baseline_option.validated_airport_kpis.avg_turnaround_min < 55
    assert record.model_dump()["scenario_snapshot"]["duration_ms"] == 160
    assert record.model_dump()["model_pack_snapshot"]["parameter_set"]["base_turnaround_min"] == 44
    validation = runs.get_run_record(record.baseline_option.validation_run_id)
    assert validation.model_dump()["scenario_snapshot"]["duration_ms"] == 160
    assert runs.get_run_safety(validation.status.run_id).audit["fingerprint_match"]


def test_recovered_playbook_restarts_with_the_same_frozen_inputs(services):
    storage, scenario, model, runs = services
    planner = PlaybookService(storage, Settings.load(), runs)
    status = planner.queue_job(PlaybookRequest(
        scenario_id=scenario.id, model_pack_id=model.id, seed=42,
        search_budget_sec=1, max_options=1,
    ))
    record = storage.get_playbook_record(status.job_id)
    record.status.state = PlaybookJobState.running
    storage.save_playbook_record(record)
    replace_catalog(storage, scenario, model)
    recovered = PlaybookService(storage, Settings.load(), runs)
    recovered.set_run_dispatcher(runs.execute_run)
    assert status.job_id in recovered.recover_pending_jobs()
    recovered.execute_job(status.job_id)
    result = storage.get_playbook_record(status.job_id)
    assert result.baseline_option.validated_airport_kpis.avg_turnaround_min < 55
    assert result.build_meta["recovery_count"] == 1
    assert result.build_meta["input_freeze"] == "queued"
