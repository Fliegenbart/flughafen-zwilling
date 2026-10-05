# Airport Energy Check – Austausch-API (Flughafen ↔ E.ON Testing-Lab)

Stand: 05.10.2026 (implementiert, Tests `backend/tests/test_exchange.py`). Backend-Modul `backend/app/exchange/`. Additiv: alle bestehenden
Endpunkte (`/api/v1/pilot/*`, `/api/v1/lab/*`, `/api/v1/munich/*`) bleiben unveraendert.

**Grenzen (gelten fuer jeden Endpunkt):** strikt read-only gegenueber Hardware, keine
Hardwarewrites, keine Versuchsfreigabe. Jede Testanfrage ist ein *Versuchsentwurf,
Freigabe separat*. Ein `empirical_pass` entsteht ausschliesslich aus einer
Pilot-Bewertung mit `validity_status = PASS` und `evaluation_kind = holdout_validation`
(gesperrte Projekt-Toleranzen). Austausch-Items erzeugen keinen neuen PASS-Weg.

Alle Zeitstempel sind UTC (ISO 8601 mit `Z`). Leistungen in **kW**, Energien in **kWh**.

## Projekt als Klammer

Das Projekt ist das vorhandene Pilot-Projekt (`POST /api/v1/pilot/projects`,
UUID). Die neuen Endpunkte haengen unter `/api/v1/projects/{project_id}`.

## Rollen

| Rolle | darf |
|---|---|
| `airport` | Verknuepfungen, Szenario-Pakete (Richtung `airport_to_lab`), Testanfragen stellen, kommentieren |
| `lab` | Verknuepfungen, Szenario-Pakete (Richtung `lab_to_airport`), Testanfragen annehmen/planen/abschliessen/ablehnen, Lab-Ergebnisse melden, kommentieren |
| `admin` | alles |
| ohne Rolle (`viewer`) | nur lesen (nur bei aktivem Login) |

- Login aktiv (`TWIN_REQUIRE_AUTH=1`): Rolle aus dem Nutzerkonto
  (`create_user(..., role="airport"|"lab"|"admin")`; bestehende Konten: `operator` → `admin`,
  `viewer` → nur lesen). Der Header `X-Exchange-Role` wird dann **ignoriert**.
- Demo-Modus (Login aus): ohne Angabe `admin`. Zum Vorfuehren beider Seiten darf das
  Frontend `X-Exchange-Role: airport|lab|admin` senden.
- Pruefung serverseitig; Verstoss → `403 {"detail": "role_forbidden: ..."}`.
- Bei aktivem Login duerfen `airport`/`lab` ohne Basisrolle `operator` nur unter
  `/api/v1/projects/*` und `/api/v1/library/*` schreiben (Middleware, CSRF wie bisher).
  `/api/v1/auth/session` bleibt unveraendert; die Fachrolle liefert `whoami`.

`GET /api/v1/exchange/whoami` →
```json
{"role": "admin", "user": null, "auth_enabled": false, "source": "demo_default",
 "can_write": true}
```

## Verknuepfungen

`POST /api/v1/projects/{id}/links` (airport|lab|admin)
```json
{"kind": "coupled_run", "ref_id": "9f1c…32hex", "note": "Basislauf Sommer"}
```
`kind`: `flight_plan_snapshot` | `coupled_run` | `robustness_suite` | `flexlab_run`
(FlexLab-Datensatz bzw. -Analyse = FlexLab-Run-ID). Referenz muss existieren (sonst 404),
Duplikate → 409. `GET /api/v1/projects/{id}/links` listet sie.

## Uebersicht

