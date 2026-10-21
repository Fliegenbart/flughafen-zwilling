from types import SimpleNamespace

import pytest

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.exchange.grid_sizing import connection_checks, minimum_energy_bound, search_connection
from app.exchange.electrification_reference import reference_day
from app.munich.coupled_models import CYCLIC_ENGINE_VERSION
from app.munich.coupled_simulator import simulate_coupled


def sample_result(**changes):
    result = SimpleNamespace(
        world_hash='test-world',
        kpis=SimpleNamespace(
            mission_count=10, missions_on_time=10, fleet_energy_balance_error_kwh=0,
            storage_energy_balance_error_kwh=0, background_unserved_kwh=0,
        ),
        energy=SimpleNamespace(charging_unmet_kwh=0, battery_initial_kwh=500,
                               battery_final_kwh=500),
        terminal_vehicles=[dict(electric=True, initial_kwh=20, final_kwh=20)],
    )
    for key, value in changes.items():
        target, attribute = key.split('__')
        setattr(getattr(result, target), attribute, value)
    return result


def test_raster_search_returns_first_actually_successful_step_without_monotonicity():
    calls = []

    def evaluate(kw):
        calls.append(kw)
        return sample_result(kpis__missions_on_time=10 if kw == 500 else 9)

    answer = search_connection(evaluate, step_kw=250, max_kw=1000)
    assert answer['status'] == 'feasible'
    assert answer['required_grid_kw'] == 500
    assert calls == [0, 250, 500]
    assert answer['step_kw'] == 250
    assert answer['evaluations'][-1]['checks']['feasible']


def test_failed_raster_never_fabricates_a_requirement():
    answer = search_connection(lambda _: sample_result(kpis__missions_on_time=9),
                               step_kw=250, max_kw=500)
    assert answer['status'] == 'not_found'
    assert answer['required_grid_kw'] is None
    assert len(answer['evaluations']) == 3


def test_grid_scan_skips_only_steps_below_a_declared_necessary_energy_bound():
    calls = []
    def evaluate(kw):
        calls.append(kw)
        return sample_result()
    answer = search_connection(evaluate, lower_bound_kw=280, max_kw=1000)
    assert calls == [300]
    assert answer['energy_lower_bound_kw'] == 280
    assert answer['required_grid_kw'] == 300


def test_energy_bound_includes_mandatory_electric_tasks_not_initial_battery_credit():
    _, _, _, full, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=100), 'direct')
    _, _, _, none, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0), 'managed_storage')
    assert minimum_energy_bound(full) > minimum_energy_bound(none) > 0


@pytest.mark.parametrize('change,reason', [
    ({'kpis__missions_on_time': 9}, 'service_deadlines'),
    ({'energy__charging_unmet_kwh': 1}, 'parking_deadlines'),
    ({'kpis__background_unserved_kwh': 1}, 'background_supply'),
    ({'energy__battery_final_kwh': 499}, 'storage_recharge'),
    ({'kpis__fleet_energy_balance_error_kwh': 1}, 'energy_balance'),
])
def test_feasibility_gates_are_independent(change, reason):
    checks = connection_checks(sample_result(**change))
    assert not checks['feasible']
    assert reason in checks['reasons']


def test_individual_vehicle_recharge_cannot_be_hidden_by_fleet_average():
    result = sample_result()
    result.terminal_vehicles = [
        dict(electric=True, initial_kwh=20, final_kwh=10),
        dict(electric=True, initial_kwh=20, final_kwh=30),
    ]
    assert connection_checks(result)['reasons'] == ['vehicle_recharge']


def test_reference_times_are_real_departure_columns_not_synthetic_arrival_times():
    plan = reference_day()
    assert plan.evidence_level == 'synthetic_reference'
    assert plan.import_method == 'synthetic_generator'
    assert plan.source_url.startswith('urn:airport-twin:synthetic:')
    departures = [r for r in plan.rows if r.direction == 'departure']
    arrivals = [r for r in plan.rows if r.direction == 'arrival']
    assert len(departures) == len(arrivals) == 180
    assert departures[0].scheduled_local[11:16] == '06:00'
    assert departures[-1].scheduled_local[11:16] == '20:57'
    assert arrivals[0].scheduled_local[11:16] == '05:05'
    assert len({r.entry_id for r in plan.rows}) == 360


