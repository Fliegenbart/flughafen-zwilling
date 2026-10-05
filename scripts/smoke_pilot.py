#!/usr/bin/env python3
"""Local-only synthetic workflow check. Creates retained QA project data, never empirical evidence."""
import argparse
import csv
import hashlib
import io
import json
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:5186')
    parser.add_argument('--run-id', required=True, help='Existing completed coupled SIL run')
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base_url)
    if parsed.hostname not in {'localhost', '127.0.0.1', '::1'} or parsed.username or parsed.password:
        parser.error('Only a local synthetic QA instance is permitted')
    base = args.base_url.rstrip('/') + '/api/v1'

    def raw(path, payload=None, expected=200):
        req = urllib.request.Request(base + path, None if payload is None else json.dumps(payload).encode(),
                                     {'Content-Type': 'application/json'})
        try:
            response = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            if response.status != expected:
                raise RuntimeError(f'{path}: {response.status}: {content[:600]!r}')
            return content

    def get(path, payload=None, expected=200):
        return json.loads(raw(path, payload, expected))

    evidence = get(f'/runs/{args.run_id}/artifacts/coupled-evidence.json')
    project = get('/pilot/projects', {'name': 'SYNTHETIC QA / measured-model pipeline',
        'decision': 'Exercise software alignment, not real airport validation.',
        'scope': 'Synthetic values derived from a model; no independent measurements.',
        'acceptance_note': 'Technical fixture only, 1% injected error.'}, 201)
    origin = datetime.fromisoformat(evidence['day_start_utc'].replace('Z', '+00:00'))
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer)
    writer.writerow(['timestamp', 'measured_kw'])
    for row in evidence['series']:
        writer.writerow([(origin + timedelta(minutes=row['minute'])).isoformat(), row['grid_import_kw'] * 1.01])
    path = f"/pilot/projects/{project['id']}"
    imported = get(path + '/imports', {'filename': 'synthetic-model-derived-NOT-measurement.csv',
        'csv_text': buffer.getvalue(), 'role': 'lab', 'sample_semantics': 'interval_end_mean',
        'measurement_boundary': 'Synthetic grid_import_kw end-of-minute means.',
        'source_note': 'MODEL-DERIVED SYNTHETIC FIXTURE, not independent empirical data.'}, 201)
    replay = get(path + '/replays', {'import_id': imported['id'], 'run_id': args.run_id, 'metric': 'grid_import_kw'}, 201)
    assessment = get(path + '/assessments', {'import_id': replay['id'], 'mae_max_kw': 1e6, 'energy_error_max_pct': 2}, 201)
    assert assessment['validity_status'] == 'PASS', assessment
    assert abs(assessment['metrics']['energy_error_pct'] + 100 / 101) < .0001
    invalid = get(path + '/imports', {'filename': 'invalid.csv',
        'csv_text': 'timestamp,measured_kw\n2026-01-01T00:00:00Z,NaN\n2026-01-01T00:01:00Z,1\n',
        'role': 'lab', 'measurement_boundary': 'Invalid fixture', 'source_note': 'Intentionally invalid'}, 422)
    rejected = get(path + '/assessments', {'import_id': invalid['id'], 'mae_max_kw': 1e6, 'energy_error_max_pct': 100}, 201)
    assert rejected['validity_status'] == 'NOT_EVALUABLE', rejected
    with zipfile.ZipFile(io.BytesIO(raw(path + '/package'))) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for name, digest in manifest['files'].items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
        assert any(name.endswith('coupled-evidence.json') for name in archive.namelist())
    print(json.dumps({'synthetic_only': True, 'project_id': project['id'], 'run_id': args.run_id,
        'replay_id': replay['id'], 'technical_assessment': assessment['validity_status'],
        'bad_data_assessment': rejected['validity_status'], 'package_hashes': 'verified',
        'empirical_validation': False}, indent=2))


if __name__ == '__main__':
    main()
