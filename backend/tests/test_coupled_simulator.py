import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.munich.coupled_models import CoupledConfig, PowerConfig, StressEvent
from app.munich.coupled_world import build_world
from app.munich.coupled_simulator import simulate_coupled
from test_coupled_world import bus, schedule


def simple_world(*, grid=60, parking=0, chargers=1, vehicles=1, stress=None, seed=42):
    plan = schedule("S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air")
    config = CoupledConfig(warmup_min=0, drain_min=0, fleets=[bus(
        coverage_pct=100, vehicles=vehicles, chargers=chargers, battery_capacity_kwh=10,
        initial_soc_pct=0, reserve_soc_pct=0, charge_target_soc_pct=100,
        charger_kw=60, mission_energy_kwh=4, service_duration_min=2, return_min=0,
        departure_lead_min=30, departure_buffer_min=24,
    )], power=PowerConfig(grid_import_limit_kw=grid, background_load_kw=0,
                         chp_output_kw=0, pv_capacity_kwp=0, parking_sessions=parking,
                         parking_charger_kw=60, transformer_efficiency=1,
                         charging_efficiency=1), stress_events=stress or [])
    return plan, build_world(plan, config, seed)


def test_real_charging_changes_dispatch_and_modelled_departure_readiness():
    plan, world = simple_world()
    supplied = simulate_coupled(world, plan, "uncontrolled")
    starved_plan, starved = simple_world(grid=0)
    missing = simulate_coupled(starved, starved_plan, "uncontrolled")
    mission = supplied.missions[0]
    assert mission["actual_start_min"] == 4
    assert mission["actual_complete_min"] == 6
    assert supplied.kpis.departure_readiness_pct == 100
    assert supplied.kpis.missions_completed == 1
    assert supplied.kpis.resource_wait_total_min == 0
    assert missing.kpis.missions_uncompleted == 1
    assert missing.kpis.departure_readiness_pct == 0
    assert missing.kpis.energy_wait_total_min > supplied.kpis.energy_wait_total_min
    assert missing.departures[0]["delay_is_lower_bound"] is True
    assert missing.missions[0]["actual_complete_min"] is None


def test_demand_priority_uses_same_world_but_exposes_parking_tradeoff():
    # Fixed fixture with a parking arrival at minute zero, concurrent with the fleet.
    plan, world = simple_world(parking=1, seed=2)
    assert world.parking_jobs[0].release_min == 0
    baseline = simulate_coupled(world, plan, "uncontrolled")
    priority = simulate_coupled(world, plan, "mission_priority")
    assert baseline.world_hash == priority.world_hash == world.world_hash
    assert baseline.missions[0]["actual_complete_min"] > priority.missions[0]["actual_complete_min"]
    assert priority.kpis.departure_readiness_pct > baseline.kpis.departure_readiness_pct
    assert baseline.energy.parking_session_count == priority.energy.parking_session_count == 1
    assert simulate_coupled(world, plan, "mission_priority") == priority


