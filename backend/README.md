# Airport Twin Core + FlexLab API

Airport ist der primaere Arbeitsbereich. Die separate FlexLab-Auswertung bleibt
unter `/api/v1/lab` erhalten; bestehende Airport-Endpunkte bleiben kompatibel.
Alle Arbeitsbereiche werden lokal ohne reale Anlagenansteuerung betrieben.

Muenchen-Pilot: `munich/` enthaelt begrenzte Annahmen, deterministischen
24-Stunden-Simulator, Vergleichs-API und Energieberichte. Neue additive
Domaene `airport_energy_v1`, Energie-KPIs im bestehenden Run-Pfad. Zwei SIL-Runs
ueber denselben Worker; eingefrorene Eingaben und Recovery bleiben erhalten.
HIL/Adapter und Turnaround-Playbook sind hier gesperrt. Quellen-Dossier aus
`data/references` (Docker: `/opt/airport-references`); keine privaten FMG-Daten.
Vertrag/Grenzen: `../docs/MUNICH_PILOT.md`.

Zusaetzlich `airport_coupled_v1`: `coupled_world.py` friert einen manuell
ausgewaehlten Flugplan plus Missionsannahmen ein; `coupled_simulator.py` koppelt
Fahrzeugbelegung/SOC an `coupled_power.py`. `GET /api/v1/munich/coupled-reference`
und `POST /api/v1/munich/coupled-comparisons` erzeugen zwei normale SIL-Runs.
Nur Laderegel/Ladepunktbelegung unterscheiden sich. Neue `coupled_kpis` und
SHA256-gepruefte Aufgaben-/Abflug-/Fahrzeug-/Parkhaus-Artefakte im vorhandenen
Run-Pfad. Keine HIL-Adapter, kein Influx-Livezeit-Fake. Modellvertrag und Grenzen:
`../docs/MUNICH_COUPLED.md`. Das ist kein Produktions-/FMG-Validierungsnachweis.

## Start und Tests

Im Repository-Root, Python 3.12:

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e './backend[dev]'
INFLUX_TOKEN='' backend/.venv/bin/python -m pytest backend/tests -q
TWIN_DATA_DIR="$PWD/data" INFLUX_TOKEN='' \
  backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --workers 1
```

API-Dokumentation: `http://localhost:8010/docs`. Genau ein Prozess; lokale
Worker/JSON-Persistenz sind nicht multiprozesssicher. Keine Authentifizierung,
daher nur lokal betreiben.

## FlexLab-Kern

- `lab/models.py`: typisierte, endliche Zahlen mit Einheiten und Begrenzungen.
- `lab/analysis.py`: strenger CSV-Parser, Zeitabdeckung, Energie, Tracking,
  Reaktionszeit, obere Leistungsgrenze und erklaerbare Assertions.
- `lab/simulator.py`: deterministisches aggregiertes Referenzlastmodell.
- `lab/service.py`: serieller Worker, atomare Records/Traces, Abbruch,
  persistente Neustart-Recovery, auditierbarer Baseline-Vergleich.
- `lab/router.py`: API unter `/api/v1/lab`, begrenzte Imports und Artefakt-Whitelist.
- `lab/report.py`: standalone HTML und CSV; Nutzertext wird escaped.

CSV-Import ist JSON-Transport mit `csv_text`, kein Hardwareconnector. Rohdaten
liegen unter `TWIN_DATA_DIR/lab/runs/<uuid>`. Diese Daten nicht committen.
Methoden und Grenzen: `../docs/FLEXLAB_V1.md`; Timos Ablauf: `../docs/TIMO_PILOT.md`.

Airport-Prototyp: `../docs/AIRPORT_BACKEND.md`. Seine Adapter werden nicht fuer
FlexLab verwendet; kein OCPP-/EEBUS-Support und kein Live-Schreibpfad.
