#!/usr/bin/env python3
"""Read-only acceptance for the real, stateless public airport simulation."""
import argparse
import json
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5179')
    args = parser.parse_args()
    url = args.base_url.rstrip('/') + '/api/v1/demo/simulation'

    def run(changes):
        req = urllib.request.Request(url, data=json.dumps(changes).encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=90) as response:
            result = json.load(response)
        assert len(result['input_hash']) == 64
        assert result['calculation_id']
        assert result['engine_version']
        assert result['metadata']['stateless'] is True
        assert result['kpis']['departures_total'] > 0
        assert 0 <= result['kpis']['delayed_departures'] <= result['kpis']['departures_total']
        assert 0 <= result['kpis']['on_time_pct'] <= 100
        assert sum(d['count'] for d in result['departures']) == result['kpis']['departures_total']
        assert len(result['grid_import_kw']) > 1000
        return result

    baseline = run({})
    repeat = run({})
    assert baseline['input_hash'] == repeat['input_hash']
    assert baseline['kpis'] == repeat['kpis']
    assert baseline['grid_import_kw'] == repeat['grid_import_kw']
    for changes in [
        {'grid_import_limit_kw': 1500},
        {'storage_kwh': 2000, 'storage_kw': 1000},
        {'pv_factor': 0},
        {'extra_vehicles': {'pushback_tug': 10}},
    ]:
        result = run(changes)
        assert result['input_hash'] != baseline['input_hash']
        assert (result['grid_import_kw'] != baseline['grid_import_kw']
                or result['coupled_kpis'] != baseline['coupled_kpis'])
        print(json.dumps({'changes': changes, 'calculation_id': result['calculation_id'],
                          'compute_ms': result['compute_ms'], 'kpis': result['kpis']}))
    print('PASS: repeatable baseline and four independently recomputed variants; no project writes')


if __name__ == '__main__':
    main()