def test_one_vehicle_two_missions_requires_recharge_and_exposes_both_wait_causes():
    _, reference = simple_world()
    plan = schedule(
        "S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S XY 103 00:32 09:12 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    )
    world = build_world(plan, reference.config, 42)
    result = simulate_coupled(world, plan, "uncontrolled")
    first, second = result.missions
    assert (first["actual_start_min"], first["actual_complete_min"]) == (4, 6)
    assert (second["actual_start_min"], second["actual_complete_min"]) == (10, 12)
    assert first["vehicle_id"] == second["vehicle_id"]
    assert second["resource_wait_min"] == 2
    assert second["energy_wait_min"] == 6
    assert second["wait_cause"] == "energy_and_resource"
    assert result.kpis.fleet_consumed_kwh == pytest.approx(8)
    assert result.kpis.completed_mission_delay_avg_min == pytest.approx(2)
    assert result.kpis.departure_readiness_pct == 50


@pytest.mark.parametrize("policy", ["uncontrolled", "mission_priority"])
def test_no_fleet_or_charger_never_fabricates_a_completed_service(policy):
    for vehicles, chargers in [(0, 0), (1, 0)]:
        plan, world = simple_world(vehicles=vehicles, chargers=chargers)
        result = simulate_coupled(world, plan, policy)
        assert result.kpis.missions_uncompleted == 1
        assert result.kpis.departure_readiness_pct == 0
        assert result.kpis.fleet_charged_kwh == 0
        assert result.kpis.fleet_consumed_kwh == 0
        if vehicles == 0:
            assert result.kpis.resource_wait_total_min > 0
        else:
            assert result.kpis.energy_wait_total_min > 0


def test_timed_grid_or_charger_outage_propagates_to_late_service():
    for stress in [StressEvent(start_min=0, end_min=10, grid_import_limit_kw=0),
                   StressEvent(start_min=0, end_min=10, fleet_kind="bus", offline_chargers=1)]:
        plan, world = simple_world(stress=[stress])
        result = simulate_coupled(world, plan, "mission_priority")
        assert result.missions[0]["actual_complete_min"] >= 16
        assert result.kpis.departure_readiness_pct == 0


@pytest.mark.parametrize("policy", ["uncontrolled", "mission_priority"])
@pytest.mark.parametrize("battery", [0, 100])
def test_conservation_feeders_and_exclusive_vehicle_occupancy(policy, battery):
    plan = schedule(*[
        f"S XY {i+100} 0{6+i}:10 12:00 1234567 BBB 03.10.26 27.03.27 1 Test Air"
        for i in range(3)
    ])
    config = CoupledConfig(fleets=[bus(vehicles=2, chargers=1, coverage_pct=100,
                                      battery_capacity_kwh=20, initial_soc_pct=50,
                                      charger_kw=60, mission_energy_kwh=4)],
                           power=PowerConfig(background_load_kw=10, chp_output_kw=5,
                                             grid_import_limit_kw=25, pv_capacity_kwp=40,
                                             battery_capacity_kwh=battery, battery_power_kw=20,
                                             apron_transformer_kva=12, power_factor=0.8,
                                             parking_sessions=1, parking_charger_kw=11))
    world = build_world(plan, config, 5)
    result = simulate_coupled(world, plan, policy)
    assert result.energy.balance_error_max_kw < 1e-8
    assert result.kpis.fleet_energy_balance_error_kwh < 1e-8
    assert result.kpis.fleet_reserve_violations == 0
    assert result.kpis.transformer_loss_kwh > 0
    assert result.kpis.fleet_initial_kwh + result.kpis.fleet_charged_kwh - result.kpis.fleet_consumed_kwh == pytest.approx(result.kpis.fleet_final_kwh)
    p = config.power
    assert all(row["grid_import_kw"] <= p.grid_import_limit_kw + 1e-8 for row in result.series)
    assert all(row["apron_upstream_kw"] <= p.apron_transformer_kva * p.power_factor + 1e-8 for row in result.series)
    for trace in result.vehicles:
        assert 2 - 1e-8 <= trace["energy_kwh"] <= 20 + 1e-8
        if trace["state"] in {"working", "returning"}:
            assert trace["charging_kw"] == 0
    assignments = [m for m in result.missions if m["actual_start_min"] is not None]
    for a in assignments:
        for b in assignments:
            if a["mission_id"] == b["mission_id"] or a["vehicle_id"] != b["vehicle_id"]:
                continue
            assert a["return_complete_min"] <= b["actual_start_min"] or b["return_complete_min"] <= a["actual_start_min"]
    assert result.energy.battery_initial_kwh + result.energy.battery_charge_kwh * p.battery_efficiency - result.energy.battery_discharge_kwh / p.battery_efficiency == pytest.approx(result.energy.battery_final_kwh)


def test_unsupported_policy_and_mutated_world_are_rejected():
    plan, world = simple_world()
    with pytest.raises(ValueError, match="Regel"):
        simulate_coupled(world, plan, "oracle")
    world.missions[0].energy_kwh = 9
    with pytest.raises(ValueError, match="Hash"):
        simulate_coupled(world, plan, "uncontrolled")