def test_reference_has_three_days_and_sufficient_non_electric_fleet():
    plan, config, policy, world, _ = prepare_electrification(
        ElectrificationRequest(electric_share_pct=0, grid_import_limit_kw=8000), 'direct')
    assert world.engine_version == CYCLIC_ENGINE_VERSION
    assert config.repeat_days == 3
    assert world.day_minutes == world.end_min == 4320
    assert world.start_min == 0
    assert len({m.mission_id for m in world.missions}) == len(world.missions)
    assert {m.service_day for m in world.missions} == {0, 1, 2}
    result = simulate_coupled(world, plan, policy, capture_traces=False)
    assert result.kpis.modeled_departure_count == 540
    assert result.kpis.departures_ready_on_time == 540
    assert result.kpis.missions_on_time == result.kpis.mission_count
    assert connection_checks(result)['feasible']
    assert result.vehicles == []


def test_repeated_day_carries_batteries_instead_of_resetting_them():
    plan, config, policy, world, _ = prepare_electrification(
        ElectrificationRequest(electric_share_pct=100, grid_import_limit_kw=8000), 'direct')
    result = simulate_coupled(world, plan, policy, capture_traces=False)
    assert connection_checks(result)['feasible']
    assert result.kpis.model_horizon_hours == 72
    assert result.kpis.fleet_energy_balance_error_kwh < 1e-6
    assert result.kpis.fleet_consumed_kwh > 0
    assert result.kpis.fleet_charged_kwh == pytest.approx(result.kpis.fleet_consumed_kwh)
    assert all(v['final_kwh'] >= v['initial_kwh'] - 1e-6
               for v in result.terminal_vehicles)
    assert all(f.initial_soc_pct == 85 for f in config.fleets)
    assert all(f.departure_lead_min <= 55 for f in config.fleets)


def test_mixed_reference_uses_both_drive_types_not_electric_first_dispatch():
    plan, _, policy, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=50, grid_import_limit_kw=8000), 'direct')
    result = simulate_coupled(world, plan, policy, capture_traces=False)
    gpu = [m for m in result.missions if m['kind'] == 'gpu']
    share = sum(m['electric_vehicle'] for m in gpu) / len(gpu)
    assert 0.45 < share < 0.55


def test_documented_narrowbody_energy_parameters_are_used():
    _, config, _, _, _ = prepare_electrification(ElectrificationRequest(), 'direct')
    specs = {f.kind: f for f in config.fleets}
    for kind, energy, battery in [('baggage_tractor', 7.7, 50),
                                  ('pushback_tug', 15.6, 72), ('gpu', 50.6, 160)]:
        assert specs[kind].mission_energy_kwh == energy
        assert specs[kind].battery_capacity_kwh == battery


def test_api_reports_verified_required_capacity_and_separate_current_checks(client, monkeypatch):
    # Die Live-Suche mit ihrer Pruefspur, nicht die vorab gerechnete Tabelle.
    from app.exchange import electrification
    monkeypatch.setattr(electrification, 'atlas_sizes', lambda *args: None)
    electrification._size_solutions.cache_clear()
    response = client.post('/api/v1/demo/electrification', json={
        'electric_share_pct': 100, 'grid_import_limit_kw': 1500, 'storage_kwh': 2000})
    electrification._size_solutions.cache_clear()
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['reference']['days'] == 3
    assert data['reference']['resource_baseline_feasible']
    assert data['sources'][0]['url'].startswith('https://doi.org/')
    for variant in data['variants']:
        sizing = variant['grid_sizing']
        assert sizing['status'] == 'feasible'
        assert sizing['required_grid_kw'] % 25 == 0
        assert sizing['step_kw'] == 25
        assert sizing['evaluations'][-1]['checks']['feasible']
        assert all(not e['checks']['feasible'] for e in sizing['evaluations'][:-1])
        assert isinstance(variant['checks']['feasible'], bool)
        assert variant['metrics']['departures_total'] == 540


def test_saved_run_cannot_pass_by_borrowing_starting_vehicle_energy(client):
    # Puenktlich allein reicht nicht: der Messtag muss die Fahrzeuge wieder so voll machen,
    # wie er sie vorgefunden hat (eingeschwungen), sonst lebt der Betrieb vom Startstand.
    from test_demo_materialization import _completed
    inputs = {'electric_share_pct': 50, 'grid_import_limit_kw': 650,
              'storage_kwh': 2000, 'solution': 'managed'}
    created = client.post('/api/v1/demo/electrification/runs', json=inputs)
    assert created.status_code == 202, created.text
    record = _completed(client, created.json()['run_id'])
    assert record['summary']['coupled_kpis']['missions_on_time'] == record['summary']['coupled_kpis']['mission_count']
    assert record['status']['pass_fail'] is False
    assert record['summary']['energy_kpis']['vehicle_recharge_deficit_kwh'] > 0
    assert 'vehicle_recharge_deficit_kwh' not in record['summary']['coupled_kpis']


from test_variants import client  # noqa: E402,F401
