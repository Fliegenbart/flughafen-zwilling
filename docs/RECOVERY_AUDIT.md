# Wiederherstellung und Codepruefung

Pruefdatum: 2026-10-02, Europe/Berlin.

## Ergebnis und Provenienz

**Kein kompletter Neubau erforderlich.** Die aktive Airport-Implementierung
ist wiederhergestellt; UI, Simulator, acht Cases, Worker, Playbook-Vergleich,
Forecast und Observability liegen wieder als Quellen im Repository.

Der urspruengliche lokale Checkout fehlte. Die GitHub-Quelle
`Fliegenbart/digitalerzwilling`, Commit
`bd5782493e5a2d038af4566fdf7debce5ea1b4c2`, enthielt nur den alten EMS-Stand.
Dieser ist unveraendert unter `legacy/ems_baseline/` archiviert.

Die anschliessende Wiederherstellung nutzte die erhaltenen historischen
Quellcode-Aenderungen dieses Chats bis 2026-03-17: 126 erfolgreiche Patches,
19 explizite Dateischreibvorgaenge und eine Simulator-Kopie, insgesamt
146 Replay-Schritte auf den Original-Snapshot. Es wurden nur passende
Projektpfade und bekannte Quellcode-Operationen verarbeitet, keine beliebigen
historischen Shellbefehle ausgefuehrt.

Ein alter temporaerer Smoke-Seed `realtime_smoke_1s.json` war nicht vorhanden;
seine spaetere Ein-Zeilen-Aenderung konnte nicht angewendet werden. Die acht
Airport-Seeds und Baseline sind vorhanden und werden validiert. Generierte
Builddateien wurden nicht wiederhergestellt. Die urspruenglichen automatisch
installierten Fonts mussten im Manifest nachgetragen werden.

Aus dem alten Grafana-Volume wurde nur das Airport-Dashboard schreibgeschuetzt
exportiert: `legacy/airport_grafana/`. Keine Datenbank, Sitzungen, privaten
Gespraeche, Secrets oder Influx-Betriebsdaten werden veroeffentlicht.
Die SHA256-Manifeste sichern beide unveraenderten Archivsnapshots.

## Wichtigste aktive Befunde

### P1: Flughafenmodell ist unkalibriert und fachlich stark vereinfacht

`backend/app/simulators/airport_turnaround.py` ist ein aggregiertes
Kapazitaetsmodell. Es startet mit leeren Queues und bearbeitet fraktionale
Fluege. Turnaround-Durchsatz kann im selben Tick entstehen: Es gibt keine
flugbezogene Mindest-Verweilzeit von beispielsweise 45 Minuten.

Turnaround und OTP werden aus Druck-/Delay-Formeln berechnet, nicht aus
Flugplan, individuellen Abflugzeiten oder empirischen Prozessverteilungen.
Ein 60-Sekunden-Seed bei 24 Abfluegen/Stunde kann deshalb weniger als einen
Abflug und extrem geringe Gate-Belegung liefern. Die Zeitskala ist derzeit
keine komprimierte Betriebsstunde.

Konsequenz: technische Demo und Methodenpilot, keine valide
Flughafenprognose. Vor echten Schlussfolgerungen: Zeitmodell definieren,
Warm-start/Dwell-Time oder Flugentitaeten einbauen, dann an Referenzdaten
gegen eine festgelegte Kontrollmethode validieren. UI und Anleitung weisen
auf den unkalibrierten Stand hin.

### P1: Telemetriefehler konnte die einzige Run-Queue blockieren; behoben

Der historische Consumer erreichte bei einem Callback-Fehler `task_done()`
nicht; `Queue.join()` wartete endlos. Der Fehler wurde in beiden aktiven
Simulatoren mit einem Regressionstest reproduziert.

Jetzt garantiert der Consumer `task_done()`, meldet Callback-Fehler an den
Run und beendet das Warten auf den Telemetriethread begrenzt. Die
parametrisierten Tests bestehen fuer Airport und den Kompatibilitaets-
Simulator. Ein beliebiger dauerhaft blockierender externer Callback kann
nicht gewaltsam beendet werden; Python-Threads sind kein Prozess-Sandboxing.

