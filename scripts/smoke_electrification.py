#!/usr/bin/env python3
"""Verify the fixed-fleet comparison over HTTP using only synthetic demo inputs."""
import argparse
import json
import time
import urllib.request

from pilot_auth import configure_auth


# Beispielflughafen: zehn Fahrzeugklassen (backend electrification_reference.FLEET).
FLEET_TOTAL = 226


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5181')
    parser.add_argument('--auth-file')
    parser.add_argument('--materialize', action='store_true')
    args = parser.parse_args()
    configure_auth(args.base_url, args.auth_file)
    base = args.base_url.rstrip('/') + '/api/v1'

    def call(path, payload=None):
        request = urllib.request.Request(base + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)

    # Auf dem Raster antwortet der Vergleich aus der vorab gerechneten Tabelle (ohne Pruefspur);
    # dann muessen die Werte genau der veroeffentlichten Tabelle entsprechen.
    atlas = call('/demo/electrification/atlas')
    contracts = []
    for share in (0, 50, 100):
        inputs = {'electric_share_pct': share, 'grid_import_limit_kw': 2000, 'storage_kwh': 2000}
        result = call('/demo/electrification', inputs)
        contract = result['comparison_contract']
        contracts.append(contract)
        total = contract['total_vehicles']
        assert total == FLEET_TOTAL
        assert contract['electric_vehicles'] == (total * share + 50) // 100
        assert contract['non_electric_vehicles'] == total - contract['electric_vehicles']
        assert result['reference']['days'] == 3
        assert result['reference']['resource_baseline_feasible']
        assert result['engine_version'] == 'airport_electrification_v4'
        assert contract['fixed_vehicle_assignments'] is True
        assert len(contract['duty_roster_hash']) == 64
        variants = result['variants']
        assert [v['solution'] for v in variants] == ['direct', 'managed', 'managed_storage']
        assert variants[0]['world_hash'] == variants[1]['world_hash']
        assert [v['power']['battery_capacity_kwh'] for v in variants] == [0, 0, 2000]
        assert all(v['metadata']['config']['fleets'] == variants[0]['metadata']['config']['fleets']
                   for v in variants)
        for variant in variants:
            kpis = variant['coupled_kpis']
            assert kpis['fleet_energy_balance_error_kwh'] < 1e-6
            assert kpis['storage_energy_balance_error_kwh'] < 1e-6
            assert kpis['mission_count'] == contract['mission_count']
            assert variant['checks']['feasible'], variant['checks']
            assert variant['metrics']['departures_total'] == 540
            sizing = variant['grid_sizing']
            assert sizing['status'] == 'feasible' and sizing['required_grid_kw'] is not None
            assert sizing['required_grid_kw'] % 25 == 0
            assert sizing['step_kw'] == 25
            assert variant['metadata']['planning']['duty_roster_hash'] == contract['duty_roster_hash']
            if sizing.get('source') == 'atlas':
                index = ['direct', 'managed', 'managed_storage'].index(variant['solution'])
                assert atlas['entries'][f'{share}|2000|500|40'][index] == sizing['required_grid_kw']
            else:
                assert sizing['evaluations'][-1]['checks']['feasible']
                assert all(not e['checks']['feasible'] for e in sizing['evaluations'][:-1])
            if share == 0:
                assert variant['metrics']['apron_charged_kwh'] == 0
        free = result['uncontrolled']['grid_sizing']
        assert free['required_grid_kw'] % 25 == 0
        assert free['required_grid_kw'] >= variants[0]['grid_sizing']['required_grid_kw']
        assert atlas['peaks'][f'{share}|500|40'] == free['required_grid_kw']
        print(json.dumps({'share': share, 'comparison_id': result['comparison_id'],
                          'requirements_kw': [v['grid_sizing']['required_grid_kw'] for v in variants],
                          'metrics': [v['metrics'] for v in variants]}))
    assert len({c['missions_hash'] for c in contracts}) == 1
    assert len({c['duty_roster_hash'] for c in contracts}) == 1
    assert len({c['parking_jobs_hash'] for c in contracts}) == 1
    assert len({c['source_plan_sha256'] for c in contracts}) == 1
    if args.materialize:
        status = call('/demo/electrification/runs', {**inputs, 'solution': 'managed_storage'})
        deadline = time.monotonic() + 60
        while status['state'] in ('queued', 'running') and time.monotonic() < deadline:
            time.sleep(0.25)
            status = call('/runs/' + status['run_id'])
        assert status['state'] == 'completed', status
        record = call('/runs/' + status['run_id'] + '/record')
        assert record['request']['adapters'] == []
        assert record['summary']['coupled_kpis'] == variants[2]['coupled_kpis']
        assert record['summary']['energy_world_hash'] == variants[2]['world_hash']
        evidence = call('/runs/' + status['run_id'] + '/artifacts/coupled-evidence.json')
        assert len(evidence['terminal_vehicles']) == FLEET_TOTAL
        assert all(v['final_kwh'] + 1e-5 >= v['initial_kwh'] for v in evidence['terminal_vehicles'])
        print(json.dumps({'validation_run_id': status['run_id'], 'state': status['state']}))
    print('PASS: fixed fleet, 72h, verified capacity steps, restored SOC and persisted evidence')


if __name__ == '__main__':
    main()
