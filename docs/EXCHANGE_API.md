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
kW); „am Limit“ = `grid_import_kw >= effective_grid_cap_kw - 0.5 kW`, gezaehlt nur im
Verkehrstag (nicht im Vorlauf vor Mitternacht). Ohne Run:
```json
{"available": false, "run_id": null, "series": [], "departures": [],
 "bottleneck_windows": [], "answer": {"bottleneck": null, "minutes_at_limit": null,
 "peak_kw": null, "delayed_departures": null, "departures_total": null,
 "cause_shares_pct": null}, "evidence_level": null, "reason": "no_completed_coupled_run"}
```

## Vorschau fuer die Regler (Durchrechnen)

`POST /api/v1/projects/{id}/situation/preview` rechnet den Tag fuer eine Reglerstellung genau
(dieselbe Basis und dieselben Aenderungen wie bei Loesungen), ohne Warteschlange, ohne Speichern,
ohne Versiegelung. Der Browser naehert dieselbe Stellung beim Ziehen selbst und ersetzt die
Naeherung nach rund 280 ms durch diese Antwort. Koerper, alles optional (leer = heutiger Stand):
`grid_import_limit_kw`, `storage_kwh` (0 = keine Batterie) mit `storage_kw`, `pv_factor` (0 bis 3),
`extra_vehicles {klasse: anzahl}`, `charging_policy` (`uncontrolled|mission_priority`) und `crisis`
(Krisenfall der Bibliothek, Energie-Abbild wie beim Stresstest). Unbekannte Felder → 422, ebenso
Werte, die die Variantenpruefung ablehnt. Antwort: Minutenreihen als Spalten (`requested_kw`,
`delivered_kw`, `background_kw`, `pv_kw`, `chp_kw`, `grid_cap_kw`, `grid_import_kw`, `battery_kw`,
Batterie + gibt ab), `power`, `policy`, `changes`, `crisis`, `departures` je halbe Stunde und
`kpis` (`departures_total`, `delayed_departures`, `on_time_pct`, `minutes_at_limit` im
Verkehrstag, `background_unserved_kwh`, `energy_wait_share_pct`, `bottleneck`). Die Antwort ist
als `preview: true`, `evidence_level: synthetic` markiert; verbindlich sind nur versiegelte Laeufe
(Varianten). Parallele Anfragen warten bis zu 8 s auf den Rechenplatz (sonst 429).

## Varianten („Was hilft?“)

Modul `backend/app/exchange/variants.py`, Tests `backend/tests/test_variants.py`.

**Basis** = Konfiguration, Seed, Laderegel und Flugplan des neuesten abgeschlossenen gekoppelten
Projektlaufs; ohne Lauf der zuletzt verknuepfte Flugplan mit Standardannahmen (Seed 42,
Laderegel `uncontrolled`). Ohne beides → `409 no_base: …`.

`POST /api/v1/projects/{id}/variants` (airport|admin; lab/viewer → 403), max. 8 je Projekt,
Name eindeutig (409):
```json
{"name": "Speicher 2 MWh",
 "changes": {"grid_import_limit_kw": 4500, "storage_kwh": 2000, "storage_kw": 1000,
             "extra_vehicles": {"pushback_tug": 5}, "charging_policy": "mission_priority",
             "chargers_offline": {"bus": 1}, "pv_factor": 1.5}}
```
Alle Felder optional, mindestens eines. Grenzen: Netzimport 0–100 000 kW; Speicher 0–50 000 kWh,
Leistung 0,1C–4C (Default kWh/2); zusaetzliche Fahrzeuge 1–100 je Klasse (Modellgrenzen 200 je
Klasse, 300 gesamt); Ladepunkte offline 1–Anzahl der Klasse (ganzer Verkehrstag); PV-Faktor 0–3
(× `pv_capacity_kwp`). Die Variante wird gegen den Flugplan gebaut; Verstoss → `422
invalid_variant: …`, keine wirksame Aenderung → 422. `DELETE …/variants/{variant_id}` → 204.

`POST …/variants/run` `{"stress": false}` (airport|admin, 202): rechnet Basis + alle Varianten
seriell im vorhandenen Run-Worker auf demselben Flugplan-Snapshot und Seed. Alle Welten muessen
dieselbe Missionssignatur (SHA256 der Auftraege) haben, sonst 500. `stress: true` rechnet je
Eintrag zusaetzlich Netzimport −20 % ueber den Tag. `{"crisis": "airport_case_0N_…_v1"}` ersetzt
diesen Standard durch das Energie-Abbild eines Krisenfalls der Szenario-Bibliothek
(`backend/app/exchange/crisis.py`, schaltet `stress` ein; unbekannter Fall → 422). Das Abbild ist
eine ausgewiesene **Annahme**: Netzgrenzen je Zeitfenster, Ladepunktausfaelle, PV-Faktor,
Akkukapazitaet. Die Auftraege bleiben eingefroren; Slots, Positionen und Personal des Falls
werden nicht modelliert. Queue-Limit fuer Varianten: 24 offene Runs (429).

