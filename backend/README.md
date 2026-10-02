# Airport Twin Core Backend

Deterministischer, unkalibrierter Methodenprototyp fuer Gate-/Turnaround-Tests.
Keine Betriebsprognose, kein Flugleitsystem und keine Live-Aktuierung im Pilot.

## Lokal entwickeln

Python 3.12 verwenden. Im Repository-Root:

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e './backend[dev]'
INFLUX_TOKEN='' backend/.venv/bin/python -m pytest backend/tests -q
TWIN_DATA_DIR="$PWD/data" TWIN_ENABLE_PLAYBOOK_SYNTH=1 \
  backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Genau ein Uvicorn-Prozess: die persistenten Queues sind lokal und nicht
fuer mehrere Prozesse oder horizontale Skalierung ausgelegt.
API-Dokumentation: `http://localhost:8000/docs`.

## Aufbau

- `models.py`: Scenario-, Run-, KPI-, Playbook- und Forecast-Vertraege.
- `simulators/airport_turnaround.py`: aggregiertes Kapazitaetsmodell.
- `deterministic.py`: Domain-Dispatcher und Assertions.
- `run_service.py`, `workers.py`, `storage.py`: serielle Jobs, JSON-Artefakte,
  Neustart-Recovery mit derselben Job-ID.
- `playbook_synth.py`, `playbook_service.py`: begrenzte Strategiesuche,
  Baseline, Pareto-Optionen und SIL-Validierungsruns.
- `forecast_service.py`: modellbasierte Projektionen aus Konfiguration/Run.
- `observability.py`: optionale Influx-Telemetrie und Prometheus-Metriken.

Der Playbook-Feature-Flag ist ausserhalb der expliziten Demo standardmaessig
ausgeschaltet. Adaptersupport ist vorhanden, aber nicht Teil der SIL-Abnahme.
Details und Grenzen: `../docs/RECOVERY_AUDIT.md`.