`GET /api/v1/projects/{id}/overview`
```json
{
  "project": {"id": "…", "name": "…", "decision": "…", "scope": "…"},
  "acceptance": {"locked": true, "sha256": "…", "tolerances": {"mae_max_kw": 50.0}},
  "elements": [
    {"kind": "flight_plan_snapshot", "ref_id": "…64hex", "title": "Flugplan 2026-10-04",
     "status": "available", "evidence_level": "assumption", "detail": "published_schedule_not_actual"},
    {"kind": "coupled_run", "ref_id": "…", "status": "completed", "evidence_level": "model_checked"},
    {"kind": "robustness_suite", "ref_id": "…", "status": "completed", "evidence_level": "model_checked"},
    {"kind": "flexlab_run", "ref_id": "…", "status": "completed", "verdict": "pass",
     "evidence_level": "empirical_open"},
    {"kind": "pilot_assessment", "ref_id": "…", "status": "PASS", "evidence_level": "empirical_pass"},
    {"kind": "exchange_item", "ref_id": "…", "item_type": "test_request", "status": "scheduled",
     "evidence_level": "assumption"}
  ],
  "evidence_summary": {"assumption": 2, "synthetic": 0, "model_checked": 2,
                       "empirical_open": 1, "empirical_pass": 1},
  "notice": "Versuchsentwurf, Freigabe separat. Keine Hardwarewrites."
}
```
Evidenzstufen: `assumption` < `synthetic` < `model_checked` < `empirical_open` < `empirical_pass`.
- Flugplan-Snapshot: `assumption` (veroeffentlichter Plan, keine Ist-Daten).
- Gekoppelter Run: `model_checked`, wenn abgeschlossen; sonst `assumption`.
- Robustheits-Suite: `model_checked`, wenn alle Laeufe abgeschlossen; sonst `assumption`.
- FlexLab-Run: CSV-Import = `empirical_open` (auch bei Verdict `pass`), Simulation = `synthetic`.
- Pilot-Bewertung: `empirical_pass` nur PASS + Holdout, sonst `empirical_open`.
- Fehlt eine Referenz: `status: "missing"`, `evidence_level: "assumption"`.

## Austausch-Items

`GET /api/v1/projects/{id}/exchange[?type=…]` · `GET …/exchange/{item_id}` ·
`POST …/exchange` (Body je Typ, `type` Pflicht). Inhalt wird beim Anlegen eingefroren;
`content_sha256` = SHA256 ueber kanonisches JSON (`sort_keys`, `(",",":")`, ASCII) von
`content`. Jede Antwort enthaelt `hash_valid` (Neuberechnung).

Gemeinsame Felder:
```json
{"id": "uuid", "project_id": "uuid", "type": "test_request", "direction": "airport_to_lab",
 "status": "proposed", "content": {…}, "content_sha256": "…", "hash_valid": true,
 "created_by": {"user": null, "role": "airport"}, "created_at": "2026-10-05T08:00:00.000000Z",
 "updated_at": "…", "status_reason": null, "links": {"test_request_id": null},
 "evidence_level": "assumption", "notice": "Versuchsentwurf, Freigabe separat."}
```

### scenario_package
```json
{"type": "scenario_package", "title": "Spitzenwelle Sommer, Netzimport -20 %",
 "direction": "airport_to_lab",
 "flight_plan_snapshot_id": "…64hex", "scenario_id": null,
 "variant": "grid_import_minus_20_pct", "parameters": {"power.grid_import_limit_kw": 2800},
 "run_ids": ["…32hex"], "note": "optional"}
```
Mindestens `flight_plan_snapshot_id` oder `scenario_id`. `direction` optional
(aus der Rolle: airport → `airport_to_lab`, lab → `lab_to_airport`; admin muss angeben,
Default `airport_to_lab`). Server friert ein: Flugplan-`content_sha256`, Szenario-Datei-SHA256,
je Run Zustand + `coupled-evidence.json`-Hash. Status: `frozen`.
Evidenz: `model_checked`, wenn alle Runs abgeschlossen gekoppelt, sonst `synthetic`.

**Lastprofil:** `GET …/exchange/{item_id}/profile.csv?run_id=…&metric=ground_charging_kw`
(`metric`: `ground_charging_kw` Default | `grid_import_kw` | `parking_kw`; `run_id`
Default = erster Run im Paket; nur abgeschlossene, sicherheitsgepruefte gekoppelte Runs).
```
interval_start_utc,interval_end_utc,power_kw
2026-10-03T22:00:00Z,2026-10-03T22:01:00Z,0.0
```
Header: `X-Profile-Sha256`, `X-Profile-Unit: kW`, `X-Source-Artifact-Sha256`.
JSON-Variante: `…/profile.json` (`unit`, `interval_min`, `points`, `sha256`,
`notice: "Versuchsentwurf, Freigabe separat"`).

### test_request (Flughafen → Lab)
```json
{"type": "test_request", "question": "Haelt der Ladepark die Abgangswelle 06-08 Uhr?",
 "component": "Bus-Ladepunkt 150 kW", "scenario_package_id": "uuid",
 "note": "optional"}
```
Rolle airport|admin. Voraussetzung: Projekt-Toleranzen gesperrt (sonst 409
`acceptance_criteria_not_locked`); deren SHA256 wird im Inhalt eingefroren.
Workflow `POST …/exchange/{item_id}/transition` `{"to": "accepted"}`:
`proposed → accepted → scheduled → done`; `proposed|accepted|scheduled → rejected`
(`reason` Pflicht). Nur `lab`|`admin`. `done` nur mit mindestens einem verknuepften
`lab_result`. Ungueltiger Uebergang → 409.

