# Lokale Demo-Abnahme

Stand: 2026-10-02. macOS/Docker Desktop, lokale Demo ohne reale Hardware.

## Technische Checks

| Pruefung | Ergebnis |
| --- | --- |
| Backend-Tests | 67 bestanden, ein Starlette-Deprecation-Hinweis |
| Backend-Tests im versionsgebundenen Demo-Image | 67 bestanden; zusaetzlicher Cache-Hinweis wegen Read-only-Testmount |
| Frontend-Tests | 18 bestanden |
| ESLint / strikter Typecheck | erfolgreich |
| Vite-Produktionsbuild | erfolgreich, Chunk-Warnung >500 kB |
| Standard-npm-ci im frischen Node-22-Dockerbuild | erfolgreich |
| npm audit | 0 gemeldete Schwachstellen zum Pruefzeitpunkt |
| Archiv-SHA256-Manifeste | unveraendert |
| Neues Datenvolume / automatische Seeds | erfolgreich |
| UI/API gleicher Origin, Swagger und Runtime-Konfiguration | erreichbar |
| Grafana/Influx | Dashboard provisioniert, Refresh 10s, OTP-Frames aus neuen Runs |
| Prometheus | Scrapes antworten HTTP 200 |

Docker-Demo: Frontend 5176, Backend 8010, Grafana 3000. Der vorhandene fremde
Dienst auf Port 8000 blieb unveraendert. Die Demo erlaubt keinen stillen
API-Wechsel zu diesem Port. Backend-Abhaengigkeiten sind versioniert.

## Referenz-Smoke

`python3 scripts/smoke_demo.py --planner` wurde mit und ohne Monitoring
erfolgreich ausgefuehrt. Baseline, Guillotine und Schwarzstart erreichen
`completed`; Records enthalten KPIs und Artefakte. Beide Planner-Jobs liefern
Baseline/Empfehlung, modellintern gegengeprüfte KPIs, Deltas, terminale Validierungsrun-IDs und
`playbook.md`, `frontier.json`, `summary.csv`.

Beispielwerte aus der API bei Seed 42 und dem versionierten Referenzmodell:

| Fall | OTP % | Turnaround min | Gate-Auslastung % | Delay min |
| --- | --- | --- | --- | --- |
| Stability | 98.082517 | 45.023290 | 0.017713 | 1.023290 |
| Guillotine | 96.202248 | 46.498456 | 0.077074 | 2.498456 |
| Schwarzstart | 95.023743 | 48.066237 | 0.192713 | 4.066237 |

Diese Werte wurden in beiden Starts reproduziert, sind aber **keine**
Plausibilitaets-/Wirksamkeitsabnahme. Alle drei 60-Sekunden-Fenster runden
die fertig bearbeiteten Abfluege auf null. Bei den heutigen Schwellen ist
die Baseline bereits zulaessig; beide Planner empfehlen daher kostengemaess
keinen Eingriff, alle Deltas null. Das ist ein wichtiger fachlicher Befund,
kein Beleg einer wertvollen Airport-Optimierung.

## Echter Container-Neustart

Ein 8-Sekunden-Realtime-Demo-Run und ein 15-Sekunden-Playbook wurden gestartet.
Nach dem beobachteten Zustand `running` wurde nur der Demo-Backend-Container
mit einer Sekunde Grace Period neu gestartet. Beide Records erreichten
danach `completed` mit derselben ID, `recovery_count=1` und
`recovered_after_restart=true`.

Die Testdaten liegen nur im lokalen Docker-Volume. Aus ihnen werden keine
echten Betriebsdaten oder privaten Protokolle in das Repository uebernommen.

## Browser-Smoke

- Acht Cases und Disclaimer sichtbar; API-Pruefung erfolgreich.
- Guillotine und Schwarzstart ueber die sichtbaren Controls gestartet;
  Run-ID, KPI-Kurven und terminaler Status sichtbar.
- Keine relevanten Browser-Konsolenfehler im geprueften Ablauf.
- Mobile Breite 390px: Seitenbreite 390px, kein horizontaler Seitenueberlauf.
- HTML-Compare-/Forecast-Report wird zusaetzlich durch Frontend-Tests geprueft.
- Reale Schwarzstart-Synthese im Browser: `completed`, Baseline/Empfehlung,
  modellintern gegengeprüfte KPI-Deltas und Artefakt-/Validation-Run-Links sichtbar.

Nicht geprueft: Windows/Linux als Host, echte Adapter-Hardware, Produktiv-
Deployment, ein 100-Run-Realtime-Dauerlauf oder empirische Modellguete.
Timos eigener Rechner bleibt Teil des Pilots, nicht Teil dieser Abnahme.
