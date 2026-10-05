"""Review-Befunde 2-7: Grundlast, Bilanz, Ladefrist je Fahrzeug, Aussagekraft, DST, Version."""
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.deterministic import evaluate_assertions
from app.main import create_app
from app.models import RunSummary
from app.munich import coupled_power
from app.munich.coupled_integration import validate_coupled_inputs
from app.munich.coupled_models import CoupledConfig, CoupledRequest, FleetSpec, PowerConfig
from app.munich.coupled_simulator import simulate_coupled
from app.munich.coupled_world import build_world, verify_world
from app.munich.flightplan_store import FlightPlanStore
from app.munich.robustness_router import _build_variants, _delta
from test_coupled_simulator import simple_world
from test_coupled_world import bus, schedule


def summary_for(result):
    return RunSummary(
        domain="airport_coupled_v1", coupled_kpis=result.kpis, energy_kpis=result.energy,
        energy_world_hash=result.world_hash, telemetry_hash="0" * 64, freq_nadir_hz=0,
        volt_nadir_v=0, blackout_ms=0, switch_time_ms=0, final_soc_pct=0,
        io_latency_p99_ms=0, tick_target_ms=60000,
    )


def test_unserved_background_is_a_hard_criterion_with_visible_cause():
    plan = schedule("S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air")
    _, base = simple_world()
    config = base.config.model_copy(update={"power": base.config.power.model_copy(
        update={"background_load_kw": 500, "grid_import_limit_kw": 100})})
    world = build_world(plan, CoupledConfig.model_validate(config.model_dump()), 42)
    result = simulate_coupled(world, plan, "mission_priority")
    assert result.kpis.background_unserved_kwh > 0
    assert result.kpis.background_unserved_minutes == world.end_min - world.start_min
    assert any("Grundlast" in w and "Ursache" in w for w in result.kpis.model_warnings)
    checks, passed = evaluate_assertions(summary_for(result), [], [])
    assert passed is False
    assert any(c.name.startswith("Grundlast") and not c.passed for c in checks)


def test_supplied_world_has_no_background_warning():
    plan, world = simple_world()
    result = simulate_coupled(world, plan, "uncontrolled")
    assert result.kpis.background_unserved_kwh == 0
    assert not any("Grundlast" in w for w in result.kpis.model_warnings)


def test_independent_fleet_and_storage_balance_detect_a_wrong_supply_side(monkeypatch):
    plan, world = simple_world()
    honest = simulate_coupled(world, plan, "mission_priority")
    assert honest.kpis.fleet_energy_balance_error_kwh < 1e-9
    assert honest.kpis.storage_energy_balance_error_kwh < 1e-9
    assert honest.kpis.power_balance_check == "bookkeeping_identity_not_independent"
    original = coupled_power.PowerBalance.fleet_delivered_kwh
    monkeypatch.setattr(coupled_power.PowerBalance, "fleet_delivered_kwh",
                        lambda self: original(self) + 1.0)
    broken = simulate_coupled(world, plan, "mission_priority")
    assert broken.kpis.fleet_energy_balance_error_kwh == pytest.approx(1.0)
    assert any("Energiebilanz" in w for w in broken.kpis.model_warnings)


