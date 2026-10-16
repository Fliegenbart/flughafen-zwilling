#!/usr/bin/env python3
"""Synthetic technical acceptance only; never empirical validation or hardware control."""
import argparse
import csv
import io
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8027')
    args = parser.parse_args()
    base = args.base_url.rstrip('/') + '/api/v1'

    def call(path, body=None, method=None, expected=200):
        req = urllib.request.Request(base + path, None if body is None else json.dumps(body).encode(),
                                     {'Content-Type': 'application/json'}, method=method)
        try:
            res = urllib.request.urlopen(req, timeout=90)
        except urllib.error.HTTPError as exc:
            res = exc
        assert res.code == expected, (path, res.code, res.read().decode()[:500])
        return json.load(res)

    run = call('/demo/simulation/runs', {'grid_import_limit_kw': 2200}, expected=202)
    rid = run['run_id']
    deadline = time.monotonic() + 120
    while run['state'] not in ('completed', 'failed') and time.monotonic() < deadline:
        time.sleep(.5)
        run = call('/runs/' + rid)
    assert run['state'] == 'completed', run
    evidence = call(f'/runs/{rid}/artifacts/coupled-evidence.json')
    project = call('/pilot/projects', {
        'name': 'QA Messdaten-Workflow (synthetisch)',
        'decision': 'Technischer Replay-Test, keine unabhaengigen Messungen',
        'scope': 'Synthetisch abgeleiteter Netzbezug in kW',
        'acceptance_note': 'measurement-workflow-v1:grid_import_kw',
    }, expected=201)
    pid = project['id']
    path = '/pilot/projects/' + pid
    call(f'/projects/{pid}/links', {'kind': 'coupled_run', 'ref_id': rid}, expected=201)
    call(path + '/tolerances', {'mae_max_kw': 10, 'energy_error_max_pct': 5,
                              'min_rows': 60, 'min_coverage_seconds': 3600, 'lock': True}, method='PUT')
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(['timestamp', 'measured_kw'])
    origin = datetime.fromisoformat(evidence['day_start_utc'].replace('Z', '+00:00'))
    for row in evidence['series']:
        writer.writerow([(origin + timedelta(minutes=row['minute'])).isoformat(),
                         float(row['grid_import_kw']) * 1.01])
    original = call(path + '/imports', {'filename': 'synthetische-qa.csv', 'csv_text': buf.getvalue(),
        'role': 'lab', 'measurement_boundary': 'Synthetische technische QA, kein Flughafenmesspunkt',
        'source_note': 'Explizit aus Modellwerten erzeugt; keine empirische Evidenz',
        'sample_semantics': 'interval_end_mean'}, expected=201)
    replay = call(path + '/replays', {'import_id': original['id'], 'run_id': rid,
                                    'metric': 'grid_import_kw'}, expected=201)
    assessment = call(path + '/assessments', {'import_id': replay['id']}, expected=201)
    assert replay['source_import_id'] == original['id']
    assert replay['model_provenance']['model_run_id'] == rid
    assert assessment['evaluation_kind'] == 'lab_diagnostic'
    assert assessment['validity_status'] == 'NOT_EVALUABLE'
    assert assessment['metrics']['time_weighted_mae_kw'] > 0
    assert abs(assessment['metrics']['energy_error_pct'] + 100/101) < .0001
    bad = call(path + '/imports', {'filename': 'ungueltige-qa.csv',
        'csv_text': 'timestamp,measured_kw\n2026-01-01T00:00:00Z,nan\n',
        'role': 'lab', 'measurement_boundary': 'QA', 'source_note': 'Absichtlich ungueltig',
        'sample_semantics': 'interval_end_mean'}, expected=422)
    assert bad['quality']['state'] == 'invalid'
    print(json.dumps({'technical_smoke': 'PASS', 'run_id': rid, 'project_id': pid,
        'assessment': assessment['validity_status'], 'evaluation_kind': assessment['evaluation_kind'],
        'mae_kw': assessment['metrics']['time_weighted_mae_kw'], 'bad_data': 'invalid',
        'empirical_validation': False}, indent=2))


if __name__ == '__main__':
    main()
