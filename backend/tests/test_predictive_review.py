"""Independent regression checks for v3 predictive charging boundaries."""
from itertools import combinations

import pytest

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.exchange.grid_sizing import connection_checks, minimum_energy_bound
from app.munich.charging_plan import duty_roster
from app.munich.coupled_models import CoupledConfig, PREDICTIVE_ENGINE_VERSION, PowerConfig
from app.munich.coupled_simulator import simulate_coupled
from app.munich.coupled_world import build_world
from test_coupled_world import bus, schedule


def small_v3_world(*, grid=60, chargers=1, electric_vehicles=1, initial_soc=0,
                   rows=None, return_min=0, drain_min=10):
    plan = schedule(*(rows or [
        "S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    ]))
    config = CoupledConfig(
        warmup_min=0,
        drain_min=drain_min,
        fleets=[bus(
            coverage_pct=100,
            vehicles=1,
            electric_vehicles=electric_vehicles,
            chargers=chargers,
            battery_capacity_kwh=10,
            initial_soc_pct=initial_soc,
            reserve_soc_pct=0,
            charge_target_soc_pct=100,
            charger_kw=60,
            mission_energy_kwh=4,
            service_duration_min=2,
            return_min=return_min,
            departure_lead_min=30,
            departure_buffer_min=24,
        )],
        power=PowerConfig(
            grid_import_limit_kw=grid,
            background_load_kw=0,
            chp_output_kw=0,
            pv_capacity_kwp=0,
            parking_sessions=0,
            transformer_efficiency=1,
            charging_efficiency=1,
        ),
    )
    return plan, build_world(plan, config, 42, PREDICTIVE_ENGINE_VERSION)


@pytest.mark.parametrize("grid, chargers", [(0, 1), (60, 0)])
def test_lookahead_fails_closed_without_grid_or_plug(grid, chargers):
    plan, world = small_v3_world(grid=grid, chargers=chargers)
    result = simulate_coupled(world, plan, "lookahead", capture_traces=False)

    assert result.kpis.fleet_charged_kwh == 0
    assert result.kpis.fleet_consumed_kwh == 0
    assert result.missions[0]["actual_start_min"] is None
    assert "service_deadlines" in connection_checks(result)["reasons"]


def test_lookahead_does_not_borrow_initial_energy_for_terminal_soc():
    plan, world = small_v3_world(grid=0, initial_soc=50)
    result = simulate_coupled(world, plan, "lookahead", capture_traces=False)

    assert result.missions[0]["deadline_met"]
    assert result.kpis.fleet_initial_kwh == pytest.approx(5)
    assert result.kpis.fleet_consumed_kwh == pytest.approx(4)
    assert result.kpis.fleet_final_kwh == pytest.approx(1)
    assert result.energy.vehicle_recharge_deficit_kwh == pytest.approx(4)
    assert "vehicle_recharge" in connection_checks(result)["reasons"]


def test_lookahead_is_deterministic_and_preserves_duty_and_power_limits():
    rows = [
        "S XY 102 00:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S XY 103 00:32 09:12 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    ]
    plan, world = small_v3_world(initial_soc=50, rows=rows, return_min=1)
    first = simulate_coupled(world, plan, "lookahead")
    second = simulate_coupled(world, plan, "lookahead")

    assert first == second
    assert first.kpis.fleet_energy_balance_error_kwh < 1e-8
    assert first.kpis.fleet_initial_kwh + first.kpis.fleet_charged_kwh - first.kpis.fleet_consumed_kwh == pytest.approx(first.kpis.fleet_final_kwh)
    assert all(row["fleet_charging_count"] <= 1 for row in first.series)
    assert all(trace["charging_kw"] == 0 for trace in first.vehicles
               if trace["state"] in {"working", "returning"})
    for left, right in combinations(first.missions, 2):
        if left["vehicle_id"] == right["vehicle_id"]:
            assert left["return_complete_min"] <= right["actual_start_min"] or right["return_complete_min"] <= left["actual_start_min"]


def test_mixed_fleet_energy_lower_bound_uses_fixed_electric_duties_of_the_measured_day():
    from app.munich.coupled_world import steady_cycle
    _, _, _, zero_electric, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=1000), "managed")
    _, _, _, mixed, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=50, grid_import_limit_kw=1000), "managed")
    electric_ids = {
        f"{fleet.kind}-{index:03d}"
        for fleet in mixed.config.fleets
        for index in range(1, (fleet.electric_vehicles or 0) + 1)
    }
    first, last = steady_cycle(mixed)
    fixed_ev_energy = sum(
        duty.energy_kwh for duty in duty_roster(mixed) if duty.vehicle_id in electric_ids
        and first <= duty.start_min and duty.start_min + duty.duration_min + duty.return_min <= last
    )
    horizon_hours = (last - first) / 60
    expected_increment = fixed_ev_energy / horizon_hours / (
        mixed.config.power.charging_efficiency * mixed.config.power.transformer_efficiency
    )

    assert fixed_ev_energy > 0
    assert minimum_energy_bound(mixed) - minimum_energy_bound(zero_electric) == pytest.approx(
        expected_increment
    )
