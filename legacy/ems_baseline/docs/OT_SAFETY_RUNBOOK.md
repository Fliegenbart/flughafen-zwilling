# OT Safety Runbook (Phase 1)

## Ziel
Dieses Runbook beschreibt den verpflichtenden Sicherheitsnachweis fuer den HIL-Betrieb im TestingLab: Dead-Man-Switch (Watchdog), Safe-State-Reaktion und Incident-Dokumentation.

## Voraussetzungen
- SPS/RTU erzwingt Safe-State bei ausbleibendem Heartbeat > `watchdog_timeout_ms`
- Adapter ist mit `watchdog_enabled=true` und `watchdog_signal` konfiguriert
- Twin-Core laeuft als Single-Instance (`uvicorn --workers 1`)

## Standardparameter
- `watchdog_interval_ms=500`
- `watchdog_timeout_ms=1000`

## Test 1: Netzwerkverbindung trennen
1. HIL-Run mit aktivem Live-Adapter starten.
2. Netzwerkpfad zum Adapter unterbrechen (z. B. Kabel ziehen / VLAN isolieren).
3. Erwartung:
- SPS geht innerhalb Timeout in Safe-State.
- Twin-Run wird `failed`.
- Fehlergrund enthaelt `watchdog_timeout`.
- `GET /api/v1/runs/{run_id}/safety` zeigt `watchdog_fail_safe=true`.

## Test 2: Twin-Core hart stoppen
1. HIL-Run starten.
2. Twin-Container abrupt stoppen (`docker kill <container>`).
3. Erwartung:
- SPS reagiert identisch wie in Test 1 (Safe-State innerhalb Timeout).
- Incident wird im Testprotokoll dokumentiert.

## Incident-Protokoll (Pflichtfelder)
- `run_id`
- `scenario_id`
- Zeitpunkt der Unterbrechung (UTC)
- Adapter + Signal (NodeId/Register)
- Timeout-Parameter
- beobachtete Safe-State-Latenz
- Ergebnis Pass/Fail

## Monitoring/Checks
- `GET /api/v1/health` == 200
- `GET /api/v1/ready` == 200
- `watchdog_config_loaded=true` in Ready-Checks
- strukturierte Logs fuer `watchdog_tick_ok`, `watchdog_miss`, `watchdog_fail_safe`
