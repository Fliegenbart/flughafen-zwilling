import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.munich.flightplan_store import FlightPlanStore
from test_coupled_world import schedule
from test_munich_api import completed


def test_robustness_suite_freezes_a_bounded_shared_demand_and_sil_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    snapshot_path = tmp_path / "munich" / "flight_plans" / f"{plan.snapshot_id}.json"
    original_snapshot = snapshot_path.read_text(encoding="utf-8")

    with TestClient(create_app(data_dir=tmp_path)) as client:
        created = client.post("/api/v1/munich/robustness-suites", json={
            "flight_plan_snapshot_id": plan.snapshot_id,
            "seed": 17,
        })
        assert created.status_code == 202, created.text
        suite = created.json()
        assert suite["suite_id"].isalnum()
        assert suite["source_plan_sha256"] == plan.content_sha256
        assert suite["seed"] == 17
        assert suite["screen"] == "robustness"
        assert suite["engine_version"] == "airport_coupled_v2"
        assert [scenario["key"] for scenario in suite["scenarios"]] == [
            "baseline", "grid_import_minus_20_pct", "one_bus_charger_offline", "pv_peak_factor_minus_50_pct",
        ]
        assert len(suite["runs"]) == 8
        assert {run["policy"] for run in suite["runs"]} == {"uncontrolled", "mission_priority"}
        assert all(run["status"]["state"] == "queued" for run in suite["runs"])
        assert all(run["completed_summary"] is None for run in suite["runs"])
        assert all(run["delta_to_baseline"] is None for run in suite["runs"])
        assert all(scenario["demand_invariant"] for scenario in suite["scenarios"])
        assert len({scenario["mission_signature"] for scenario in suite["scenarios"]}) == 1

        records = [completed(client, run["run_id"]) for run in suite["runs"]]
        assert all(record["request"]["realtime_mode"] == "sil" for record in records)
        assert all(record["request"]["adapters"] == [] for record in records)
        assert all(record["request"]["hardware_meta"]["no_hardware_control"] for record in records)
        assert all(
            record["model_pack_snapshot"]["calibration_meta"]["flight_plan_snapshot"]["content_sha256"]
            == plan.content_sha256
            for record in records
        )

        loaded = client.get(f"/api/v1/munich/robustness-suites/{suite['suite_id']}")
        assert loaded.status_code == 200
        completed_suite = loaded.json()
        baseline = next(s for s in completed_suite["scenarios"] if s["key"] == "baseline")
        grid = next(s for s in completed_suite["scenarios"] if s["key"] == "grid_import_minus_20_pct")
        offline = next(s for s in completed_suite["scenarios"] if s["key"] == "one_bus_charger_offline")
        pv = next(s for s in completed_suite["scenarios"] if s["key"] == "pv_peak_factor_minus_50_pct")
        assert baseline["varied_parameters"] == {}
        assert grid["varied_parameters"] == {"power.grid_import_limit_kw": 2800.0}
        assert offline["varied_parameters"]["stress_events.append"] == {
            "fleet_kind": "bus", "offline_chargers": 1, "start_min": 0, "end_min": 1440,
        }
        assert pv["varied_parameters"] == {"power.pv_peak_factor": 0.275}
        for scenario in completed_suite["scenarios"]:
            for run in scenario["runs"]:
                assert run["status"]["state"] == "completed"
                assert set(run["completed_summary"]) == {
                    "departure_readiness_pct", "grid_peak_kw", "charging_unmet_kwh", "background_unserved_kwh",
                    "energy_wait_total_min", "resource_wait_total_min", "energy_wait_share_pct",
                    "bottleneck",
                }
                if scenario["key"] == "baseline":
                    assert run["delta_to_baseline"] is None
                else:
                    assert set(run["delta_to_baseline"]) == {
                        "departure_readiness_pct", "grid_peak_kw", "charging_unmet_kwh", "background_unserved_kwh",
                        "energy_wait_total_min", "resource_wait_total_min",
                    }

        artifact = client.get(f"/api/v1/munich/robustness-suites/{suite['suite_id']}/artifact.json")
        assert artifact.status_code == 200
        assert artifact.json()["suite_id"] == suite["suite_id"]

        compromised = next(
            run for scenario in completed_suite["scenarios"]
            if scenario["key"] == "grid_import_minus_20_pct"
            for run in scenario["runs"] if run["policy"] == "uncontrolled"
        )
        (tmp_path / "runs" / compromised["run_id"] / "missions.csv").write_text("tampered")
        after_tamper = client.get(f"/api/v1/munich/robustness-suites/{suite['suite_id']}").json()
        compromised_after_tamper = next(
            run for scenario in after_tamper["scenarios"]
            if scenario["key"] == "grid_import_minus_20_pct"
            for run in scenario["runs"] if run["policy"] == "uncontrolled"
        )
        assert compromised_after_tamper["integrity_verified"] is False
        assert compromised_after_tamper["completed_summary"] is None
        assert compromised_after_tamper["delta_to_baseline"] is None

    assert snapshot_path.read_text(encoding="utf-8") == original_snapshot
    assert (tmp_path / "munich" / "robustness_suites" / f"{suite['suite_id']}.json").is_file()


def test_robustness_suite_rejects_invalid_config_without_persisting_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/v1/munich/robustness-suites", json={
            "flight_plan_snapshot_id": plan.snapshot_id,
            "config": {"power": {"unknown_real_asset": 1}},
        })
        assert response.status_code == 422
        assert client.get("/api/v1/runs").json() == []
