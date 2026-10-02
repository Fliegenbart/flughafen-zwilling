# Airport Twin Core + FlexLab Workbench

**Der Flughafen-Zwilling ist der primaere Arbeitsbereich. Die FlexLab Workbench
bleibt als separates Zusatzwerkzeug erhalten; sie ersetzt den Flughafen nicht.**
Ein gemeinsamer lokaler Docker-Start, zwei klar getrennte Oberflaechen und
Datenbereiche. React + FastAPI, persistente lokale Worker, keine Cloudpflicht.

## Start fuer Timo

Voraussetzung: Git und laufendes Docker mit Compose. Der erste Build braucht
Internet fuer Pakete und Images. Ohne branch-Angabe wird der aktuelle
Standardbranch des Repositorys verwendet.

```sh
git clone https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

| Arbeitsbereich | Link | Zweck |
| --- | --- | --- |
| Flughafen (Standard) | [localhost:5176](http://localhost:5176/) | Acht Airport-Stresstests, KPI-Kurven, Playbook-/Baseline-Vergleich |
| Flughafen (Direktlink) | [workspace=airport](http://localhost:5176/?workspace=airport) | Derselbe Airport Twin Core |
| FlexLab (Zusatzwerkzeug) | [workspace=flexlab](http://localhost:5176/?workspace=flexlab) | Getrennte Leistungs-/Messdatenauswertung und CSV-Import |
| API-Dokumentation | [localhost:5176/docs](http://localhost:5176/docs) | Beide APIs; API direkt auch auf Port 8010 |

Oben in beiden Anwendungen gibt es einen sichtbaren Arbeitsbereich-Wechsel.
Der Wechsel laedt die andere Anwendung neu; laufende Jobs bleiben im Backend.
Airport-Runs und FlexLab-Runs werden nicht miteinander verglichen.

Kein Login. **Nur localhost, nicht ins Internet oder gemeinsam ins Lab-Netz
exponieren.** UI und API verwenden denselben Origin, keine manuelle CORS-Einstellung.
Jobs, Rohimporte und Reports liegen im Docker-Volume
`airport-twin-demo_twin-data` und ueberleben Neustarts.

An Timo schicken: [gemeinsame Startanleitung](docs/TIMO_PILOT.md),
[Airport-Testablauf](docs/TIMO_AIRPORT_PILOT.md) und optional
[FlexLab-Testablauf](docs/TIMO_FLEXLAB_PILOT.md).

## Flughafen: Was funktioniert

- Acht Cases: Spitzenwelle, Guillotine-Test, Wetter-Kompression, Gepaeckstau,
  Personalengpass, Sicherheitswelle, Enteisungsfenster und Schwarzstart.
- Deterministische Szenarien, konfigurierbare Gate-/Crew-/Runway-Kapazitaeten,
  OTP, Turnaround, Auslastung, Warteschlangen und Delay.
- SIL-Schnelllauf oder Echtzeit-Demo mit simulierten Adaptern.
- Playbook-Suche mit Baseline, Empfehlung, Pareto-Alternativen,
  Validierungsrun-IDs und modellbasierten KPI-Deltas. Nur Empfehlungen.
- HTML-Report, Backend-PDF, Telemetrie-CSV und JSON-Record.
- Serielle Worker und persistente Neustart-Recovery mit derselben Job-ID.
- Optionales provisioniertes Grafana-/Influx-/Prometheus-Monitoring.

**Das Flughafenmodell ist ein unkalibrierter Methodenprototyp.** KPIs sind
Modellwerte, keine Betriebsprognosen. Die kurzen Demo-Szenarien bilden keine
komprimierten Betriebsstunden ab; Gate-Auslastung und abgeschlossene Abfluege
sind deshalb oft sehr klein. Es gibt keine Echtzeit-Flugdaten und keine
abgenommene Hardwareintegration. Die Playbook-Validierung verwendet denselben
Simulator und ist keine unabhaengige empirische Validierung. Eine bereits
zulaessige Baseline darf korrekt zu einer Empfehlung ohne Massnahmen fuehren.

Guillotine und Schwarzstart sind hier **Airport-Kapazitaetsstresstests**, keine
elektrischen Netz-/Notstromtests. Ein Flughafen-Energietest mit realen Anlagen
ist eine separate Weiterentwicklung, nicht bereits implementiert.

Modellgrenzen und Architektur: [Airport-Prototyp](docs/AIRPORT_PROTOTYPE.md),
[Wiederherstellungs-Audit](docs/RECOVERY_AUDIT.md).

## FlexLab: Bewahrt, nicht als neuer Lab-Mehrwert vorausgesetzt

Die bereits entwickelte Workbench bleibt voll nutzbar: vier Referenztests,
CSV-Vertrag `ts_s,power_kw,setpoint_kw,limit_kw`, Leistungs-/Energieauswertung,
eingefrorene Kriterien, Historie, Abbruch, Baseline-Vergleich und Evidenzexporte.
Keine OCPP-/EEBUS-Anbindung oder reale Anlagensteuerung; schlechte Datenqualitaet
darf keinen PASS erzeugen. Methoden: [FlexLab v1](docs/FLEXLAB_V1.md).

Ob das TestingLab diese Funktionen bereits besitzt, ist nicht verifiziert.
Sie werden nicht als Ersatz fuer vorhandene Pruefstaende positioniert.

Der unveraenderte Stand vor dem Airport-first-Einstieg ist auf GitHub gesichert:
Tag `flexlab-workbench-v1-2026-10-03`, Commit
`a17504188914132a87882ebf744d3e66c955f201`. Der Branch
`codex/flexlab-workbench` bleibt ebenfalls erhalten. Die Snapshots unter
`legacy/` werden nicht veraendert.

## Optional: Live-Grafana fuer Airport

```sh
docker compose -f docker-compose.demo.yml -f docker-compose.demo-monitoring.yml up --build -d
```

[Airport Twin Cockpit](http://localhost:3000/d/airport-twin-cockpit/airport-twin-cockpit)
mit `admin` / `airport-demo` (oeffentliche lokale Demozugangsdaten).
Im Airport-Frontend `Demo Live starten` verwenden. Das Dashboard aktualisiert
alle 10 Sekunden; erst neue Airport-Runs liefern Daten. Die FlexLab-Leistungskurve
aktualisiert sich in der Workbench, **nicht** in diesem Grafana-Dashboard.

## Betrieb und Diagnose

```sh
# Status / Logs
docker compose -f docker-compose.demo.yml ps
docker compose -f docker-compose.demo.yml logs --tail=100 twin-core frontend
# Stoppen ohne Datenverlust; NICHT down -v verwenden
docker compose -f docker-compose.demo.yml down
# Vorhandenes Checkout aktualisieren und neu bauen
git pull --ff-only
docker compose -f docker-compose.demo.yml up --build -d
```

Bei Portkonflikten `AIRPORT_UI_PORT` / `AIRPORT_API_PORT` aendern. Beispiel fuer
macOS/Linux: `AIRPORT_UI_PORT=5177 AIRPORT_API_PORT=8011 docker compose -f
docker-compose.demo.yml up --build -d`. Bestehende Monitoring-Installationen
immer mit beiden Compose-Dateien verwalten, damit Influx aktiv bleibt.

## Entwicklung und Verifikation

Node 22.19+ und Python 3.12; nur **einen** Backend-Prozess verwenden.

```sh
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e './backend[dev]'
INFLUX_TOKEN='' backend/.venv/bin/python -m pytest backend/tests -q
TWIN_DATA_DIR="$PWD/data" INFLUX_TOKEN='' backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --workers 1
```

Zweites Terminal: `npm run dev`. Vite proxyt `/api` an Port 8010;
alternativ `TWIN_DEV_API_URL` setzen. Lokale Demo pruefen:

```sh
python3 scripts/smoke_demo.py --planner --all-cases
python3 scripts/smoke_flexlab.py
sh scripts/check-recovery.sh
```

```text
src/WorkspaceApp.tsx         Airport-first-Einstieg und sichtbarer Wechsel
src/App.tsx                 Airport-Cockpit und HTML-Export
src/lab/                    Separate FlexLab Workbench
backend/app/                Airport API, Simulator, Planner, Worker
backend/app/lab/            Separater CSV-/Analyse-/Worker-Kern
data/scenarios/             Airport-Seeds
data/lab/                  FlexLab-Laufzeitdaten (gitignored)
deploy/demo/               Docker und Same-Origin-Proxy
legacy/                    Unveraenderte Ausgangssnapshots
```
