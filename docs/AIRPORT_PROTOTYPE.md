# Airport Twin Core

Lokaler Methodenprototyp fuer Flughafen-Gate-/Turnaround-Tests: Stoerungen
simulieren, KPIs verfolgen und Gegenmassnahmen gegen dieselbe Baseline vergleichen.

**Demo-Modell, nicht kalibriert.** Die Zahlen sind Modellwerte, keine
betrieblichen Flughafenprognosen. Keine Echtzeit-Flugdaten, keine automatische
Hardware-Aktuierung. Der erste Zweck ist eine gemeinsame Testfrage mit dem Lab
zu entwickeln, nicht eine optimale Flughafenentscheidung nachzuweisen.

## Schnellstart fuer Timo

Voraussetzung: Git und Docker Desktop mit Compose. Docker muss laufen.

```sh
git clone --branch codex/recovery-audit https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

- Dashboard: [localhost:5176](http://localhost:5176)
- Backend-Dokumentation: [localhost:5176/docs](http://localhost:5176/docs)
- Backend direkt: [localhost:8010/docs](http://localhost:8010/docs)
- Kein Login fuer die lokale Demo. **Nicht ins Internet exponieren.**

UI und API verwenden denselben Browser-Origin, ohne manuelle CORS-Konfiguration.
Seeds werden beim ersten Start automatisch angelegt. Jobs/Reports bleiben in
einem eigenen Docker-Volume erhalten. Bei belegten Ports:

```sh
AIRPORT_UI_PORT=5177 AIRPORT_API_PORT=8011 docker compose -f docker-compose.demo.yml up -d
```

Stoppen, ohne Daten zu loeschen:

```sh
docker compose -f docker-compose.demo.yml down
```

Der konkrete 20-Minuten-Test und die Rueckmeldefragen stehen in
[docs/TIMO_PILOT.md](docs/TIMO_PILOT.md).

## Was funktioniert

- Acht Airport-Cases, deterministische Seeds, Run-ID und KPI-Zeitreihen.
- Asynchrone serielle Run-/Playbook-Worker mit persistenter Neustart-Recovery.
- Playbook-Suche: Baseline, Empfehlung, Pareto-Alternativen, SIL-Validierungsruns
  und KPI-Deltas. Empfehlung-only; Kosten sind dimensionslose Demo-Punkte.
- Modellbasierte Forecasts aus Konfiguration oder Run-Snapshot.
- Frontend-HTML-Report mit Vergleich; Backend-PDF, CSV und JSON-Artefakte.
- Optionale Grafana-/Influx-/Prometheus-Observability.
- Modbus/MQTT/OPC-UA-Adapter sind vorhanden; reale Hardware ist **nicht**
  Bestandteil der aktuellen Demo-Abnahme.

## Case-Bibliothek

1. Spitzenwelle
2. Guillotine-Test
3. Wetter-Kompression
4. Gepaeckstau
5. Personalengpass
6. Sicherheitswelle
7. Enteisungsfenster
8. Schwarzstart

Guillotine und Schwarzstart sind Airport-Kapazitaetsstresstests. Schwarzstart
ist hier **kein** elektrischer Netz-/Notstromtest.

## Optional: Live-Grafana

```sh
docker compose -f docker-compose.demo.yml -f docker-compose.demo-monitoring.yml up --build -d
```

[Airport Twin Cockpit](http://localhost:3000/d/airport-twin-cockpit/airport-twin-cockpit)
mit Login `admin` / `airport-demo`. Diese Zugangsdaten sind ausschliesslich
fuer die isolierte lokale Demo bestimmt. Das Dashboard aktualisiert alle
10 Sekunden. Erst nach einem neuen Run gibt es Daten; im Frontend
`Demo Live starten` verwenden und ggf. die Run-ID in Grafana waehlen.
Das Monitoring benutzt eigene Volumes, keine alten lokalen Grafana-Daten.

## Aufbau

```text
src/                         React-Dashboard und HTML-Export
backend/app/                 FastAPI, Simulator, Worker, Planner und Forecast
backend/tests/               Backend- und Recovery-Tests
data/scenarios/              Baseline und acht Airport-Seeds
data/model_packs/            Airport-Referenzparameter
deploy/demo/                 Docker-Builds, Seed-Initialisierung, UI/API-Proxy
deploy/grafana/               Provisioniertes Airport-Dashboard
legacy/                      Unveraenderte archivierte Ausgangssnapshots
```

Die aktive Airport-Version wurde aus den erhaltenen historischen Quellcode-
Aenderungen wiederhergestellt. Provenienz, Codebefunde und Grenzen:
[docs/RECOVERY_AUDIT.md](docs/RECOVERY_AUDIT.md).

## Entwicklung und Checks

Node 22.19+ und Python 3.12 verwenden.

```sh
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e './backend[dev]'
INFLUX_TOKEN='' backend/.venv/bin/python -m pytest backend/tests -q
sh scripts/check-recovery.sh
```

Optionaler API-Smoke gegen die laufende Demo (nur Python-Standardbibliothek):

```sh
python3 scripts/smoke_demo.py --planner
```

Nur **einen** Backend-Prozess starten. Die lokalen Worker sind keine externe
Queue und nicht fuer horizontale Skalierung vorgesehen. Das historische
`docker-compose.yml` ist kein frischer Demo-Startweg; fuer den Pilot ausschliesslich
`docker-compose.demo.yml` verwenden.
