from __future__ import annotations

import sys
from pathlib import Path
from threading import Event, Thread

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.deterministic import _clamp, _compare, _lerp, evaluate_assertions
from app.models import AirportKpiSummary, Disturbance, ExpectedAssertion, ModelPack, RunSummary, ScenarioDefinition
from app.simulators.airport_turnaround import _apply_event, _compute_disturbance_effects, run_airport_turnaround_simulation


@pytest.mark.parametrize("domain", ["airport_turnaround_v1", "ems_legacy_v1"])
def test_telemetry_callback_error_fails_run_without_deadlock(domain: str) -> None:
    from app.deterministic import run_simulation

    done = Event()
    errors: list[Exception] = []
    scenario = ScenarioDefinition(
        id="callback-failure", version="1.0.0", domain=domain,
        duration_ms=80, tick_ms=40,
    )
    model = ModelPack(id="callback-model", site_profile="demo", assets=[], parameter_set={})

    def failing_callback(_sample) -> None:
        raise OSError("simulated telemetry write failure")

    def execute() -> None:
        try:
            run_simulation("test-failure", scenario, model, 42, "sil", [], [], failing_callback)
        except Exception as exc:
            errors.append(exc)
        finally:
            done.set()

    Thread(target=execute, daemon=True).start()
    assert done.wait(3), "Telemetry failure must not strand the serial run worker"
    assert len(errors) == 1
    assert isinstance(errors[0], RuntimeError)
    assert isinstance(errors[0].__cause__, OSError)


def test_clamp_normal_bounds_and_boundaries() -> None:
    assert _clamp(5.0, 0.0, 10.0) == 5.0
    assert _clamp(0.0, 0.0, 10.0) == 0.0
    assert _clamp(10.0, 0.0, 10.0) == 10.0
    assert _clamp(-1.0, 0.0, 10.0) == 0.0
    assert _clamp(11.0, 0.0, 10.0) == 10.0


def test_lerp_with_core_and_out_of_bounds_t_values() -> None:
    assert _lerp(10.0, 20.0, 0.0) == 10.0
    assert _lerp(10.0, 20.0, 1.0) == 20.0
    assert _lerp(10.0, 20.0, 0.5) == 15.0
    assert _lerp(10.0, 20.0, 1.5) == 20.0
    assert _lerp(10.0, 20.0, -0.5) == 10.0


@pytest.mark.parametrize(
    ("observed", "op", "threshold", "expected"),
    [
        (1.0, "<", 2.0, True),
        (2.0, "<", 2.0, False),
        (2.0, "<=", 2.0, True),
        (3.0, "<=", 2.0, False),
        (3.0, ">", 2.0, True),
        (2.0, ">", 2.0, False),
        (3.0, ">=", 3.0, True),
        (2.0, ">=", 3.0, False),
        (4.0, "==", 4.0, True),
        (4.0, "==", 5.0, False),
        (4.0, "!=", 5.0, True),
        (4.0, "!=", 4.0, False),
    ],
)
def test_compare_all_supported_operators(observed: float, op: str, threshold: float, expected: bool) -> None:
    assert _compare(observed, op, threshold) is expected


def test_compute_airport_disturbance_effects_overlap_sums_values() -> None:
    disturbances = [
        Disturbance(
            name="gate-block-a",
            target="gate_blockage_pct",
            start_ms=100,
            duration_ms=200,
            magnitude=5.0,
        ),
        Disturbance(
            name="gate-block-b",
            target="gate_blockage_pct",
            start_ms=120,
            duration_ms=200,
            magnitude=7.5,
        ),
        Disturbance(
            name="security-delay",
            target="security_delay_min",
            start_ms=150,
            duration_ms=100,
            magnitude=3.0,
        ),
    ]

    effects = _compute_disturbance_effects(disturbances, ts_ms=160)
    assert effects["gate_blockage_pct"] == pytest.approx(12.5)
    assert effects["security_delay_min"] == pytest.approx(3.0)


def test_apply_event_inject_toggle_set_for_airport_state() -> None:
    state: dict[str, float | int | bool | str] = {
        "arrivals_per_hour": 10,
        "manual_hold": False,
    }

    _apply_event(state, target="arrivals_per_hour", action="inject", value=2.5)
    assert state["arrivals_per_hour"] == pytest.approx(12.5)

    _apply_event(state, target="manual_hold", action="toggle", value=None)
    assert state["manual_hold"] is True

    _apply_event(state, target="departures_per_hour", action="set", value=11)
    assert state["departures_per_hour"] == 11


