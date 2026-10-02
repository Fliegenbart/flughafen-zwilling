from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app
from app.models import ModelPack, ScenarioDefinition


def _sample_model_pack() -> ModelPack:
    return ModelPack(
        id="airport_medium_eu_v1",
        site_profile="airport-medium-eu",
        assets=[],
        parameter_set={
            "gates_total": 28.0,
            "gates_open_pct": 96.0,
            "arrivals_per_hour": 24.0,
            "departures_per_hour": 24.0,
            "base_turnaround_min": 44.0,
            "ground_crew_teams": 14.0,
            "crew_capacity_flights_per_hour": 1.8,
            "baggage_capacity_flights_per_hour": 26.0,
            "runway_slots_per_hour": 28.0,
        },
        calibration_meta={},
    )


def _forecast_template_scenario() -> ScenarioDefinition:
    return ScenarioDefinition(
        id="airport_case_forecast_template_v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="Forecast template",
        duration_ms=60_000,
        tick_ms=40,
        timeline_events=[
            {
                "at_ms": 20_000,
                "action": "inject",
                "target": "ground_crew_teams",
                "value": 2,
            }
        ],
        disturbances=[
            {
                "name": "forecast-bag-wave",
                "target": "baggage_jam_pct",
                "start_ms": 10_000,
                "duration_ms": 20_000,
                "magnitude": 14.0,
            }
        ],
        expected_assertions=[],
    )


def _wait_for_job_terminal(client: TestClient, job_id: str, timeout_s: float = 15.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/api/v1/playbook-jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["state"] in {"completed", "failed"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Playbook job {job_id} did not complete in time")


def _wait_for_run_terminal(client: TestClient, run_id: str, timeout_s: float = 10.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/api/v1/runs/{run_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["state"] in {"completed", "failed"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not complete in time")


def test_config_snapshot_forecast_job_creates_derived_scenario_and_model_pack(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    monkeypatch.setenv("TWIN_PLAYBOOK_BUDGET_SEC_MAX", "2")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    scenario_payload = _forecast_template_scenario().model_dump(mode="json")
    model_pack_payload = _sample_model_pack().model_dump(mode="json")
    assert client.post("/api/v1/scenarios", json=scenario_payload).status_code == 200
    assert client.post("/api/v1/model-packs", json=model_pack_payload).status_code == 200

    create = client.post(
        "/api/v1/playbook-jobs",
        json={
            "source_kind": "config_snapshot",
            "scenario_id": scenario_payload["id"],
            "model_pack_id": model_pack_payload["id"],
            "seed": 2026,
            "forecast_horizon_min": 30,
            "search_budget_sec": 1,
            "max_options": 2,
            "config_snapshot": {
                "gates_open_pct": 88.0,
                "departures_per_hour": 22.0,
            },
        },
    )
    assert create.status_code == 200
    job_id = create.json()["job_id"]

    terminal = _wait_for_job_terminal(client, job_id)
    assert terminal["state"] == "completed"

    record = client.get(f"/api/v1/playbook-jobs/{job_id}/record")
    assert record.status_code == 200
    payload = record.json()
    assert payload["build_meta"]["forecast_mode"] is True
    assert payload["build_meta"]["forecast_source_kind"] == "config_snapshot"
    assert payload["build_meta"]["forecast_horizon_min"] == 30
    assert payload["baseline_option"] is not None
    assert payload["best_option"] is not None

    derived_scenario_id = payload["build_meta"]["derived_forecast_scenario_id"]
    derived_model_pack_id = payload["build_meta"]["derived_forecast_model_pack_id"]
    assert derived_scenario_id
    assert derived_model_pack_id

    derived_scenario = client.get(f"/api/v1/scenarios/{derived_scenario_id}")
    assert derived_scenario.status_code == 200
    derived_scenario_payload = derived_scenario.json()
    assert derived_scenario_payload["duration_ms"] == 1_800_000
    assert derived_scenario_payload["metadata"]["generated_by"] == "forecast_mode"

    derived_model_pack = client.get(f"/api/v1/model-packs/{derived_model_pack_id}")
    assert derived_model_pack.status_code == 200
    derived_model_pack_payload = derived_model_pack.json()
    assert derived_model_pack_payload["parameter_set"]["gates_open_pct"] == 88.0
    assert derived_model_pack_payload["parameter_set"]["departures_per_hour"] == 22.0


def test_run_snapshot_forecast_job_uses_source_run_context(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    monkeypatch.setenv("TWIN_PLAYBOOK_BUDGET_SEC_MAX", "2")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    scenario_payload = _forecast_template_scenario().model_dump(mode="json")
    model_pack_payload = _sample_model_pack().model_dump(mode="json")
    assert client.post("/api/v1/scenarios", json=scenario_payload).status_code == 200
    assert client.post("/api/v1/model-packs", json=model_pack_payload).status_code == 200

    run = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": scenario_payload["id"],
            "model_pack_id": model_pack_payload["id"],
            "seed": 2026,
            "realtime_mode": "sil",
            "adapters": [],
            "assertions": [],
        },
    )
    assert run.status_code == 200
    run_id = run.json()["run_id"]
    terminal_run = _wait_for_run_terminal(client, run_id)
    assert terminal_run["state"] == "completed"

    create = client.post(
        "/api/v1/playbook-jobs",
        json={
            "source_kind": "run_snapshot",
            "source_run_id": run_id,
            "forecast_horizon_min": 60,
            "seed": 2026,
            "search_budget_sec": 1,
            "max_options": 2,
        },
    )
    assert create.status_code == 200
    job_id = create.json()["job_id"]

    terminal = _wait_for_job_terminal(client, job_id)
    assert terminal["state"] == "completed"

    payload = client.get(f"/api/v1/playbook-jobs/{job_id}/record").json()
    assert payload["build_meta"]["forecast_mode"] is True
    assert payload["build_meta"]["forecast_source_kind"] == "run_snapshot"
    assert payload["build_meta"]["source_run_id"] == run_id
    assert payload["build_meta"]["source_scenario_id"] == scenario_payload["id"]
    assert payload["build_meta"]["source_model_pack_id"] == model_pack_payload["id"]
    assert payload["build_meta"]["derived_forecast_scenario_id"]
    assert payload["build_meta"]["derived_forecast_model_pack_id"]

    derived_scenario = client.get(f"/api/v1/scenarios/{payload['build_meta']['derived_forecast_scenario_id']}")
    assert derived_scenario.status_code == 200
    assert derived_scenario.json()["metadata"]["source_run_id"] == run_id


def test_run_snapshot_forecast_returns_404_for_missing_run(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.post(
        "/api/v1/playbook-jobs",
        json={
            "source_kind": "run_snapshot",
            "source_run_id": "missing-run",
            "forecast_horizon_min": 30,
            "seed": 2026,
        },
    )
    assert response.status_code == 404
