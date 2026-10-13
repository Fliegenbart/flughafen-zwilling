"""A public demo preview can be materialized as one auditable SIL run."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.main import create_app


def _completed(client: TestClient, run_id: str) -> dict:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        status = client.get(f"/api/v1/runs/{run_id}").json()
        if status["state"] in {"completed", "failed"}:
            assert status["state"] == "completed", status
            return client.get(f"/api/v1/runs/{run_id}/record").json()
        time.sleep(0.02)
    raise AssertionError("Demo run did not finish")


def test_demo_simulation_run_freezes_the_same_inputs_and_kpis_as_preview(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    payload = {
        "grid_import_limit_kw": 2800,
        "storage_kwh": 2000,
        "storage_kw": 1000,
        "pv_factor": 0.5,
        "extra_vehicles": {"pushback_tug": 4},
    }
    with TestClient(create_app(data_dir=tmp_path)) as client:
        preview = client.post("/api/v1/demo/simulation", json=payload)
        created = client.post("/api/v1/demo/simulation/runs", json=payload)

        assert preview.status_code == 200, preview.text
        assert created.status_code == 202, created.text
        status = created.json()
        assert status["state"] == "queued"
        assert status["realtime_mode"] == "sil"
        record = _completed(client, status["run_id"])

    expected = preview.json()
    assert record["request"]["adapters"] == []
    assert record["request"]["realtime_mode"] == "sil"
    assert record["summary"]["domain"] == "airport_coupled_v1"
    assert record["summary"]["energy_world_hash"] == expected["world_hash"]
    assert record["summary"]["coupled_kpis"] == expected["coupled_kpis"]
    assert record["summary"]["energy_kpis"] == expected["energy_kpis"]
    meta = record["model_pack_snapshot"]["calibration_meta"]
    assert meta["coupled_world"]["world_hash"] == expected["world_hash"]
    assert meta["flight_plan_usage"] == "drives_explicit_hypothetical_missions"
    assert meta["demo_synthetic"] is True


def test_demo_simulation_run_rejects_a_full_queue_without_persisting_inputs(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    monkeypatch.setattr("app.exchange.demo.DEMO_RUN_QUEUE_LIMIT", 0)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/v1/demo/simulation/runs", json={})
        assert response.status_code == 429, response.text
        assert client.get("/api/v1/runs").json() == []
