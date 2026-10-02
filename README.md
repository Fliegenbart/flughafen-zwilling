# FlexLab Workbench

Ein lokaler Testarbeitsplatz fuer Lade- und Flexibilitaetsversuche:
**Leistungsverlauf auswerten, Pruefkriterien einfrieren, Evidenz exportieren.**
React-Oberflaeche + FastAPI + persistenter lokaler Worker, ohne Cloudpflicht.

## Start fuer Timo

Git und laufendes Docker Desktop mit Compose genuegen. Fuer den ersten Build
ist Internetzugang fuer die Pakete notwendig.

```sh
git clone --branch codex/flexlab-workbench https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

- Workbench: [localhost:5176](http://localhost:5176)
- API-Dokumentation: [localhost:5176/docs](http://localhost:5176/docs)
- API direkt: [localhost:8010/docs](http://localhost:8010/docs)
- Kein Login. Ausschliesslich lokal, **nicht ins Internet oder Lab-Netz exponieren**.

UI und API verwenden denselben Origin. Runs, Rohimporte und Reports liegen
im Docker-Volume `airport-twin-demo_twin-data` und ueberleben Neustarts.
Die bestehende Volume-/Projektbenennung bleibt bewusst erhalten.

```sh
# Stoppen, ohne Daten zu loeschen
docker compose -f docker-compose.demo.yml down
# Status und Diagnose
docker compose -f docker-compose.demo.yml ps
docker compose -f docker-compose.demo.yml logs --tail=100 twin-core frontend
```

Bei Portkonflikten `AIRPORT_UI_PORT` / `AIRPORT_API_PORT` aendern; unter macOS/Linux:
`AIRPORT_UI_PORT=5177 AIRPORT_API_PORT=8011 docker compose -f docker-compose.demo.yml up -d`.

## Was v1 leistet

- Vier deterministische Referenztests: Sollwertsprung, Flex-Abregelung,
  Anschlusslimit und Telemetrieausfall. Sekunden sind echte Modellsekunden.
- Einstellbares Pruefstandprofil, Leistungsrampe und Antwortverzoegerung.
- Eigene CSV importieren: `ts_s,power_kw,setpoint_kw,limit_kw`.
- Ist-/Soll-/Limitkurven, bezogene/eingespeiste Energie, Spitzenleistung,
  Sollwertabweichung, Reaktionszeit und beobachtete Grenzverletzungsdauer.
- PASS / FAIL / Nicht bewertbar mit erklaerbaren Pruefentscheidungen.
  Keine Energieinterpolation ueber fehlende Messwerte oder ungueltige Zeitluecken.
- Persistente Historie, kooperativer Abbruch und Neustart unfertiger Laeufe
  mit derselben Run-ID; kein manueller Queue-Reset notwendig.
- Baseline-Vergleich nur bei identischem Testfall, Pruefstand, Kriterien und
  Soll-/Limit-Zeitverlauf. Keine Vermischung beliebiger Messreihen.
- Standalone-HTML-Bericht fuer Druck/PDF, vollstaendiger JSON-Record und CSV-Trace.
- Klare Kennzeichnung der Quelle. Das herunterladbare Beispiel ist simuliert.

## Grenzen

**Keine Live-Geraeteansteuerung. Kein OCPP-/EEBUS-Connector. Kein zertifiziertes
Pruefsystem.** Die Referenzsimulation ist ein aggregiertes, unkalibriertes
Lastmodell, kein validiertes Fahrzeug-/Ladesaeulenmodell. Importierte Daten
sind Nutzerangaben; die Software bestaetigt keine Sensor-/Hardwarekalibrierung.

Das CSV-Format erwartet bereits begrenzte aufgezeichnete Sollwerte. Eine
Messreihe allein ersetzt weder Versuchsvorschrift noch die Freigabe des Labs.
v1 prueft die **obere** aufgezeichnete Leistungsgrenze; keine elektrische
Schutzfunktion und keine Bewertung von Netzqualitaet, Spannung, Frequenz,
OCPP-Konformitaet oder Ladeprotokollen. Einspeise-Untergrenze ist Profilmetadatum,
keine zusaetzliche automatische Schutzpruefung in v1.

Fuer den ersten echten Lab-Einsatz brauchen wir einen anonymisierten Export
und eine abgestimmte Testfrage. Anleitung: [Timos Pilot](docs/TIMO_PILOT.md).
Datenvertrag und Methoden: [FlexLab v1](docs/FLEXLAB_V1.md).

## Entwicklung

Node 22.19+ und Python 3.12:

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

In einem zweiten Terminal `npm run dev`. Vite proxyt `/api` an Port 8010;
alternativ `TWIN_DEV_API_URL` setzen. Nur einen Backend-Prozess verwenden.

```sh
# Laufende Docker-Demo pruefen (nur Python-Standardbibliothek)
python3 scripts/smoke_flexlab.py
sh scripts/check-recovery.sh
```

## Aufbau

```text
src/lab/                 Workbench, typisierte API, Chart, Komponenten, Tests
backend/app/lab/         CSV-Vertrag, Analyse, Referenzmodell, Worker, Exporte
data/lab/               Laufzeitdaten (gitignored; im Docker-Volume)
deploy/demo/            Docker-Builds und Same-Origin-Proxy
docs/                   Pilot, Methoden und Audit
```

Der Airport-Prototyp bleibt unter
[?workspace=airport](http://localhost:5176/?workspace=airport) erreichbar.
Seine APIs, Seeds und Tests bleiben erhalten; Beschreibung und Grenzen:
[Airport-Prototyp](docs/AIRPORT_PROTOTYPE.md),
[Wiederherstellungs-Audit](docs/RECOVERY_AUDIT.md).
Die Snapshots unter `legacy/` bleiben unveraendert.

## Optionales Monitoring

```sh
docker compose -f docker-compose.demo.yml -f docker-compose.demo-monitoring.yml up --build -d
```

[Grafana](http://localhost:3000) mit `admin` / `airport-demo` (oeffentliche lokale
Demozugangsdaten). Das vorhandene Dashboard zeigt **Airport-Telemetrie**, nicht
die neuen FlexLab-Runs. Die FlexLab-Leistungskurve aktualisiert sich direkt in
der Workbench. Der aktuelle Umfang braucht Grafana nicht.
