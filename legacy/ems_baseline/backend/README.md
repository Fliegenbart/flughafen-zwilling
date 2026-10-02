# Twin Core Service (Phase 0/1 Foundation)

FastAPI service implementing the first executable foundation of the world-class Kasernen-EMS digital twin roadmap.

## Included now

- Deterministic simulation core with seeded RNG and event scheduler
- Scenario API (`/api/v1/scenarios`)
- Model pack API (`/api/v1/model-packs`)
- Run orchestration API (`/api/v1/runs`)
- Mapping profile API (`/api/v1/mapping-profiles`)
- Readiness API (`/api/v1/ready`)
- Telemetry artifact generation (JSONL)
- Machine-readable report (`report.json`) and human-readable report (`report.pdf`)
- Adapter plugin interface with live OPC UA/Modbus/MQTT support and simulation fallback
- Startup checks for data-dir write access and mapping-profile loading
- Structured run lifecycle logs (`run_queued`, `run_started`, `run_completed`, `run_failed`)

## Quickstart

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install ".[dev]"
uvicorn app.main:app --reload
```

Open API docs: <http://127.0.0.1:8000/docs>

Health/Readiness:

```bash
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/api/v1/ready
```

## Install live protocol adapters

```bash
cd backend
source .venv/bin/activate
pip install ".[hil]"
```

Without the optional `hil` extras, endpoints like `sim://...` still work via deterministic simulation adapters.

## Run tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```

## Data layout

Runtime artifacts are written to `backend/data/` by default:

- `scenarios/<scenario_id>.json`
- `model_packs/<model_pack_id>.json`
- `runs/<run_id>/run.json`
- `runs/<run_id>/telemetry.jsonl`
- `runs/<run_id>/report.json`
- `runs/<run_id>/report.pdf`

Set a custom directory with `TWIN_DATA_DIR=/path/to/data`.

## Deployment environment variables

- `TWIN_DATA_DIR`: writable directory for scenarios/model packs/runs
- `TWIN_ALLOWED_ORIGINS`: comma-separated CORS allowlist for UI origins
- `TWIN_LOG_LEVEL`: log level (`INFO`, `DEBUG`, ...)

Example:

```bash
export TWIN_DATA_DIR=/srv/twin/data
export TWIN_ALLOWED_ORIGINS=https://ui-twin.example.vercel.app,https://ui-twin.example.com
export TWIN_LOG_LEVEL=INFO
```

## Docker

`backend/Dockerfile` runs:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Single worker is mandatory in this phase because file-based run-state updates are synchronized in-process.

## Gate A helper

Run 100 stability runs with simulated adapters:

```bash
cd backend
python scripts/gate_a_sim_runs.py --base-url http://127.0.0.1:8000 --runs 100
```

## SIL Fault Injection (Watchdog)

For deterministic watchdog-failure tests in SIL, use the adapter endpoint convention:

```text
sim://fault-watchdog?after_successes=<int>&mode=<once|always>
```

Examples:

- Forced fail after timeout path (`mode=always`):

```json
{
  "name": "modbus",
  "enabled": true,
  "endpoint": "sim://fault-watchdog?after_successes=0&mode=always",
  "watchdog_enabled": true,
  "watchdog_signal": "40100@1",
  "watchdog_interval_ms": 200,
  "watchdog_timeout_ms": 300
}
```

- Single miss with recovery (`mode=once`):

```json
{
  "name": "modbus",
  "enabled": true,
  "endpoint": "sim://fault-watchdog?after_successes=0&mode=once",
  "watchdog_enabled": true,
  "watchdog_signal": "40100@1",
  "watchdog_interval_ms": 200,
  "watchdog_timeout_ms": 1000
}
```

Important: this endpoint mode is for SIL/testing only and must not be used for production live adapter endpoints.