### P1: Frischer Frontend-Install und Backend-Packaging; behoben

Das historische Lockfile kombinierte inkompatible Peer-Versionen und fehlende
Font-Pakete. Der aktive Satz verwendet Vite 7, React-Plugin 5, Vitest 4,
ESLint 8 mit passendem React-Refresh-Plugin und lokale Fontsource-Pakete.
Standard-`npm ci` wird im Docker-Build ohne Peer-Workaround ausgefuehrt.
Die aktiven Tests sind auf `src/` begrenzt, damit das Archiv nicht als zweites
React-Projekt getestet wird. Report-APIs werden fuer jsdom explizit gemockt.

Setuptools findet nun auch `app.simulators`; zuvor fehlte das Subpackage
im installierten Wheel. Das Demo-Image enthaelt die Seeds und initialisiert
neue Datenvolumes automatisch, ohne bestehende Daten zu ueberschreiben.

### P2: Prototyp-Betrieb ist bewusst lokal

Keine API-Authentifizierung und keine Multi-Prozess-Koordination. Ein
Backend-Prozess, ein aktiver Run und ein Playbook-Worker sind die
unterstuetzte Betriebsweise. Docker bindet die Demo nur an localhost.
Keine reale Adapter-/Hardware-Abnahme oder produktive Sicherheitsfreigabe.

`telemetry_stream_enabled` bestaetigt nur einen konfigurierten Influx-Token,
nicht die erfolgreiche Zustellung aller Samples. Empfohlene Kosten sind
Demo-Punkte, keine EUR-Kosten. Die SIL-Validierung verwendet denselben
Simulator wie die Suche und ist keine unabhaengige empirische Evidenz.

### P2: Wartbarkeit und groessere Frontend-Bundles

`src/App.tsx` kombiniert UI, REST, State-Mapping und HTML-Reporting und
unterdrueckt einzelne TypeScript-ESLint-Regeln. Der Produktionsbuild warnt
ueber einen JS-Chunk >500 kB. Naechster technischer Schritt nach dem Pilot:
API-/Planner-/Report-Module trennen und Chart-Code bedarfsgerecht laden.
Die strikte TypeScript-Pruefung wurde repariert und als CI-Gate hinzugefuegt.
Bestehende Tests allein pruefen keine
fachliche Modellguete.

## Verifikation des aktiven Stands

- Backend: 67 Tests bestanden, inkl. zwei neuer Telemetrie-Fehler-Regressionen.
- Frontend: 18 Tests bestanden; Lint, Typecheck und Build erfolgreich.
- Die Demo bleibt auf ihrem konfigurierten API-Origin: kein automatischer
  Wechsel zu einem fremden lokalen Dienst auf Port 8000. Regressionstest vorhanden.
- Abhaengigkeiten: npm audit ohne gemeldete Schwachstellen zum Pruefzeitpunkt.
- Archiv-Checksummen: beide Snapshots unveraendert.
- Docker-Frontend-Build: frisches Standard-npm-ci, kein legacy-peer-deps.
- Demo-Backend-Abhaengigkeiten sind in requirements-demo.txt versioniert.
- Referenz-Smoke und Recovery: Ergebnisse werden nach den lokalen
  Docker-Pruefungen in `docs/DEMO_VERIFICATION.md` festgehalten.

Ein Starlette-Testclient-Deprecation-Hinweis und die Bundle-Warnung bleiben.
Der urspruengliche Archivstand hatte separat 41 Backend-Tests, einen
Frontend-Smoke und 12 Lint-Fehler; diese Befunde gelten nicht fuer die
wiederhergestellte aktive Airport-Version.

## Prioritaet nach Timos Pilot

1. Mit Timo die reale Testfrage und eine sinnvolle Kontrollmethode festlegen.
2. Zeitmodell und Ressourcen-/Turnaround-Dynamik fachlich korrigieren.
3. Simulator gegen Referenzmessungen kalibrieren und unabhaengig validieren.
4. Erst danach E.ON-Energiekopplung oder weitere Optimierungsfeatures bauen.
