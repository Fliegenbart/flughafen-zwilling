"""A charging plan may fail; it may not change the work or borrow starting energy."""
import pytest

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.exchange.grid_sizing import connection_checks
from app.munich.coupled_simulator import simulate_coupled


def reference(share=50, grid=1500, solution='managed', storage=0):
    return prepare_electrification(ElectrificationRequest(
        electric_share_pct=share, grid_import_limit_kw=grid, storage_kwh=storage), solution)


def test_new_policy_is_explicitly_versioned_and_has_25kw_comparison():
    from app.exchange.grid_sizing import GRID_STEP_KW
    _, _, policy, world, _ = reference()
    assert world.engine_version == 'airport_electrification_v4'
    assert policy == 'lookahead'
    assert GRID_STEP_KW == 25


def test_fixed_duties_do_not_depend_on_grid_policy_or_drive_share():
    from app.munich.charging_plan import duty_roster
    rosters = []
    for share, grid, solution in [(0, 0, 'direct'), (50, 500, 'managed'),
                                   (100, 2000, 'managed_storage')]:
        _, _, _, world, _ = reference(share, grid, solution)
        rosters.append(duty_roster(world))
    assert rosters[0] == rosters[1] == rosters[2]
    assert len(rosters[0]) == 6729
    assert all(d.start_min + d.duration_min <= d.deadline_min for d in rosters[0])


def test_plan_smooths_charge_at_ample_grid_without_changing_mission_assignments():
    results = []
    for solution in ('direct', 'managed'):
        plan, _, policy, world, _ = reference(grid=2000, solution=solution)
        results.append(simulate_coupled(world, plan, policy, capture_traces=False))
    direct, planned = results
    assert connection_checks(direct)['feasible']
    assert connection_checks(planned)['feasible']
    assert [m['vehicle_id'] for m in direct.missions] == [m['vehicle_id'] for m in planned.missions]
    assert direct.kpis.fleet_consumed_kwh == pytest.approx(planned.kpis.fleet_consumed_kwh)
    assert max(r['grid_import_kw'] for r in planned.series) < max(
        r['grid_import_kw'] for r in direct.series)
    assert planned.planning_meta['method'] == 'known_duty_soc_feedback_v2'
    assert planned.planning_meta['perfect_foresight'] is True
    assert planned.planning_meta['end_condition'] == 'measured_day_steady_state'


def test_low_grid_does_not_substitute_diesel_for_assigned_electric_missions():
    from app.munich.charging_plan import duty_roster
    plan, _, policy, world, _ = reference(grid=300)
    result = simulate_coupled(world, plan, policy, capture_traces=False)
    intended = {d.mission_id: d.vehicle_id for d in duty_roster(world)}
    for mission in result.missions:
        assert mission['planned_vehicle_id'] == intended[mission['mission_id']]
        assert mission['vehicle_id'] in (None, intended[mission['mission_id']])
    assert not connection_checks(result)['feasible']
    assert result.kpis.departures_ready_on_time < result.kpis.modeled_departure_count


def test_zero_electric_share_has_no_manufactured_fleet_benefit():
    results = []
    for solution in ('direct', 'managed'):
        plan, _, policy, world, _ = reference(share=0, grid=1000, solution=solution)
        result = simulate_coupled(world, plan, policy, capture_traces=False)
        assert result.kpis.fleet_charged_kwh == 0
        assert result.kpis.fleet_consumed_kwh == 0
        assert connection_checks(result)['feasible']
        results.append(result)
    assert results[0].series == results[1].series


def test_old_world_rejects_new_policy_instead_of_silently_changing_history():
    from app.munich.coupled_world import build_world
    plan, config, _, _, _ = reference()
    old = build_world(plan, config, 42, 'airport_electrification_v2')
    with pytest.raises(ValueError, match='v3|Engine'):
        simulate_coupled(old, plan, 'lookahead')