def test_charge_deadline_is_per_vehicle_and_never_in_the_past(monkeypatch):
    plan = schedule(
        "S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S XY 104 01:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    )
    config = CoupledConfig(warmup_min=0, drain_min=0, fleets=[bus(
        coverage_pct=100, vehicles=2, chargers=2, battery_capacity_kwh=10,
        initial_soc_pct=0, reserve_soc_pct=0, charge_target_soc_pct=100, charger_kw=60,
        mission_energy_kwh=4, service_duration_min=2, return_min=0,
        departure_lead_min=30, departure_buffer_min=24)],
        power=PowerConfig(grid_import_limit_kw=60, background_load_kw=0, chp_output_kw=0,
                          pv_capacity_kwp=0, parking_sessions=0, transformer_efficiency=1,
                          charging_efficiency=1))
    world = build_world(plan, config, 42)
    deadlines = sorted(m.deadline_min for m in world.missions)
    seen: list[tuple[int, list[int]]] = []
    original = coupled_power.PowerBalance.step

    def capture(self, minute, requests, policy):
        seen.append((minute, sorted(r.deadline for r in requests if r.sector == "apron")))
        return original(self, minute, requests, policy)

    monkeypatch.setattr(coupled_power.PowerBalance, "step", capture)
    simulate_coupled(world, plan, "mission_priority")
    first_minute, first = seen[0]
    assert first == deadlines  # Zwei Fahrzeuge, zwei verschiedene eigene Fristen.
    for minute, values in seen:
        assert all(d >= minute + 2 or d == world.end_min for d in values)


def test_readiness_by_task_and_vehicle_bottleneck_are_reported():
    plan = schedule(
        "S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S XY 104 00:30 09:10 1234567 CCC 03.10.26 27.03.27 1 Test Air",
        "L XY 105 - 23:10 00:20 1234567 AAA 03.10.26 27.03.27 2 Test Air",
    )
    config = CoupledConfig(warmup_min=0, drain_min=0,
                           shared_group_policy="independent_entries_assumption", fleets=[bus(
        coverage_pct=100, vehicles=1, chargers=1, battery_capacity_kwh=100,
        initial_soc_pct=100, reserve_soc_pct=0, charge_target_soc_pct=100, charger_kw=60,
        mission_energy_kwh=1, service_duration_min=10, return_min=0,
        departure_lead_min=30, departure_buffer_min=15, arrival_allowance_min=10)],
        power=PowerConfig(grid_import_limit_kw=1000, background_load_kw=0, chp_output_kw=0,
                          pv_capacity_kwp=0, parking_sessions=0))
    world = build_world(plan, config, 42)
    base = simulate_coupled(world, plan, "uncontrolled")
    prio = simulate_coupled(world, plan, "mission_priority")
    for result in (base, prio):
        k = result.kpis
        assert k.energy_wait_total_min == 0 and k.resource_wait_total_min > 0
        assert k.bottleneck == "resource" and k.energy_wait_share_pct == 0
        assert {(r.kind, r.direction) for r in k.readiness_by_task} == {
            ("bus", "arrival"), ("bus", "departure")}
        assert sum(r.mission_count for r in k.readiness_by_task) == k.mission_count
        assert any("Fahrzeugverfuegbarkeit" in w for w in k.model_warnings)
    assert base.kpis.departure_readiness_pct == prio.kpis.departure_readiness_pct


@pytest.mark.parametrize("day,deadlines", [
    (date(2027, 3, 28), {480, 540, 660, 780}),   # Sommerzeitbeginn: 09:00 CEST = 07:00 UTC
    (date(2026, 10, 25), {600, 660, 780, 900}),  # Winterzeitbeginn: 09:00 CET = 08:00 UTC
    (date(2026, 10, 3), {540, 600, 720, 840}),
])
def test_parking_windows_follow_local_time_on_dst_days(day, deadlines):
    plan = schedule("S XY 102 07:10 09:10 1234567 BBB 03.10.26 28.03.27 1 Test Air", day=day)
    config = CoupledConfig(fleets=[bus(coverage_pct=100)],
                           power=PowerConfig(parking_sessions=60))
    world = build_world(plan, config, 42)
    assert {job.deadline_min for job in world.parking_jobs} <= deadlines
    assert {job.release_min for job in world.parking_jobs} <= {0, 30, 60, 90}
    legacy = build_world(plan, config, 42, "airport_coupled_v1")
    assert legacy.engine_version == "airport_coupled_v1"
    assert {job.deadline_min for job in legacy.parking_jobs} <= {540, 600, 720, 840}
    verify_world(legacy, plan)  # alte Welten bleiben als aeltere Version pruefbar
    verify_world(world, plan)


def test_legacy_engine_runs_are_recognised_and_not_silently_recomputed():
    from app.models import ModelPack, RunRequest, ScenarioDefinition
    plan, _ = simple_world()
    _, current = simple_world()
    legacy = build_world(plan, current.config, 42, "airport_coupled_v1")
    assert legacy.world_hash != current.world_hash
    scenario = ScenarioDefinition(id="legacy_scn", version="1", domain="airport_coupled_v1",
                                  duration_ms=(legacy.end_min - legacy.start_min) * 60000,
                                  tick_ms=60000)
    model = ModelPack(id="legacy_model", site_profile="munich_coupled_reference_v1",
                      parameter_set={"policy": "uncontrolled"}, calibration_meta={
                          "calibrated": False, "engine_version": "airport_coupled_v1",
                          "coupled_world": legacy.model_dump(mode="json"),
                          "flight_plan_snapshot": plan.model_dump(mode="json"),
                          "flight_plan_usage": "drives_explicit_hypothetical_missions"})
    request = RunRequest(scenario_id="legacy_scn", model_pack_id="legacy_model", seed=42, realtime_mode="sil")
    with pytest.raises(ValueError, match="aelterer Engine airport_coupled_v1"):
        validate_coupled_inputs(scenario, model, request)


def test_sensitivity_screen_varies_only_tugs_and_grid_with_invariant_demand():
    plan = schedule()
    request = CoupledRequest(flight_plan_snapshot_id=plan.snapshot_id, seed=7)
    variants = _build_variants(plan, request, "sensitivity")
    assert len(variants) == 9
    assert len({v["mission_signature"] for v in variants}) == 1
    combos = {(v["varied_parameters"]["fleets.pushback_tug.vehicles"],
               v["varied_parameters"]["power.grid_import_limit_kw"]) for v in variants}
    assert combos == {(t, float(g)) for t in (10, 15, 20) for g in (1000, 2000, 3500)}
    tugs = [next(f for f in v["world"].config.fleets if f.kind == "pushback_tug")
            for v in variants]
    assert {f.vehicles for f in tugs} == {10, 15, 20}


def test_suite_deltas_below_epsilon_are_reported_as_zero():
    a = {"departure_readiness_pct": 50.0, "grid_peak_kw": 1.0 + 1e-12,
         "charging_unmet_kwh": 0.0, "background_unserved_kwh": 0.0,
         "energy_wait_total_min": 3, "resource_wait_total_min": 0}
    b = dict(a, grid_peak_kw=1.0)
    assert _delta(a, b)["grid_peak_kw"] == 0.0


def test_sensitivity_suite_api_creates_a_labelled_serial_stress_screen(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    app = create_app(data_dir=tmp_path)
    with TestClient(app) as client:
        created = client.post("/api/v1/munich/robustness-suites?screen=sensitivity", json={
            "flight_plan_snapshot_id": plan.snapshot_id, "seed": 3,
        })
        assert created.status_code == 202, created.text
        suite = created.json()
        assert suite["screen"] == "sensitivity"
        assert suite["statistical_confidence"] == "not_provided_deterministic_stress_screen_only"
        assert len(suite["scenarios"]) == 9 and len(suite["runs"]) == 9
        assert {run["policy"] for run in suite["runs"]} == {"mission_priority"}


def test_power_balance_is_labelled_bookkeeping_and_storage_balance_is_a_criterion():
    plan, world = simple_world()
    result = simulate_coupled(world, plan, "mission_priority")
    checks, _ = evaluate_assertions(summary_for(result), [], [])
    names = {c.name: c for c in checks}
    assert "Wirkleistungsbilanz (Buchfuehrungscheck)" in names
    assert "Wirkleistungsbilanz" not in names
    storage = names["Speicher-Energiebilanz"]
    assert storage.metric == "coupled_kpis.storage_energy_balance_error_kwh"
    assert storage.passed is True
    broken = result.kpis.model_copy(update={"storage_energy_balance_error_kwh": 0.5})
    summary = summary_for(result).model_copy(update={"coupled_kpis": broken})
    checks, passed = evaluate_assertions(summary, [], [])
    assert passed is False
    assert not next(c for c in checks if c.name == "Speicher-Energiebilanz").passed
