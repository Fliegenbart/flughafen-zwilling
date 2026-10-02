from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app
from app.models import (
    AirportKpiSummary,
    ModelPack,
    PlaybookConstraints,
    PlaybookJobState,
    PlaybookRecord,
    PlaybookRequest,
    PlaybookStatus,
    PlaybookOption,
    RunRecord,
    RunRequest,
    RunState,
    RunStatus,
    ScenarioDefinition,
)
from app.playbook_synth import _option_objective, _pareto_frontier, synthesize_playbook_options
from app.simulators.airport_turnaround import run_airport_turnaround_simulation
from app.storage import FileStorage


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


def _sample_scenario() -> ScenarioDefinition:
    return ScenarioDefinition(
        id="airport_case_test_playbook_v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="playbook test",
        duration_ms=20000,
        tick_ms=40,
        timeline_events=[],
        disturbances=[
            {
                "name": "slot-drop",
                "target": "runway_slot_reduction_pct",
                "start_ms": 3000,
                "duration_ms": 8000,
                "magnitude": 18.0,
            }
        ],
        expected_assertions=[],
    )


def _severe_scenario() -> ScenarioDefinition:
    return ScenarioDefinition(
        id="airport_case_02_guillotine_v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="Guillotine severe case",
        duration_ms=20000,
        tick_ms=40,
        timeline_events=[],
        disturbances=[
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


def test_synth_is_reproducible_for_fixed_search_seed() -> None:
    scenario = _sample_scenario()
    model_pack = _sample_model_pack()
    constraints = PlaybookConstraints()

    first = synthesize_playbook_options(
        scenario=scenario,
        model_pack=model_pack,
        seed=42,
        constraints=constraints,
        search_budget_sec=1,
        search_seed=12345,
        max_candidates=128,
    )
    second = synthesize_playbook_options(
        scenario=scenario,
        model_pack=model_pack,
        seed=42,
        constraints=constraints,
        search_budget_sec=1,
        search_seed=12345,
        max_candidates=128,
    )

    first_actions = [(a.at_ms, a.target, a.action, a.value) for a in first.best_option.actions]
    second_actions = [(a.at_ms, a.target, a.action, a.value) for a in second.best_option.actions]

    assert first.best_option.feasible == second.best_option.feasible
    assert first.best_option.intervention_cost == second.best_option.intervention_cost
    assert first_actions == second_actions
    assert first.candidates_evaluated > 0
    assert second.candidates_evaluated > 0


def test_synth_enforces_action_space_bounds() -> None:
    scenario = ScenarioDefinition(
        id="airport_case_action_bounds_v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="action-space validation",
        duration_ms=9000,
        tick_ms=40,
        timeline_events=[],
        disturbances=[
            {
                "name": "late-disturbance",
                "target": "weather_restriction_pct",
                "start_ms": 8500,
                "duration_ms": 2000,
                "magnitude": 10.0,
            }
        ],
        expected_assertions=[],
    )
    model_pack = _sample_model_pack()
    constraints = PlaybookConstraints()

    synth = synthesize_playbook_options(
        scenario=scenario,
        model_pack=model_pack,
        seed=99,
        constraints=constraints,
        search_budget_sec=1,
        search_seed=2026,
        max_candidates=96,
    )

    expected_values = {
        "gates_open_pct": {2.0, 4.0, 6.0, 8.0, 10.0},
        "ground_crew_teams": {1.0, 2.0, 3.0},
        "runway_slots_per_hour": {1.0, 2.0, 3.0, 4.0},
        "baggage_capacity_flights_per_hour": {2.0, 4.0, 6.0, 8.0},
        "departures_per_hour": {-1.0, -2.0, -3.0, -4.0, -5.0},
    }

    all_options = [synth.best_option, *synth.pareto_options]
    assert all_options
    for option in all_options:
        assert len(option.actions) <= 3
        for action in option.actions:
            assert action.target in expected_values
            assert 0 <= action.at_ms <= scenario.duration_ms
            assert float(action.value) in expected_values[action.target]


def test_lexicographic_objective_ordering() -> None:
    base_kpis = AirportKpiSummary(otp_rate_pct=88.0, avg_turnaround_min=50.0, gate_utilization_avg_pct=90.0, delay_avg_min=7.0)
    options = [
        PlaybookOption(
            option_id="late",
            feasible=False,
            violation_penalty=12.0,
            intervention_cost=2.0,
            estimated_airport_kpis=base_kpis,
            objective_tuple=(1.0, 12.0, 2.0, 1.0, 7.0),
        ),
        PlaybookOption(
            option_id="best",
            feasible=True,
            violation_penalty=0.0,
            intervention_cost=4.0,
            estimated_airport_kpis=base_kpis,
            objective_tuple=(0.0, 0.0, 4.0, 1.0, 6.0),
        ),
        PlaybookOption(
            option_id="middle",
            feasible=True,
            violation_penalty=0.0,
            intervention_cost=7.0,
            estimated_airport_kpis=base_kpis,
            objective_tuple=(0.0, 0.0, 7.0, 1.0, 5.0),
        ),
    ]

    ranked = sorted(options, key=_option_objective)
    assert [o.option_id for o in ranked] == ["best", "middle", "late"]


def test_pareto_frontier_drops_dominated_options() -> None:
    def option(option_id: str, otp: float, cost: float, delay: float) -> PlaybookOption:
        return PlaybookOption(
            option_id=option_id,
            feasible=True,
            violation_penalty=0.0,
            intervention_cost=cost,
            estimated_airport_kpis=AirportKpiSummary(
                otp_rate_pct=otp,
                avg_turnaround_min=50.0,
                gate_utilization_avg_pct=90.0,
                delay_avg_min=delay,
            ),
            objective_tuple=(0.0, 0.0, cost, 1.0, delay),
        )

    dominated = option("dominated", otp=90.0, cost=10.0, delay=8.0)
    dominator = option("dominator", otp=91.0, cost=9.0, delay=7.0)
    high_otp = option("high-otp", otp=95.0, cost=18.0, delay=6.0)
    low_cost = option("low-cost", otp=88.0, cost=6.0, delay=9.0)

    frontier = _pareto_frontier([dominated, dominator, high_otp, low_cost])
    frontier_ids = {o.option_id for o in frontier}
    assert "dominated" not in frontier_ids
    assert {"dominator", "high-otp", "low-cost"}.issubset(frontier_ids)


def test_synthesized_best_reduces_penalty_against_baseline_on_severe_case() -> None:
    scenario = _severe_scenario()
    model_pack = _sample_model_pack()
    constraints = PlaybookConstraints()

    baseline_summary, _ = run_airport_turnaround_simulation(
        run_id="baseline",
        scenario=scenario,
        model_pack=model_pack,
        seed=2026,
        realtime_mode="sil",
        adapters=[],
    )
    assert baseline_summary.airport_kpis is not None
    baseline_penalty = (
        max(0.0, constraints.otp_min_pct - baseline_summary.airport_kpis.otp_rate_pct) * 3.0
        + max(0.0, baseline_summary.airport_kpis.avg_turnaround_min - constraints.turnaround_max_min) * 2.0
        + max(0.0, baseline_summary.airport_kpis.gate_utilization_avg_pct - constraints.gate_utilization_max_pct) * 1.5
    )

    synth = synthesize_playbook_options(
        scenario=scenario,
        model_pack=model_pack,
        seed=2026,
        constraints=constraints,
        search_budget_sec=2,
        search_seed=2026,
        max_candidates=160,
    )

    assert synth.best_option.violation_penalty <= baseline_penalty


def test_playbook_endpoints_are_404_when_feature_disabled(tmp_path) -> None:
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    capabilities = client.get("/api/v1/capabilities")
    assert capabilities.status_code == 200
    assert capabilities.json()["playbook_synth_enabled"] is False

    list_jobs = client.get("/api/v1/playbook-jobs")
    assert list_jobs.status_code == 404

    create_job = client.post(
        "/api/v1/playbook-jobs",
        json={
            "scenario_id": "missing",
            "model_pack_id": "missing",
            "seed": 1,
        },
    )
    assert create_job.status_code == 404


def test_playbook_job_lifecycle_and_artifacts_when_enabled(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    monkeypatch.setenv("TWIN_PLAYBOOK_BUDGET_SEC_MAX", "2")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    scenario_payload = _severe_scenario().model_dump(mode="json")
    model_pack_payload = _sample_model_pack().model_dump(mode="json")
    assert client.post("/api/v1/scenarios", json=scenario_payload).status_code == 200
    assert client.post("/api/v1/model-packs", json=model_pack_payload).status_code == 200

    create = client.post(
        "/api/v1/playbook-jobs",
        json={
            "scenario_id": scenario_payload["id"],
            "model_pack_id": model_pack_payload["id"],
            "seed": 2026,
            "search_budget_sec": 999,
            "max_options": 3,
        },
    )
    assert create.status_code == 200
    job_id = create.json()["job_id"]

    terminal = _wait_for_job_terminal(client, job_id)
    assert terminal["state"] == "completed"

    status = client.get(f"/api/v1/playbook-jobs/{job_id}")
    assert status.status_code == 200
    assert status.json()["state"] == "completed"

    record = client.get(f"/api/v1/playbook-jobs/{job_id}/record")
    assert record.status_code == 200
    payload = record.json()
    assert payload["request"]["search_budget_sec"] == 2
    assert payload["candidates_evaluated"] > 0
    assert payload["frontier_size"] >= 1
    assert payload["baseline_option"] is not None
    assert payload["best_option"] is not None
    assert set(payload["artifacts"]) == {"record.json", "frontier.json", "playbook.md", "summary.csv"}

    for artifact_name in payload["artifacts"]:
        artifact_res = client.get(f"/api/v1/playbook-jobs/{job_id}/artifacts/{artifact_name}")
        assert artifact_res.status_code == 200

    validation_run_ids = []
    baseline = payload["baseline_option"]
    assert baseline["validated_airport_kpis"] is not None
    assert baseline["delta_to_baseline"]["otp_rate_pct_delta"] == 0
    if baseline.get("validation_run_id"):
        validation_run_ids.append(baseline["validation_run_id"])
    best = payload["best_option"]
    if best and best.get("validation_run_id"):
        validation_run_ids.append(best["validation_run_id"])
    assert best["validated_airport_kpis"] is not None
    assert "otp_rate_pct_delta" in best["delta_to_baseline"]
    for option in payload.get("pareto_options", []):
        if option.get("validation_run_id"):
            validation_run_ids.append(option["validation_run_id"])
        assert option["validated_airport_kpis"] is not None
        assert "delay_avg_min_delta" in option["delta_to_baseline"]

    assert validation_run_ids
    for run_id in validation_run_ids:
        run_status = client.get(f"/api/v1/runs/{run_id}")
        assert run_status.status_code == 200
        assert run_status.json()["state"] in {"completed", "failed"}


def test_playbook_create_returns_404_for_missing_refs_when_enabled(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    app = create_app(data_dir=tmp_path / "data")
    client = TestClient(app)

    response = client.post(
        "/api/v1/playbook-jobs",
        json={
            "scenario_id": "does-not-exist",
            "model_pack_id": "does-not-exist",
            "seed": 2026,
        },
    )
    assert response.status_code == 404


def test_queued_run_completes_after_restart_recovery(tmp_path) -> None:
    data_dir = tmp_path / "data"
    storage = FileStorage(data_dir)
    storage.save_scenario(_sample_scenario())
    storage.save_model_pack(_sample_model_pack())

    run_id = "recovered-queued-run"
    storage.save_run_record(
        RunRecord(
            status=RunStatus(
                run_id=run_id,
                state=RunState.queued,
                progress=0,
                scenario_id="airport_case_test_playbook_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                realtime_mode="sil",
            ),
            request=RunRequest(
                scenario_id="airport_case_test_playbook_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                realtime_mode="sil",
                adapters=[],
                assertions=[],
            ),
            build_meta={"backend_git_commit": "dev"},
        )
    )

    app = create_app(data_dir=data_dir)
    client = TestClient(app)
    terminal = _wait_for_run_terminal(client, run_id)
    assert terminal["state"] == "completed"


def test_running_run_is_reset_and_completed_after_restart_recovery(tmp_path) -> None:
    data_dir = tmp_path / "data"
    storage = FileStorage(data_dir)
    storage.save_scenario(_sample_scenario())
    storage.save_model_pack(_sample_model_pack())

    run_id = "recovered-running-run"
    run_dir = storage.run_dir(run_id)
    (run_dir / "telemetry.jsonl").write_text("stale\n", encoding="utf-8")
    storage.save_run_record(
        RunRecord(
            status=RunStatus(
                run_id=run_id,
                state=RunState.running,
                progress=42,
                scenario_id="airport_case_test_playbook_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                realtime_mode="sil",
                error="old-error",
            ),
            request=RunRequest(
                scenario_id="airport_case_test_playbook_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                realtime_mode="sil",
                adapters=[],
                assertions=[],
            ),
            build_meta={"backend_git_commit": "dev", "recovery_count": 1},
        )
    )

    app = create_app(data_dir=data_dir)
    client = TestClient(app)
    terminal = _wait_for_run_terminal(client, run_id)
    assert terminal["state"] == "completed"

    record = client.get(f"/api/v1/runs/{run_id}/record").json()
    assert record["build_meta"]["recovery_count"] == 2
    assert record["build_meta"]["recovered_after_restart"] is True
    assert record["build_meta"]["last_recovered_ts"]


def test_queued_playbook_job_completes_after_restart_recovery(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    data_dir = tmp_path / "data"
    storage = FileStorage(data_dir)
    storage.save_scenario(_severe_scenario())
    storage.save_model_pack(_sample_model_pack())

    job_id = "recovered-queued-playbook"
    storage.save_playbook_record(
        PlaybookRecord(
            status=PlaybookStatus(job_id=job_id, state=PlaybookJobState.queued, progress=0),
            request=PlaybookRequest(
                scenario_id="airport_case_02_guillotine_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                search_budget_sec=1,
                max_options=2,
            ),
            build_meta={"backend_git_commit": "dev"},
        )
    )

    app = create_app(data_dir=data_dir)
    client = TestClient(app)
    terminal = _wait_for_job_terminal(client, job_id)
    assert terminal["state"] == "completed"


def test_running_playbook_job_is_reset_and_completed_after_restart_recovery(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TWIN_ENABLE_PLAYBOOK_SYNTH", "1")
    data_dir = tmp_path / "data"
    storage = FileStorage(data_dir)
    storage.save_scenario(_severe_scenario())
    storage.save_model_pack(_sample_model_pack())
    job_dir = storage.playbook_job_dir("recovered-running-playbook")
    (job_dir / "frontier.json").write_text("stale", encoding="utf-8")

    storage.save_playbook_record(
        PlaybookRecord(
            status=PlaybookStatus(job_id="recovered-running-playbook", state=PlaybookJobState.running, progress=51),
            request=PlaybookRequest(
                scenario_id="airport_case_02_guillotine_v1",
                model_pack_id="airport_medium_eu_v1",
                seed=2026,
                search_budget_sec=1,
                max_options=2,
            ),
            build_meta={"backend_git_commit": "dev", "recovery_count": 1},
        )
    )

    app = create_app(data_dir=data_dir)
    client = TestClient(app)
    terminal = _wait_for_job_terminal(client, "recovered-running-playbook")
    assert terminal["state"] == "completed"

    record = client.get("/api/v1/playbook-jobs/recovered-running-playbook/record").json()
    assert record["build_meta"]["recovery_count"] == 2
    assert record["build_meta"]["recovered_after_restart"] is True
    assert record["baseline_option"] is not None