def test_evaluate_assertions_supports_airport_kpi_prefix_metrics() -> None:
    summary = RunSummary(
        freq_nadir_hz=49.9,
        volt_nadir_v=398.0,
        blackout_ms=0,
        switch_time_ms=40000,
        final_soc_pct=65.0,
        io_latency_p99_ms=7.5,
        telemetry_hash="abc",
        domain="airport_turnaround_v1",
        airport_kpis=AirportKpiSummary(
            otp_rate_pct=91.0,
            avg_turnaround_min=47.0,
            gate_utilization_avg_pct=86.0,
            ground_crew_utilization_avg_pct=72.0,
            departure_queue_avg_flights=1.1,
            baggage_queue_avg_flights=0.9,
            delay_avg_min=8.0,
            completed_departures=120,
            delayed_departures=9,
        ),
    )

    expected = [
        {"name": "OTP", "metric": "airport_kpis.otp_rate_pct", "op": ">=", "threshold": 85.0},
        {"name": "Turnaround", "metric": "airport_kpis.avg_turnaround_min", "op": "<=", "threshold": 55.0},
    ]

    assertion_specs = [ExpectedAssertion.model_validate(item) for item in expected]
    results, passed = evaluate_assertions(summary, assertion_specs, [])

    assert passed is True
    assert len(results) == 2


def test_airport_default_assertions_are_used_when_none_configured() -> None:
    summary = RunSummary(
        freq_nadir_hz=49.8,
        volt_nadir_v=398.0,
        blackout_ms=0,
        switch_time_ms=52000,
        final_soc_pct=68.0,
        io_latency_p99_ms=8.0,
        telemetry_hash="abc",
        domain="airport_turnaround_v1",
        airport_kpis=AirportKpiSummary(
            otp_rate_pct=87.0,
            avg_turnaround_min=51.0,
            gate_utilization_avg_pct=90.0,
            ground_crew_utilization_avg_pct=70.0,
            departure_queue_avg_flights=1.2,
            baggage_queue_avg_flights=0.8,
            delay_avg_min=7.0,
            completed_departures=100,
            delayed_departures=13,
        ),
    )

    results, passed = evaluate_assertions(summary, [], [])
    assert passed is True
    assert [r.metric for r in results] == [
        "otp_rate_pct",
        "avg_turnaround_min",
        "gate_utilization_avg_pct",
    ]


def test_guillotine_disturbance_combo_has_higher_delay_and_queue_than_baseline() -> None:
    model_pack = ModelPack(
        id="model-pack-airport-medium-a",
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

    baseline = ScenarioDefinition(
        id="baseline-airport-case-v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="baseline",
        duration_ms=20000,
        tick_ms=40,
        timeline_events=[],
        disturbances=[],
        expected_assertions=[],
    )

    guillotine = ScenarioDefinition(
        id="airport-case-guillotine-v1",
        version="1.0.0",
        domain="airport_turnaround_v1",
        description="guillotine",
        duration_ms=20000,
        tick_ms=40,
        timeline_events=[],
        disturbances=[
            Disturbance(
                name="gate-collapse",
                target="gate_blockage_pct",
                start_ms=4000,
                duration_ms=9000,
                magnitude=34.0,
            ),
            Disturbance(
                name="slot-collapse",
                target="runway_slot_reduction_pct",
                start_ms=4000,
                duration_ms=9000,
                magnitude=32.0,
            ),
            Disturbance(
                name="staff-collapse",
                target="staffing_shortage_pct",
                start_ms=4000,
                duration_ms=9000,
                magnitude=30.0,
            ),
            Disturbance(
                name="security-spike",
                target="security_delay_min",
                start_ms=4000,
                duration_ms=4000,
                magnitude=8.0,
            ),
        ],
        expected_assertions=[],
    )

    baseline_summary, _ = run_airport_turnaround_simulation(
        run_id="baseline-run",
        scenario=baseline,
        model_pack=model_pack,
        seed=20260221,
        realtime_mode="sil",
        adapters=[],
    )
    stress_summary, _ = run_airport_turnaround_simulation(
        run_id="guillotine-run",
        scenario=guillotine,
        model_pack=model_pack,
        seed=20260221,
        realtime_mode="sil",
        adapters=[],
    )

    assert baseline_summary.airport_kpis is not None
    assert stress_summary.airport_kpis is not None
    assert stress_summary.airport_kpis.delay_avg_min > baseline_summary.airport_kpis.delay_avg_min
    assert stress_summary.airport_kpis.departure_queue_avg_flights > baseline_summary.airport_kpis.departure_queue_avg_flights
    assert stress_summary.airport_kpis.otp_rate_pct < baseline_summary.airport_kpis.otp_rate_pct
