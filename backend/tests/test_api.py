from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from threading import Thread

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app
from app.config import Settings
from app.models import RunRequest, ScenarioDefinition
from app.run_service import RunService
from app.storage import FileStorage


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
        "id": "scenario-airport-turnaround-v1",
        "version": "1.0.0",
        "domain": "airport_turnaround_v1",
        "description": "Airport turnaround baseline scenario",
        "duration_ms": 4000,
        "tick_ms": 40,
        "timeline_events": [
            {"at_ms": 800, "action": "inject", "target": "arrivals_per_hour", "value": 2.0},
            {"at_ms": 1600, "action": "inject", "target": "departures_per_hour", "value": 2.0},
        ],
        "disturbances": [
            {
                "name": "short staffing gap",
                "target": "staffing_shortage_pct",
                "start_ms": 2000,
                "duration_ms": 1000,
                "magnitude": 8.0,
            }
        ],
        "expected_assertions": [
            {"name": "OTP floor", "metric": "otp_rate_pct", "op": ">=", "threshold": 80.0},
            {"name": "Turnaround budget", "metric": "avg_turnaround_min", "op": "<=", "threshold": 60.0},
        ],
    }


def _sample_model_pack_payload() -> dict:
    return {
        "id": "model-pack-airport-medium-a",
        "site_profile": "airport-medium-eu",
        "assets": [
            {"id": "gates-main", "type": "gates", "name": "Terminal Main", "limits": {"count": 28}},
            {"id": "ground-ops", "type": "ground_ops", "name": "Ground Ops", "limits": {"teams": 14}},
        ],
        "parameter_set": {
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
        "calibration_meta": {"source": "lab-baseline", "revision": "r1"},
    }


def _guillotine_case_payload() -> dict:
    return {
        "id": "airport_case_02_guillotine_v1",
        "version": "1.0.0",
        "domain": "airport_turnaround_v1",
        "description": "Guillotine-Test stress case",
        "duration_ms": 20000,
        "tick_ms": 40,
        "timeline_events": [],
        "disturbances": [
            {
                "name": "gate-collapse",
                "target": "gate_blockage_pct",
                "start_ms": 4000,
                "duration_ms": 9000,
                "magnitude": 34.0,
            },
            {
                "name": "slot-collapse",
                "target": "runway_slot_reduction_pct",
                "start_ms": 4000,
                "duration_ms": 9000,
                "magnitude": 32.0,
            },
            {
                "name": "staff-collapse",
                "target": "staffing_shortage_pct",
                "start_ms": 4000,
                "duration_ms": 9000,
                "magnitude": 30.0,
            },
            {
                "name": "security-spike",
                "target": "security_delay_min",
                "start_ms": 4000,
                "duration_ms": 4000,
                "magnitude": 8.0,
            },
        ],
        "expected_assertions": [
            {"name": "OTP", "metric": "airport_kpis.otp_rate_pct", "op": ">=", "threshold": 85.0},
            {"name": "Turnaround", "metric": "airport_kpis.avg_turnaround_min", "op": "<=", "threshold": 55.0},
            {"name": "Gate Utilization", "metric": "airport_kpis.gate_utilization_avg_pct", "op": "<=", "threshold": 92.0},
        ],
    }


def _watchdog_scenario_payload() -> dict:
    return {
        "id": "scenario-watchdog-fault-v1",
        "version": "1.0.0",
        "domain": "airport_turnaround_v1",
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
            "gates_total": 10.0,
            "gates_open_pct": 90.0,
            "arrivals_per_hour": 8.0,
            "departures_per_hour": 8.0,
            "base_turnaround_min": 40.0,
            "ground_crew_teams": 4.0,
            "crew_capacity_flights_per_hour": 1.2,
            "baggage_capacity_flights_per_hour": 8.0,
            "runway_slots_per_hour": 8.0,
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


def test_root_redirects_to_docs(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.get("/", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/docs"


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


def test_capabilities_expose_observability_metadata(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    monkeypatch.setenv("INFLUX_TOKEN", "dev-token")
    monkeypatch.setenv("TWIN_GRAFANA_BASE_URL", "http://127.0.0.1:3000")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.get("/api/v1/capabilities")
    assert response.status_code == 200
    payload = response.json()
    assert payload["playbook_synth_enabled"] is True
    assert payload["telemetry_stream_enabled"] is True
    assert payload["grafana_base_url"] == "http://127.0.0.1:3000"


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
        "scenario_id": "scenario-airport-turnaround-v1",
        "model_pack_id": "model-pack-airport-medium-a",
        "seed": 20260221,
        "realtime_mode": "hil_realtime",
        "adapters": [
            {
                "name": "modbus",
                "enabled": True,
                "endpoint": "sim://modbus-test",
                "profile": "airport_medium_eu_v1",
                "mapping": {"otp_pct": "41001@100"},
                "watchdog_enabled": True,
                "watchdog_signal": "40100@1",
            },
            {
                "name": "opcua",
                "enabled": True,
                "endpoint": "sim://opcua-test",
                "profile": "airport_medium_eu_v1",
                "mapping": {"turnaround_avg_min": "ns=2;s=airport.turnaround.avg_min"},
            },
        ],
        "hardware_meta": {
            "firmware_versions": {
                "gates-main": "fw-1.0.0",
                "ground-ops": "fw-1.2.0",
            }
        },
        "assertions": [
            {"name": "OTP custom", "metric": "airport_kpis.otp_rate_pct", "op": ">=", "threshold": 80.0}
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
    assert record_payload["summary"]["domain"] == "airport_turnaround_v1"
    assert record_payload["summary"]["airport_kpis"]["otp_rate_pct"] >= 0
    assert record_payload["watchdog_summary"]["watchdog_config_loaded"] is True
    assert record_payload["watchdog_summary"]["watchdog_ticks_ok"] > 0
    assert "backend_git_commit" in record_payload["build_meta"]
    assert "firmware_versions" in record_payload["hardware_meta"]
    assert len(record_payload["assertion_results"]) >= 1


def test_guillotine_case_run_starts_and_completes(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_guillotine_case_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "airport_case_02_guillotine_v1",
            "model_pack_id": "model-pack-airport-medium-a",
            "seed": 20260222,
            "realtime_mode": "sil",
            "adapters": [],
            "assertions": [],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    status = _wait_for_terminal_state(client, run_id)
    assert status["state"] == "completed"
    assert status["pass_fail"] is not None

    record = client.get(f"/api/v1/runs/{run_id}/record")
    assert record.status_code == 200
    payload = record.json()
    assert payload["summary"]["domain"] == "airport_turnaround_v1"
    assert payload["summary"]["airport_kpis"]["delay_avg_min"] >= 0.0


def test_safety_and_csv_endpoints(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_sample_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200

    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-airport-turnaround-v1",
            "model_pack_id": "model-pack-airport-medium-a",
            "seed": 991,
            "realtime_mode": "sil",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://modbus-test",
                    "profile": "airport_medium_eu_v1",
                    "mapping": {"otp_pct": "41001@100"},
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


def test_telemetry_slice_endpoint_streams_incremental_samples(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("INFLUX_TOKEN", raising=False)
    data_dir = tmp_path / "data"
    app = create_app(data_dir=data_dir)
    client = TestClient(app)
    storage = FileStorage(data_dir)
    service = RunService(storage, Settings.load())

    assert client.post("/api/v1/scenarios", json=_watchdog_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_watchdog_model_pack_payload()).status_code == 200

    status = service.queue_run(
        RunRequest(
            scenario_id="scenario-watchdog-fault-v1",
            model_pack_id="model-pack-watchdog-fault-v1",
            seed=4242,
            realtime_mode="hil_realtime",
            adapters=[],
            assertions=[],
        )
    )
    worker = Thread(target=service.execute_run, args=(status.run_id,), daemon=True)
    worker.start()

    payload = None
    deadline = time.time() + 3.0
    while time.time() < deadline:
        response = client.get(f"/api/v1/runs/{status.run_id}/telemetry-slice", params={"cursor": 0, "limit": 32})
        assert response.status_code == 200
        candidate = response.json()
        if candidate["items"] and worker.is_alive():
            payload = candidate
            break
        time.sleep(0.05)

    worker.join(timeout=5.0)

    assert payload is not None
    assert payload["next_cursor"] > 0
    assert payload["complete"] is False
    assert any(item["metric"] == "otp_pct" for item in payload["items"])

    terminal = client.get(f"/api/v1/runs/{status.run_id}")
    assert terminal.status_code == 200
    assert terminal.json()["state"] == "completed"


def test_audit_fingerprint_mismatch_on_telemetry_tamper(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    assert client.post("/api/v1/scenarios", json=_sample_scenario_payload()).status_code == 200
    assert client.post("/api/v1/model-packs", json=_sample_model_pack_payload()).status_code == 200
    response = client.post(
        "/api/v1/runs",
        json={
            "scenario_id": "scenario-airport-turnaround-v1",
            "model_pack_id": "model-pack-airport-medium-a",
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
    assert any(p["id"] == "airport_medium_eu_v1" for p in profiles)

    response = client.get("/api/v1/mapping-profiles/airport_medium_eu_v1")
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
                "scenario_id": "scenario-airport-turnaround-v1",
                "model_pack_id": "model-pack-airport-medium-a",
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


def test_airport_case_seed_files_validate_against_scenario_definition() -> None:
    scenarios_dir = ROOT.parent / "data" / "scenarios"
    expected_ids = [
        "airport_case_01_spitzenwelle_v1",
        "airport_case_02_guillotine_v1",
        "airport_case_03_wetter_kompression_v1",
        "airport_case_04_gepaeckstau_v1",
        "airport_case_05_personalengpass_v1",
        "airport_case_06_sicherheitswelle_v1",
        "airport_case_07_enteisungsfenster_v1",
        "airport_case_08_schwarzstart_v1",
    ]

    for scenario_id in expected_ids:
        path = scenarios_dir / f"{scenario_id}.json"
        assert path.exists(), f"missing seed file: {path}"
        scenario = ScenarioDefinition.model_validate(json.loads(path.read_text(encoding="utf-8")))
        assert scenario.id == scenario_id
        assert scenario.domain == "airport_turnaround_v1"
        assert scenario.duration_ms == 60000
        assert scenario.tick_ms == 40
        assert [a.metric for a in scenario.expected_assertions] == [
            "airport_kpis.otp_rate_pct",
            "airport_kpis.avg_turnaround_min",
            "airport_kpis.gate_utilization_avg_pct",
        ]
