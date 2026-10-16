"""Stateless public synthetic-day simulation; no project or run is created."""

from __future__ import annotations

import hashlib
import json

from test_variants import client  # noqa: F401

from app.munich.coupled_models import ENGINE_VERSION


def _stable(payload: dict) -> dict:
    """``compute_ms`` measures this request and is intentionally non-deterministic."""
    copy = json.loads(json.dumps(payload))
    copy.pop("compute_ms", None)
    return copy


def test_demo_simulation_baseline_is_deterministic_and_stateless(client):  # noqa: F811
    runs_before = client.get("/api/v1/runs").json()

    first = client.post("/api/v1/demo/simulation", json={})
    second = client.post("/api/v1/demo/simulation", json={})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    payload = first.json()
    assert _stable(payload) == _stable(second.json())
    assert payload["calculation_id"] == payload["input_hash"]
    assert payload["engine_version"] == ENGINE_VERSION
    assert payload["power"]["grid_import_limit_kw"] == 3500
    assert payload["power"]["battery_capacity_kwh"] == 0
    assert payload["changes"] == {}
    assert payload["kpis"]["departures_total"] >= 310
    assert sum(row["count"] for row in payload["departures"]) == payload["kpis"]["departures_total"]
    assert (sum(row["delayed"] for row in payload["departures"])
            == payload["kpis"]["delayed_departures"])
    assert 0 <= payload["kpis"]["on_time_pct"] <= 100
    assert 0 <= payload["kpis"]["energy_wait_share_pct"] <= 100
    assert payload["coupled_kpis"]["mission_count"] > 0
    assert payload["energy_kpis"]["evidence_level"] == "synthetic_uncalibrated"
    assert "synthetic_uncalibrated" in payload["warnings"]
    assert payload["metadata"]["stateless"] is True
    assert payload["metadata"]["scenario"]["seed"] == 7
    assert payload["metadata"]["config_hash"] == hashlib.sha256(
        json.dumps(payload["metadata"]["config"], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    for group in (payload["kpis"], payload["coupled_kpis"], payload["energy_kpis"]):
        assert all(value is None or not isinstance(value, (int, float)) or value >= 0
                   for value in group.values())
    assert client.get("/api/v1/runs").json() == runs_before


def test_demo_simulation_applies_grid_storage_and_vehicle_changes(client):  # noqa: F811
    baseline = client.post("/api/v1/demo/simulation", json={}).json()
    grid = client.post("/api/v1/demo/simulation", json={
        "grid_import_limit_kw": 1500,
    }).json()
    storage = client.post("/api/v1/demo/simulation", json={
        "storage_kwh": 2000, "storage_kw": 1000,
    }).json()
    vehicles = client.post("/api/v1/demo/simulation", json={
        "extra_vehicles": {"pushback_tug": 60},
    }).json()

    assert grid["power"]["grid_import_limit_kw"] == 1500
    assert grid["metadata"]["config"]["power"]["grid_import_limit_kw"] == 1500
    assert grid["energy_kpis"] != baseline["energy_kpis"]
    assert storage["power"]["battery_capacity_kwh"] == 2000
    assert storage["metadata"]["config"]["power"]["battery_power_kw"] == 1000
    assert storage["energy_kpis"] != baseline["energy_kpis"]
    base_tugs = next(f for f in baseline["metadata"]["config"]["fleets"]
                     if f["kind"] == "pushback_tug")
    added_tugs = next(f for f in vehicles["metadata"]["config"]["fleets"]
                      if f["kind"] == "pushback_tug")
    assert added_tugs["vehicles"] == base_tugs["vehicles"] + 60
    assert vehicles["coupled_kpis"] != baseline["coupled_kpis"]
    assert grid["input_hash"] != baseline["input_hash"]
    assert storage["world_hash"] != baseline["world_hash"]
    assert vehicles["world_hash"] != baseline["world_hash"]


def test_demo_simulation_enforces_the_public_lever_whitelist_and_bounds(client):  # noqa: F811
    cases = [
        {"grid_import_limit_kw": 1499},
        {"grid_import_limit_kw": 8001},
        {"storage_kwh": 6001},
        {"storage_kwh": 0, "storage_kw": 100},
        {"pv_factor": 3.01},
        {"extra_vehicles": {"bus": 31, "gpu": 30}},
        {"extra_vehicles": {"not_a_fleet": 1}},
        {"not_a_lever": 1},
    ]
    for body in cases:
        response = client.post("/api/v1/demo/simulation", json=body)
        assert response.status_code == 422, response.text


def test_demo_simulation_zero_storage_is_the_baseline_reset(client):  # noqa: F811
    baseline = client.post("/api/v1/demo/simulation", json={}).json()
    reset = client.post("/api/v1/demo/simulation", json={"storage_kwh": 0}).json()

    assert reset["changes"] == {}
    assert reset["input_hash"] == baseline["input_hash"]
    assert reset["power"]["battery_capacity_kwh"] == 0


def test_demo_simulation_rejects_a_second_request_while_the_demo_cpu_guard_is_held(client):  # noqa: F811
    from app.exchange.demo import _SIMULATION_LOCK

    assert _SIMULATION_LOCK.acquire(blocking=False)
    try:
        response = client.post("/api/v1/demo/simulation", json={})
    finally:
        _SIMULATION_LOCK.release()

    assert response.status_code == 429