### lab_result (Lab → Flughafen)
```json
{"type": "lab_result", "test_request_id": "uuid", "flexlab_run_id": "uuid",
 "pilot_assessment_id": null, "summary": "Lastspitze gehalten, 3 % Reserve."}
```
Rolle lab|admin; Testanfrage muss `accepted` oder `scheduled` (oder `done`) sein.
Mindestens eine Quelle. Server liest Verdict, `source_sha256`, Analyse-Hash
(SHA256 der Analyse) bzw. Pilot-`validity_status`/`evaluation_kind`; Client kann keine
Verdicts oder Evidenzstufen setzen. Evidenz: `empirical_pass` nur ueber
Pilot-Holdout-PASS, sonst `empirical_open` (FlexLab-CSV) bzw. `synthetic` (FlexLab-Simulation).

### Kommentare
`GET|POST …/exchange/{item_id}/comments` `{"text": "…"}` (jede schreibberechtigte Rolle).

### Audit und Paket
`GET /api/v1/projects/{id}/exchange-audit` – Audit-Eintraege `exchange_*` aus der
Pilot-Hashkette (`actor`, `role`, `created_at`, `action`, `entity_id`, `entry_hash`).
`GET /api/v1/projects/{id}/exchange-package` – ZIP: `items.json`, `comments.json`,
`links.json`, `audit.json`, `profiles/<item>-<run>.csv` je Paket, `manifest.json`
(SHA256 je Datei + Item-Hashes + `manifest_sha256`).

## Szenario-Bibliothek

`GET /api/v1/library/scenarios`
```json
[{"id": "airport_case_01_spitzenwelle_v1", "title": "Spitzenwelle",
  "summary": "Mehr Ankuenfte und Abfluege als ueblich …",
  "key_message": "Zeigt, ob Gates und Abfertigung eine Verkehrsspitze abfangen.",
  "metrics": {"source": "latest_completed_run", "run_id": "…", "otp_rate_pct": 88.1, …}
            | {"source": "none", …null},
  "targets": [{"name": "OTP", "metric": "airport_kpis.otp_rate_pct", "op": ">=", "threshold": 85.0}],
  "duration_s": 60.0, "data_status": "synthetic", "sha256": "…"}]
```
`POST /api/v1/library/scenarios/{scenario_id}/adopt` `{"project_id": "uuid", "note": "…"}`
→ legt ein `scenario_package` (`scenario_id`, Datei-Hash) im Projekt an (201).

## Lagebild

`GET /api/v1/projects/{id}/situation`
```json
{"available": true, "run_id": "…", "policy": "mission_priority", "day_start_utc": "…Z",
 "interval_min": 15,
 "series": [{"start_utc": "…Z", "end_utc": "…Z", "grid_import_kw": 812.4,
             "grid_limit_kw": 3500.0, "pv_kw": 120.0, "charging_kw": 310.2}],
 "departures": [{"start_utc": "…Z", "end_utc": "…Z", "count": 7, "delayed": 1}],
 "bottleneck_windows": [{"start_utc": "…Z", "end_utc": "…Z", "minutes": 23, "peak_kw": 3500.0}],
 "answer": {"bottleneck": "energy", "minutes_at_limit": 41, "peak_kw": 3500.0,
            "delayed_departures": 3, "departures_total": 120,
            "cause_shares_pct": {"energy": 70.0, "resource": 30.0}},
 "evidence_level": "model_checked", "data_status": "synthetic_assumptions_uncalibrated"}
```
Run = neuester abgeschlossener gekoppelter Run unter den Projekt-Verknuepfungen
(`coupled_run`, sonst Runs aus Szenario-Paketen). Mittelwerte je 15 min (Leistung,
kW); „am Limit“ = `grid_import_kw >= effective_grid_cap_kw - 0.5 kW`. Ohne Run:
```json
{"available": false, "run_id": null, "series": [], "departures": [],
 "bottleneck_windows": [], "answer": {"bottleneck": null, "minutes_at_limit": null,
 "peak_kw": null, "delayed_departures": null, "departures_total": null,
 "cause_shares_pct": null}, "evidence_level": null, "reason": "no_completed_coupled_run"}
```
