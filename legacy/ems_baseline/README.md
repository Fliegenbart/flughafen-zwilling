# Digitaler Zwilling Bundeswehr - Hybrid HIL Deployment

Dieses Repository ist auf **Hybrid-HIL** ausgelegt:

- Backend/Twin-Core API auf dem Lab-Server (Docker Compose)
- Operator-UI auf Vercel (Vite/React)

## Was ist das?

Dieses Projekt ist ein digitaler Zwilling fuer ein Kasernen-Energy-Management-System (EMS) mit Fokus auf Stabilitaet, Resilienz und reproduzierbare HIL/SIL-Testkampagnen.

Die Architektur trennt bewusst:

- harten Regelbetrieb auf SPS/RTU
- Soft-Real-Time-Orchestrierung, Szenarien und Auswertung im Python-Twin-Core

## Was kann das Programm heute?

- deterministische Simulationslaeufe (gleicher Seed -> gleiches Ergebnis)
- Szenario-, Modellpaket- und Run-Orchestrierung via API
- Adapter-Layer fuer Modbus/OPC UA/MQTT (sim und live)
- Watchdog-/Dead-Man-Switch-Mechanik im Adapterpfad
- Safety-Endpunkt mit Watchdog- und Timing-Zusammenfassung
- Tick-Drift-Metriken (`avg`, `max`, `p99`) fuer Jitter-Transparenz
- Audit-Fingerprint (SHA-256) ueber Eingaben + Telemetrie
- Artefakte pro Run: `run.json`, `telemetry.jsonl`, `report.json`, `report.pdf`
- CSV-Export fuer Engineering-Tools
- Frontend Operator-Console mit lokalem Sim-Modus und Backend-Run-Modus

## Was ist noch zu tun fuer echte Hardware im TestingLab?

Vor produktivem HIL-Betrieb mit echter Hardware muessen diese Punkte abgeschlossen und abgenommen sein:

1. Live-Mapping finalisieren:
- echtes Tag-/Register-Mapping fuer OPC UA/Modbus je Testaufbau
- Endpoint- und Timeout-Parameter pro Adapter verbindlich dokumentieren

2. SPS-Safe-State verifizieren:
- SPS muss bei Watchdog-Timeout hart in Safe-State gehen
- Testnachweis: Kabelzug-/Container-Kill-Run gemaess Runbook

3. Netz- und Sicherheitszonen scharf schalten:
- Reverse Proxy + TLS Zertifikate produktiv
- IP-Allowlist mit realen Lab-/Office-Ranges
- nur Port 443 inbound, App-Port nicht direkt oeffentlich

4. Stufenrollout einhalten:
- Gate A: 100 sim-basierte Laeufe ohne Run-Verlust
- Gate B: Live-Preflight mit echten Endpunkten
- Gate C: begrenzter Live-Pilot mit taeglichem Review

5. Operative Abnahme vorbereiten:
- Runbook und Incident-Prozess im Team einueben
- Referenzszenarien als versionierte Baseline einfrieren
- Abnahmebericht mit Safety-, Audit- und Timing-Metriken erzeugen

## Struktur

- `backend/` FastAPI Twin-Core Service
- `hil-stage1.jsx` Operator Console Hauptkomponente
- `docker-compose.yml` Lab-Server Deployment
- `deploy/nginx/api-twin.conf` Nginx Reverse-Proxy mit IP-Allowlist
- `deploy/caddy/Caddyfile` Caddy-Alternative
- `deploy/firewall/ufw-rules.sh` Firewall-Baseline
- `deploy/checks/cors-smoke.sh` CORS Smoke-Check

## 1) Lab-Server starten

```bash
cp .env.example .env
# .env anpassen (Origins und ggf. Data Dir)

mkdir -p /srv/twin/data
docker compose build
docker compose up -d
```

API sollte lokal nur über Loopback erreichbar sein (`127.0.0.1:8000`).

## 2) Reverse Proxy + TLS

1. Nginx-Konfiguration aus `deploy/nginx/api-twin.conf` übernehmen.
2. Zertifikat für `api-twin.<deine-domain>` einrichten.
3. IP-Allowlist mit echten Office/Lab-Egress-IP-Ranges ersetzen.
4. App-Port `8000` nicht öffentlich freigeben.

## 3) UI lokal testen

```bash
npm install
npm run dev
```

Optionale API-Basis-URL:

```bash
VITE_TWIN_API_BASE_URL=https://api-twin.example.com npm run dev
```

Alternativ über Runtime-Datei (`public/runtime-config.js`) mit:

```js
window.__TWIN_CONFIG__ = { apiBaseUrl: "https://api-twin.example.com" };
```

## 4) UI auf Vercel deployen

Preview-Deploy:

```bash
npm run deploy:preview
```

In Vercel Environment Variables setzen:

- `VITE_TWIN_API_BASE_URL=https://api-twin.<deine-domain>`

## 5) Betriebschecks

```bash
curl https://api-twin.<deine-domain>/api/v1/health
curl https://api-twin.<deine-domain>/api/v1/ready
curl https://api-twin.<deine-domain>/api/v1/runs/<run_id>/safety
./deploy/checks/cors-smoke.sh https://api-twin.<deine-domain> https://<deine-vercel-domain>
```

## 6) Gate A Stabilitätstest (sim)

```bash
cd backend
python scripts/gate_a_sim_runs.py --base-url https://api-twin.<deine-domain> --runs 100
```

## Wichtige Defaults dieser Phase

- Single instance
- Uvicorn `--workers 1`
- FileStorage auf `/srv/twin/data`
- Keine API-Auth (Absicherung durch TLS + IP-Allowlist + CORS)
- Adapter-Rollout stufenweise (`sim://` zuerst, Live-Adapter nach Gate)

## Phase-1 Hardening (OT + Audit)

- CSV-Export API: `GET /api/v1/runs/{run_id}/telemetry.csv`
- Safety-API: `GET /api/v1/runs/{run_id}/safety`
- Audit-Fingerprint (SHA-256) in `RunSummary` + PDF-Report
- Tick-Drift-Metriken (`avg`, `max`, `p99`) in Summary/Report
- Watchdog-Zusammenfassung in Run-Record/Safety-API

Dokumente:

- `/Users/davidwegener/Desktop/TestingLab/DigitalerZwillingBundeswehr/docs/OT_SAFETY_RUNBOOK.md`
- `/Users/davidwegener/Desktop/TestingLab/DigitalerZwillingBundeswehr/docs/COMTRADE_ROADMAP.md`
