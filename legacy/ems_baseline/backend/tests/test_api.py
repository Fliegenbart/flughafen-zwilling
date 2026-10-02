from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app


def _wait_for_terminal_state(client: TestClient, run_id: str, timeout_s: float = 5.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/api/v1/runs/{run_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["state"] in {"completed", "failed"}:
            return payload
        time.sleep(0.02)
    raise AssertionError(f"Run {run_id} did not complete in time")


def _sample_scenario_payload() -> dict:
    return {
        "id": "scenario-guillotine-v1",
        "version": "1.0.0",
        "description": "Grid outage and load step test",
        "duration_ms": 20000,
        "tick_ms": 40,
        "timeline_events": [
            {"at_ms": 2500, "action": "set", "target": "grid_on", "value": False},
            {"at_ms": 6000, "action": "inject", "target": "critical_load_kw", "value": 20},
        ],
        "disturbances": [
            {
                "name": "short voltage sag",
                "target": "voltage_sag_pct",
                "start_ms": 7000,
                "duration_ms": 2000,
                "magnitude": 2.0,
            }
        ],
        "expected_assertions": [
            {"name": "Frequency floor", "metric": "freq_nadir_hz", "op": ">=", "threshold": 47.0},
            {"name": "Blackout budget", "metric": "blackout_ms", "op": "<=", "threshold": 500.0},
        ],
    }


def _sample_model_pack_payload() -> dict:
    return {
        "id": "model-pack-kaserne-a",
        "site_profile": "kaserne-urban-edge",
        "assets": [
            {"id": "diesel-1", "type": "diesel", "name": "NEA 1", "limits": {"p_max_kw": 400}},
            {"id": "battery-1", "type": "battery", "name": "BESS 1", "limits": {"p_max_kw": 250}},
        ],
        "parameter_set": {
            "nominal_freq_hz": 50.0,
            "nominal_voltage_v": 400.0,
            "critical_load_kw": 120.0,
            "noncritical_load_kw": 180.0,
            "battery_capacity_kwh": 500.0,
            "battery_soc_pct": 85.0,
            "battery_max_kw": 250.0,
            "diesel_max_kw": 400.0,
            "diesel_start_delay_ms": 3500.0,
            "diesel_ramp_time_ms": 14000.0,
            "inverter_switch_time_ms": 18.0,
            "load_shed_delay_ms": 150.0,
        },
        "calibration_meta": {"source": "lab-baseline", "revision": "r1"},
    }


def _watchdog_scenario_payload() -> dict:
    return {
        "id": "scenario-watchdog-fault-v1",
        "version": "1.0.0",
        "description": "Short SIL scenario for watchdog fault injection tests",
        "duration_ms": 2000,
        "tick_ms": 100,
        "timeline_events": [],
        "disturbances": [],
        "expected_assertions": [],
    }


def _watchdog_model_pack_payload() -> dict:
    return {
        "id": "model-pack-watchdog-fault-v1",
        "site_profile": "watchdog-sil",
        "assets": [],
        "parameter_set": {
            "nominal_freq_hz": 50.0,
            "nominal_voltage_v": 400.0,
            "critical_load_kw": 120.0,
            "noncritical_load_kw": 180.0,
            "battery_capacity_kwh": 500.0,
            "battery_soc_pct": 85.0,
            "battery_max_kw": 250.0,
            "diesel_max_kw": 400.0,
            "diesel_start_delay_ms": 3500.0,
            "diesel_ramp_time_ms": 14000.0,
            "inverter_switch_time_ms": 18.0,
            "load_shed_delay_ms": 150.0,
        },
        "calibration_meta": {"source": "watchdog-test"},
    }


def test_health_endpoint(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.get("/api/v1/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"


def test_ready_endpoint(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.get("/api/v1/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["write_ok"] is True
    assert payload["checks"]["profiles_loaded"] is True
    assert payload["checks"]["watchdog_config_loaded"] is True


def test_cors_allowlist(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ALLOWED_ORIGINS", "https://operator.example.com")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    allowed = client.options(
        "/api/v1/health",
        headers={
            "Origin": "https://operator.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers.get("access-control-allow-origin") == "https://operator.example.com"

    blocked = client.options(
        "/api/v1/health",
        headers={
            "Origin": "https://attacker.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert blocked.status_code == 400
    assert blocked.headers.get("access-control-allow-origin") is None

    monkeypatch.delenv("TWIN_ALLOWED_ORIGINS", raising=False)


def test_end_to_end_run_creates_artifacts(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.post("/api/v1/scenarios", json=_sample_scenario_payload())
    assert response.status_code == 200

    response = client.post("/api/v1/model-packs", json=_sample_model_pack_payload())
    assert response.status_code == 200

    run_request = {
        "scenario_id": "scenario-guillotine-v1",
        "model_pack_id": "model-pack-kaserne-a",
        "seed": 20260219,
        "realtime_mode": "hil_realtime",
        "adapters": [
            {
                "name": "modbus",
                "enabled": True,
                "endpoint": "sim://modbus-test",
                "profile": "eon_testinglab_essen_v1",
                "mapping": {"frequency_hz": "40001@100"},
                "watchdog_enabled": True,
                "watchdog_signal": "40100@1",
            },
            {
                "name": "opcua",
                "enabled": True,
                "endpoint": "sim://opcua-test",
                "profile": "eon_testinglab_essen_v1",
                "mapping": {"voltage_v": "ns=2;s=ems.grid.voltage_v"},
            },
        ],
        "hardware_meta": {
            "firmware_versions": {
                "diesel-1": "fw-1.4.2",
                "battery-1": "fw-3.2.9",
            }
        },
        "assertions": [
            {"name": "Switch budget", "metric": "switch_time_ms", "op": "<=", "threshold": 200.0}
        ],
    }
    response = client.post("/api/v1/runs", json=run_request)
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"
    assert status["pass_fail"] is not None
    assert len(status["artifacts"]) == 3

    record = client.get(f"/api/v1/runs/{run_id}/record")
    assert record.status_code == 200
    record_payload = record.json()
    assert record_payload["summary"]["telemetry_hash"]
    assert record_payload["summary"]["audit_fingerprint_sha256"]
    assert record_payload["summary"]["tick_drift_p99_ms"] >= 0
    assert record_payload["watchdog_summary"]["watchdog_config_loaded"] is True
    assert record_payload["watchdog_summary"]["watchdog_ticks_ok"] > 0
    assert "backend_git_commit" in record_payload["build_meta"]
    assert "firmware_versions" in record_payload["hardware_meta"]
    assert len(record_payload["assertion_results"]) >= 1


def test_safety_and_csv_endpoints(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_sample_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-guillotine-v1",
            "model_pack_id": "model-pack-kaserne-a",
            "seed": 991,
            "realtime_mode": "sil",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://modbus-test",
                    "profile": "eon_testinglab_essen_v1",
                    "mapping": {"frequency_hz": "40001@100"},
                    "watchdog_enabled": True,
                    "watchdog_signal": "40100@1",
                    "watchdog_interval_ms": 500,
                    "watchdog_timeout_ms": 1000,
                }
            ],
            "assertions": [],
            "hardware_meta": {"firmware_versions": {"asset-a": "v1.0.0"}},
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"

    safety = client.get(f"/api/v1/runs/{run_id}/safety")
    assert safety.status_code == 200
    safety_payload = safety.json()
    assert safety_payload["audit"]["fingerprint_sha256"]
    assert safety_payload["audit"]["fingerprint_match"] is True
    assert safety_payload["watchdog_summary"]["watchdog_config_loaded"] is True
    assert safety_payload["tick"]["p99_drift_ms"] >= 0

    csv_res = client.get(f"/api/v1/runs/{run_id}/telemetry.csv")
    assert csv_res.status_code == 200
    assert csv_res.headers["content-type"].startswith("text/csv")
    lines = [line for line in csv_res.text.strip().splitlines() if line.strip()]
    assert lines[0] == "ts,source,asset_id,metric,value,quality,unit,run_id"
    assert len(lines) > 2


def test_audit_fingerprint_mismatch_on_telemetry_tamper(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_sample_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200
    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-guillotine-v1",
            "model_pack_id": "model-pack-kaserne-a",
            "seed": 123,
            "realtime_mode": "sil",
            "adapters": [],
            "assertions": [],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"

    telemetry_path = Path(status["artifacts"][0])
    telemetry_path.write_text(telemetry_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")

    safety = client.get(f"/api/v1/runs/{run_id}/safety")
    assert safety.status_code == 200
    payload = safety.json()
    assert payload["audit"]["fingerprint_match"] is False


def test_watchdog_fault_endpoint_always_triggers_failed_run(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app, raise_server_exceptions=False)

    assert client.post("/api/v1/scenarios", json=_watchdog_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_watchdog_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-watchdog-fault-v1",
            "model_pack_id": "model-pack-watchdog-fault-v1",
            "seed": 101,
            "realtime_mode": "sil",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://fault-watchdog?after_successes=0&mode=always",
                    "watchdog_enabled": True,
                    "watchdog_signal": "40100@1",
                    "watchdog_interval_ms": 200,
                    "watchdog_timeout_ms": 300,
                }
            ],
            "assertions": [],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "failed"
    assert "watchdog_timeout" in (status.get("error") or "")

    record = client.get(f"/api/v1/runs/{run_id}/record")
    assert record.status_code == 200
    record_payload = record.json()
    assert record_payload["watchdog_summary"]["watchdog_fail_safe"] is True
    assert record_payload["watchdog_summary"]["fail_reason"]

    safety = client.get(f"/api/v1/runs/{run_id}/safety")
    assert safety.status_code == 200
    safety_payload = safety.json()
    assert safety_payload["state"] == "failed"
    assert safety_payload["watchdog_summary"]["watchdog_fail_safe"] is True
    assert safety_payload["watchdog_summary"]["fail_reason"]
    assert safety_payload["audit"]["fingerprint_match"] is False


def test_watchdog_fault_endpoint_once_recovers_without_timeout(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_watchdog_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_watchdog_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-watchdog-fault-v1",
            "model_pack_id": "model-pack-watchdog-fault-v1",
            "seed": 102,
            "realtime_mode": "sil",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://fault-watchdog?after_successes=0&mode=once",
                    "watchdog_enabled": True,
                    "watchdog_signal": "40100@1",
                    "watchdog_interval_ms": 200,
                    "watchdog_timeout_ms": 1000,
                }
            ],
            "assertions": [],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"

    record = client.get(f"/api/v1/runs/{run_id}/record")
    assert record.status_code == 200
    payload = record.json()
    assert payload["watchdog_summary"]["watchdog_misses"] >= 1
    assert payload["watchdog_summary"]["watchdog_fail_safe"] is False


def test_fault_endpoint_ignored_when_watchdog_disabled(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_watchdog_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_watchdog_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-watchdog-fault-v1",
            "model_pack_id": "model-pack-watchdog-fault-v1",
            "seed": 103,
            "realtime_mode": "sil",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://fault-watchdog?after_successes=0&mode=always",
                    "watchdog_enabled": False,
                    "watchdog_signal": "40100@1",
                    "watchdog_interval_ms": 200,
                    "watchdog_timeout_ms": 300,
                }
            ],
            "assertions": [],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"


def test_mapping_profiles_endpoint(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.get("/api/v1/mapping-profiles")
    assert response.status_code == 200
    profiles = response.json()
    assert any(p["id"] == "eon_testinglab_essen_v1" for p in profiles)

    response = client.get("/api/v1/mapping-profiles/eon_testinglab_essen_v1")
    assert response.status_code == 200
    payload = response.json()
    assert "modbus" in payload["adapters"]


def test_same_seed_is_deterministic(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_sample_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200

    def run_once() -> str:
        response = client.post(
            "/api/v1/runs",
            json={
                "scenario_id": "scenario-guillotine-v1",
                "model_pack_id": "model-pack-kaserne-a",
                "seed": 777,
                "realtime_mode": "sil",
                "adapters": [],
                "assertions": [],
            },
        )
        assert response.status_code == 200
        run_id = response.json()["run_id"]
        status = _wait_for_terminal_state(client, run_id)
        assert status["state"] == "completed"
        record = client.get(f"/api/v1/runs/{run_id}/record")
        assert record.status_code == 200
        return record.json()["summary"]["telemetry_hash"]

    first = run_once()
    second = run_once()
    assert first == second
