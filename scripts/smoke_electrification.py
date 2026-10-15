#!/usr/bin/env python3
"""Verify the fixed-fleet comparison over HTTP using only synthetic demo inputs."""
import argparse
import json
import time
import urllib.request

from pilot_auth import configure_auth


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
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    contracts = []
    for share in (0, 50, 100):
        inputs = {'electric_share_pct': share, 'grid_import_limit_kw': 3500, 'storage_kwh': 2000}
        result = call('/demo/electrification', inputs)
        contract = result['comparison_contract']
        contracts.append(contract)
        assert contract['total_vehicles'] == 100
        assert contract['electric_vehicles'] == share
        assert contract['non_electric_vehicles'] == 100 - share
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
            if share == 0:
                assert variant['metrics']['apron_charged_kwh'] == 0
        print(json.dumps({'share': share, 'comparison_id': result['comparison_id'],
                          'metrics': [v['metrics'] for v in variants]}))
    assert len({c['missions_hash'] for c in contracts}) == 1
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
        print(json.dumps({'validation_run_id': status['run_id'], 'state': status['state']}))
    print('PASS: fixed fleet, unchanged demand, three solutions and energy balances')


if __name__ == '__main__':
    main()
