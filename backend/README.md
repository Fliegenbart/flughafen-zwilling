# FlexLab Workbench API

Lokale, messdatenbasierte Testauswertung ohne Hardware-Schreibzugriff.
Die vorhandene Airport Twin API bleibt kompatibel.

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