`GET …/variants` → `base` (inkl. `fleet`), `variants` (Definitionen), `latest_run`:
`status` (`queued|running|completed|partial`), `progress {done,total}`, `mission_signature`,
`source_plan_sha256`, `seed`, `stale` (Definitionen seit dem Lauf geaendert), `entries[]` je
Basis/Variante mit `world_hash`, `run_id`, `status`, `fleet`, `kpis`, `delta_to_base`,
`evidence_level`, `criteria`, `stress`, sowie `answer`. `latest_run.stress_kind`
(`grid_minus_20|crisis|null`) und `latest_run.crisis` (`id`, `name`, `assumption`) nennen den Stresstest.

`kpis`: `on_time_pct` (Anteil Abfluege, deren modellierte Auftraege fristgerecht fertig sind),
`delayed_departures`, `departures_total`, `minutes_at_limit` (wie Lagebild, nur Verkehrstag),
`peak_kw`, `missing_kw_peak` (UI: „ungedeckter Ladebedarf in der Spitze“; Maximum je Minute von angefragter
minus gelieferter Ladeleistung, kW, keine Summe; Feldname bleibt aus Kompatibilitaetsgruenden; `null` bei
Laeufen ohne Spalte `charging_requested_kw`), `grid_energy_mwh_day` (Netzbezug nur
Verkehrstag), `background_unserved_kwh`, `bottleneck`, `cause_shares_pct`, Wartezeiten.

`evidence_level`: `model_checked` nur wenn Artefakt versiegelt/geprueft, gleiche
Nachfragewelt, Flotten- und Speicherbilanz ≤ 1e-6 kWh und Grundlast voll versorgt; sonst
`synthetic` (abgeschlossen) bzw. `assumption`.

`answer`: Puenktlichkeit und Netzentlastung getrennt bewertet. Puenktlich messbar besser ab
+0,5 Pp. `on_time_pct`, Netz messbar entlastet/belastet ab 1 min `minutes_at_limit`.
`punctuality_best_id` (beste nach Puenktlichkeit), `grid_best_id` (staerkste Netzentlastung),
`tradeoffs` (Puenktlichkeit besser, Netz staerker belastet → „Zielkonflikt“ in `headline`/`details`).
`status`: `winner` (mit `best_variant_id`, `headline` „Pünktlichkeit: „X“ hilft am meisten, …“
plus Netzsatz), `tie` (`tied`), `grid_only` („Keine Variante verbessert die Pünktlichkeit; Netz
entlastet am stärksten: „X“ (−N Minuten am Limit).“, `best_variant_id` = `grid_best_id`),
`no_measurable_difference` („Keine Variante verbessert die Pünktlichkeit; keine Variante
entlastet das Netz messbar.“),
`pending`. `no_effect`/`worse` + `details` („…: kein messbarer Unterschied.“).

**Speicher im Modell** (`PowerConfig`): Entladung nur, wenn der Bedarf ueber der wirksamen
Netzimportgrenze liegt (Peak Shaving an der Grenze), begrenzt durch Leistung, Wirkungsgrad und
Reserve-SOC. Laden aus PV/BHKW-Ueberschuss; neu optional `battery_grid_charge_below_kw`: Netzladung,
solange der Netzbezug darunter liegt (Varianten setzen 80 % der Anschlussgrenze). Default `null`
wird nicht serialisiert → Welt-Hashes und Ergebnisse alter Konfigurationen unveraendert, daher
keine neue Engine-Version (`airport_coupled_v2`). Neue Serienspalte `charging_requested_kw`.

**Flotte**: `overview.fleet` und `situation.fleet`
(`{"total_vehicles", "total_chargers", "by_kind": [{kind,label,vehicles,chargers}], "source"}`;
`source`: `coupled_run` | `default_assumptions` | `null`).

## Projektwerte Flotte und Anlagen (Schritt „Daten“)

Modul `backend/app/exchange/assets.py`, Tests `backend/tests/test_project_assets.py`.

`GET /api/v1/projects/{id}/assets` → `status` (`fehlt|annahme|echt`), `entries[]`
(`key`, `value`, `unit`, `original_value`, `original_unit`, `source`, `source_date`, `status`),
`fields[]` (Katalog mit Einheit, Grenzen, `default` = Standardannahme), `version` (SHA256, Herkunft).
`PUT …/assets` `{"entries": [{"key": "grid_import_limit_kw", "value": 4.2, "unit": "MW",
"source": "Netzvertrag", "source_date": "2025-11-01"}]}` ersetzt den Satz (neue Version, Audit
`exchange_assets_set`). `POST …/assets/import?filename=…` mit CSV (`key,value,unit,source,source_date`,
`#`-Kommentare) oder JSON (`{"entries": […]}`), max. 256 KiB; das Original wird mit SHA256 gespeichert.
Rollen airport|admin (lab → 403). Fehler → `422 invalid_assets: <deutscher Satz>`.
Einheiten kW/MW, kWh/MWh, kWp/MWp, Stück; Umrechnung in die kanonische Einheit, Original bleibt.
Ohne Quelle bleibt ein Wert `annahme`; `echt` = Netzanschluss + Fahrzeugzahl, alle mit Quelle.

Wirkung: Die Werte überschreiben in der Varianten-Basis (gekoppelter Lauf oder Flugplan-Standard)
die passenden Felder (`base.project_assets`, im Batch eingefroren). Der Basislauf jeder
Variantenrechnung zählt für Lagebild und Zusage als Projektlauf; bestehende Läufe ändern sich nicht.
Frontend: Runtime-Flag `sharedDemoNotice` (Default an) blendet den Hinweis „geteilte Demo“ aus.
