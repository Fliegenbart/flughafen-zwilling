# Airport Energy Check

## Backend

Gemeinsames Projekt zwischen Flughafen und E.ON Testing-Lab (FlexLab). Das Projekt ist
das vorhandene Pilot-Projekt (`/api/v1/pilot/projects`); Austausch, Rollen, Bibliothek
und Lagebild liegen in `backend/app/exchange/`, Vertrag in `docs/EXCHANGE_API.md`.

- Verknuepfungen: Flugplan-Snapshots, gekoppelte Runs, Robustheits-Suiten, FlexLab-Runs;
  `GET /api/v1/projects/{id}/overview` mit Kurzstatus und Evidenzstufe je Element.
- Austausch-Items: `scenario_package` (eingefroren, SHA256, Lastprofil-CSV in kW/UTC),
  `test_request` (proposed → accepted → scheduled → done | rejected, nur Lab plant),
  `lab_result` (Verdict/Hash serverseitig gelesen), Kommentare, Audit in der
  Pilot-Hashkette, ZIP mit Manifest.
- Rollen `airport | lab | admin` (Konto bzw. Demo-Header `X-Exchange-Role`, Demo ohne
  Angabe = admin); Altkonten `operator` = admin, `viewer` = nur lesen.
- `empirical_pass` nur ueber Pilot-Holdout-PASS mit gesperrten Toleranzen; FlexLab-`pass`
  bleibt `empirical_open`. Kein neuer PASS-Weg.
- Strikt read-only gegenueber Hardware: Versuchsentwurf, Freigabe separat.
