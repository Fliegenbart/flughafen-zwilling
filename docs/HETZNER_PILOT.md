# Geschuetzte Hetzner-Demo

## Fuer Timo

- [Airport Energy Check](https://labpulse.ai/airport/)
- [Muenchen-Referenzpilot](https://labpulse.ai/airport/?workspace=munich)
- [Separate FlexLab Workbench](https://labpulse.ai/airport/?workspace=flexlab)

Der Browser fragt nach Benutzername und Passwort (HTTP Basic Auth ueber HTTPS).
Zugangsdaten separat erhalten; nicht in einen Link, Git oder Reports schreiben.
Im Pilot teilen alle berechtigten Nutzer denselben Demo-Datenbereich. Das ist
**keine Mandantentrennung**. Nur synthetische Testdaten und oeffentliche
Flugplan-Snapshots verwenden, keine privaten FMG-/Lab-Messdaten hochladen.
Modellgrenzen gelten unveraendert. Im [gekoppelten Systemtest](MUNICH_COUPLED.md)
treiben manuell gewaehlte Planzeiten angenommene Fahrzeugauftraege, SOC und
Ladebedarfe. Das sind keine gemessenen FMG-Einsaetze oder reale Flug-OTP/TOBT.
Der separat erhaltene Energie-v1-Vergleich verwendet den Flugplan weiterhin
nur als Kontext (siehe `MUNICH_FLIGHTPLAN.md`). Kein automatischer Flugplanabruf.

Start: Flugplantag manuell importieren/auswaehlen, Annahmen und ungeklaerte
Mehrfachgruppen pruefen, dann **Gekoppelten Vergleich starten**. Referenztag und
Anschluss-Engpass in Energie-v1 bleiben separat verfuegbar. Airport bleibt
Standard. Backend arbeitet seriell; `queued` kann auf den vorherigen Run warten.
Grafana wird hier nicht angeboten. Kurven und Exporte liegen in der Anwendung.

## Isolierter Betrieb

`docker-compose.hetzner.yml`: eigener Compose-Projektname `airport-twin-pilot`,
eigenes Volume `airport-twin-pilot_pilot-data`, genau ein Backend-Prozess. Backend
hat keine veroeffentlichten Ports und nur ein internes Simulationsnetz
(fest `10.253.250.0/24`; uvicorn vertraut per `--proxy-headers
--forwarded-allow-ips` nur diesem Netz, der Frontend-nginx reicht `X-Real-IP`
des Host-Proxys durch, damit die Login-Drosselung je echter Client-IP greift). Frontend
ist nur am Host-Docker-Bridge-Interface auf Port 18576 gebunden, nicht am
oeffentlichen Interface. Keine HIL-Zusatzabhaengigkeiten, Hardware-/GPU-Mounts
oder Influx-Tokens. CPU/RAM/PID-Grenzen begrenzen den kleinen Demo-Stack.

Der bestehende HTTPS-Proxy integriert `deploy/hetzner/airport-route.inc` innerhalb
des `labpulse.ai`-Servers. Den dortigen **serverweiten** Redirect durch eine
`location / { return 301 https://fluxengine.labpulse.ai$request_uri; }` ersetzen;
dadurch bleiben alle Nicht-Airport-Pfade identisch weitergeleitet. Vorher Backup,
danach `nginx -t` und nur graceful Reload. Das Passwortfile liegt ausserhalb Git
unter `/etc/letsencrypt/airport-demo.htpasswd`, lesbar fuer den Nginx-Worker.

## Release und Ruecknahme

Hetzner-Ingress ist fest `10.253.251.0/24` mit Gateway `10.253.251.1`.
Auch dieses Netz muss vor Deployment gegen Docker-IPAM und Host-Routen geprueft
werden. Die separate `deploy/hetzner/frontend-nginx.conf` vertraut nur diesem
Gateway fuer `X-Real-IP`; der Host-Proxy ueberschreibt den Header weiterhin.
`scripts/smoke_proxy_chain.sh` prueft den realen Docker-DNAT-/Nginx-/Uvicorn-Pfad
in einem separaten Testprojekt mit tmpfs statt Betriebsvolume. Nur ausfuehren,
wenn beide Hetzner-Subnetze frei sind, niemals neben dem aktiven neuen Pilot.

Das Backend-Image setzt `TWIN_SCENARIO_LIBRARY_DIR=/opt/airport-seeds/scenarios`.
Die Bibliothek liest damit die acht unveraenderlichen Release-Seeds, nicht das
bearbeitbare Runtime-Volume. `sh scripts/smoke_container_library.sh` prueft das
gebaute Image isoliert per HTTP ohne Host-Quellcode, Ports oder persistente Daten;
der Test ist Teil der Backend-CI. Der lokale `smoke_pilot.py` erwartet fuer seine
modellabgeleiteten Labordaten ausdruecklich `NOT_EVALUABLE` / `lab_diagnostic`,
kein empirisches PASS; berechnete Fehlerwerte und ZIP-Hashes werden trotzdem geprueft.

Vor jedem Deploy Docker-IPAM, Host-Routen und Interface-Netze auf Ueberlappungen
mit `10.253.250.0/24` pruefen. Bei Kollision stoppen, nicht auf dem Server
abweichend konfigurieren. Am 05.10.2026 war dieses Ersatznetz konfliktfrei;
`172.31.250.0/24` kollidierte dagegen mit einem vorhandenen `172.31.0.0/16`.
Deshalb wurde Release `a025327` nicht deployt; aktiv blieb `b7e08cf`.
Subnetz und Uvicorn `--forwarded-allow-ips` muessen gemeinsam geaendert werden.
Nach CI/Freigabe einen neuen Remote-Commit deployen. Muss Compose das bestehende
Projektnetz ersetzen, ausschliesslich diesen Stack mit `down` **ohne `-v`**
anhalten und anschliessend neu starten. Datenvolume und Host-Proxy erhalten.

Server-Checkout: `/opt/airport-twin-pilot`. Ausschliesslich gepruefte Remote-SHAs
deployen. Keine lokalen Laufzeitdaten kopieren, keine GitHub-Schluessel uebertragen.

```sh
cd /opt/airport-twin-pilot
export TWIN_BUILD_GIT_COMMIT=$(git rev-parse HEAD)
docker compose -f docker-compose.hetzner.yml up --build -d
docker compose -f docker-compose.hetzner.yml ps
docker compose -f docker-compose.hetzner.yml logs --tail=80 twin-core frontend
```

Vor spaeteren Upgrades Backend anhalten und Volume konsistent sichern. Rollback
auf einen kompatiblen Release-Commit; aktuelle Daten nicht blind mit alten Daten
ersetzen. Nicht `down -v`, keine andere Compose-Installation stoppen. Zugangsschutz
auch bei Ruecknahme erhalten; fehlende Demo darf 502, aber nie ungeschuetzt sein.

```sh
python3 scripts/smoke_munich.py --base-url https://labpulse.ai/airport --auth-file /private/path/demo.netrc
python3 scripts/smoke_demo.py --base-url https://labpulse.ai/airport --auth-file /private/path/demo.netrc --planner --all-cases
python3 scripts/smoke_flexlab.py --base-url https://labpulse.ai/airport --auth-file /private/path/demo.netrc
python3 scripts/smoke_flightplan.py --pdf /private/path/flugplan.pdf --date 2026-10-03 --compare --base-url https://labpulse.ai/airport --auth-file /private/path/demo.netrc
python3 scripts/smoke_coupled.py --snapshot-id STORED_SNAPSHOT_ID --output-dir /private/path/coupled-evidence --base-url https://labpulse.ai/airport --auth-file /private/path/demo.netrc
```

Der Kopplungs-Smoke verwendet ausschliesslich einen bereits importierten
Snapshot. Bei ungeklaerten Mehrfachgruppen nur nach bewusster Entscheidung
`--accept-independent-entries` ergaenzen; keine bestaetigte Zahl physischer Fluege.

Netrc-Datei: Modus 0600, Host/Login/Passwort ausserhalb Git. Smoke-Helper sendet
Zugangsdaten nur nach Challenge und lehnt Redirects ausserhalb dieses HTTPS-
Pilotpfads ab. Vor Freigabe unauthentifiziert 401 fuer UI/API/Artefakte pruefen.
HTTP ohne TLS darf nur umleiten, nie Zugangsdaten abfragen oder Inhalte liefern.

## Aktiver Release vom 05.10.2026

Aktiv ist der gepruefte Remote-Commit
`5210afed5534ba9e2f87e948275da8fbda558f19` aus `codex/recovery-audit`.
[Release-CI 37343048997](https://github.com/Fliegenbart/flughafen-zwilling/actions/runs/37343048997)
ist erfolgreich. Release-Worktree: `/opt/airport-releases/5210afe`;
`/opt/airport-twin-pilot` wurde nach bestandener Abnahme auf denselben Commit
vorgezogen. Keine lokalen Codeaenderungen auf dem Server.

Offline-Sicherung nach Backend-Stopp:
- Archiv: `/opt/airport-backups/pre-5210afe-20261005.tar.gz`
- 912 Dateien; Modus `0600`.
- SHA256: `17db5a6b90f9872ecda8848a18fe81b00770ac465f27e6cc771581b6f00541b1`
- Wiederherstellung separat unter
  `/opt/airport-backups/verify-pre-5210afe-20261005` geprueft,
  einschliesslich Manifest, Datei-Hashes und SQLite-Pruefungen.
  Das Betriebsvolume wurde nicht ersetzt.

Docker-IPAM und Host-Routen waren fuer beide Netze `10.253.250.0/24`
(internes Simulationsnetz) und `10.253.251.0/24` (Ingress) konfliktfrei.
Genau ein Uvicorn-Prozess mit `--workers 1`, `--proxy-headers` und
`--forwarded-allow-ips 10.253.250.0/24` ist aktiv. Frontend-Port 18576 bleibt
an `172.17.0.1` gebunden. Basic Auth und Host-Proxy blieben erhalten; keine
anderen Stacks, Hardwareadapter oder Influx-Tokens wurden eingebunden.

### Abnahme am Live-Release

| Pruefung | Ergebnis |
| --- | --- |
| Ohne Login: UI, API, Run-Artefakt | Bestanden: jeweils HTTP 401 |
| HTTP ohne TLS | Bestanden: 301 ausschliesslich auf HTTPS |
| Health/Readiness und Runtime-Commit | Bestanden; Backend healthy/ready, Commit wie oben |
| `smoke_munich.py` | Bestanden: vier Referenzfaelle |
| `smoke_demo.py --planner --all-cases` | Bestanden: Baseline, acht Cases, beide Planner terminal |
| `smoke_flexlab.py` | Bestanden, inklusive negativer Daten und Abbruch |
| `smoke_coupled.py` | Bestanden: zwei terminale Runs, Safety und Artefakt-Hashes |
| `smoke_pilot.py` | Bestanden: Import, Replay, negative Daten, ZIP-Hashes |
| Exchange whoami, Projekt overview/situation | Bestanden: jeweils HTTP 200 |
| Szenario-Bibliothek | Bestanden: HTTP 200, genau acht Cases |
| Live-Browser in angemeldetem Safari | Bestanden: Startseite Airport Energy Check und alle drei alten Workspace-Weiterleitungen |
| Fonts und Konsole | Bestanden: alle 33 Fontdateien HTTP 200 mit Fontsignatur; Airport-Konsole ohne CSP-Fehler |
| Bestand | Bestanden: alle zuvor vorhandenen 126 Run-IDs, ein Projekt und ein Snapshot erhalten; abgeschlossener v1-Run lesbar |
| Additive Migration | Bestanden: SQLite `quick_check=ok`; Exchange-, Rollen-, Toleranz- und Variantentabellen vorhanden |
| Backend-Logs | Keine ERROR-, Traceback-, OperationalError- oder DatabaseError-Treffer in den geprueften Release-Logs |
| Client-IP am Backend | Bestanden: echte oeffentliche Client-IP statt Docker-Gateway im Login-Probe-Log |

Die persoenliche App-Anmeldung bleibt in dieser geteilten Demo deaktiviert.
Der einzelne Probeaufruf mit nicht existierendem Benutzer liefert erwartungsgemaess
`404 auth_disabled`; die eigentliche Login-Drosselung/429-Schwelle wurde deshalb
**nicht getestet**. Die Proxy-IP-Kette wurde zusaetzlich im isolierten Container-
Smoke geprueft. Externer Basic-Auth-Schutz ist davon unabhaengig weiterhin aktiv.

`smoke_pilot.py` hat keine Basic-Auth-Option und lief ausschliesslich ueber einen
anschliessend geschlossenen SSH-Localforward auf den hostgebundenen Port 18576.
Die anderen vier Smokes liefen mit privater Netrc ueber geschuetztes HTTPS.
Pilot-Replay `278bd0b4-7dba-4485-9f0e-7dfdd04f9d3f` ergibt fuer synthetische,
modellabgeleitete Labordaten korrekt `NOT_EVALUABLE` / `lab_diagnostic`;
ungueltige Daten ebenfalls `NOT_EVALUABLE`. Kein empirisches PASS.

Gekoppelter Vergleich `afa20800c7104ac481f26d801b3f3785` verwendet den bereits
vorhandenen oeffentlichen Flugplan-Snapshot mit expliziter Independent-Entries-
Annahme. Runs `5b2ef1f5ea2a4992b38abd50de973d5b` und
`0af359dfdeb0467bb76b00ac6822328f` sind abgeschlossen und hashgeprueft.
Beide erreichen 21,49 Prozent modellierte Abflugbereitschaft; strenge
Modellkriterien bleiben `false`. Die Planner-Gegenproben weisen keinen
Optimierungsvorteil nach. SIL-Abnahme ist keine empirische Modellvalidierung.

Vor diesem erfolgreichen Release wurden `b749a39` (leere Container-Bibliothek)
und `3b5d3df` (Docker-Gateway statt Client-IP) jeweils auf `b7e08cf`
zurueckgenommen. PR #18 behebt die Image-Bibliothek und ergaenzt einen
Container-Smoke; PR #19 behebt die vollstaendige Ingress-Proxy-Kette mit
eigenem Docker-Smoke. Beide Korrekturen sind im aktiven Remote-Commit enthalten.
Rollback-Ziel bleibt `/opt/airport-releases/b7e08cf`; Backend vorher stoppen,
alten Release bauen/starten. Daten nur bei nachgewiesener Beschaedigung aus der
Sicherung zurueckspielen; additive Tabellen allein sind kein Restore-Grund.

## Historischer Release vom 04.10.2026

Code-Release `b7e08cf625af042bf062154560bc3bc6802845ce` aus
`codex/airport-pilot-studio` (PR #12) ist auf Hetzner aktiviert.
Server-Checkout: `/opt/airport-twin-pilot`; der aktive Compose-Stack wurde aus
dem unveraenderten Release-Worktree `/opt/airport-releases/b7e08cf` gebaut.
Beide Checkouts enthalten denselben Code-Commit. Der lokale Arbeitsbereich ist
`/Users/davidwegener/Desktop/TestingLab/DigitalerZwillingBundeswehr`.

Vor dem Wechsel wurde das Backend gestoppt und das vorhandene Datenvolume
offline gesichert (605 Dateien, Archivmodus 0600). Die hashgepruefte
Wiederherstellung in ein separates Verzeichnis war erfolgreich. Datenvolume,
HTTPS-Proxy, bestehender Basic-Auth-Zugang und andere Anwendungen blieben
erhalten. Alte App-Images sind als `rollback-c16a514` vorhanden. Keine lokalen
Betriebsdaten oder unversionierten Dateikopien wurden uebertragen.

Verifiziert am aktiven Release:
- Ein Backend-Prozess, Health/Readiness erfolgreich, Execution-Commit geprueft.
- Geschuetzte HTTPS-Assets und neue Pilot-Endpunkte erreichbar; ohne Login
  liefern UI, Readiness und Pilot-Projekte weiterhin HTTP 401.
- Vier Energie-Vergleiche mit Export-/Auditpruefung; FlexLab inklusive
  erwarteter FAIL-/INCONCLUSIVE- und Abbruchfaelle erfolgreich geprueft.
- Gekoppelter Vergleich `a556fa82f92b4e2fb07a2373f02d9973`: beide Runs
  abgeschlossen, gleicher Welt-Hash, Daten-/Report-Pruefsummen verifiziert.
  Beide Laderegeln erreichen 21,49 % modellierte Abflugbereitschaft; strenge
  Modellkriterien bleiben `false`. Kein Optimierungsvorteil nachgewiesen.
- Neuer Pilot-Workflow im laufenden Container mit synthetischen Testdaten:
  Import, Run-Replay, Bewertung und ZIP-Hashes erfolgreich; ungueltige Daten
  ergeben `NOT_EVALUABLE`. Das ist keine empirische Modellvalidierung.

Die Browser-Sichtpruefung des lokalen identischen Codes erfolgte vor dem
Release. Eine erneute Live-Browserpruefung war wegen des Basic-Auth-Dialogs im
integrierten Browser nicht moeglich; die Live-Gegenproben erfolgten authentifiziert
ueber HTTPS sowie fuer den neuen Replay-Workflow direkt im laufenden Container.

Die neue optionale persoenliche Anmeldung ist auf dieser geteilten Demo
**nicht aktiviert**. Der bisherige Proxy-Passwortschutz bleibt wirksam.
Weiterhin keine privaten Kundendaten hochladen; fuer einen Kundenpilot eine
separate Instanz und persoenliche Accounts gemaess `PILOT_OPERATIONS.md` nutzen.

Fuer eine Code-Uebergabe zuerst `AGENTS.md`, `PILOT_STUDIO.md`,
`PRODUCT_READINESS.md` und `MUNICH_COUPLED.md` lesen. Neue Oberflaechen liegen
unter `src/munich/` und `src/pilot/`, Backend unter `backend/app/munich/` und
`backend/app/pilot/`. Keine Secrets oder Runtime-Volumes an Review-Tools geben.

## Historischer Release vom 03.10.2026

Code-Release `c16a514ef715e31703baace439abd36c7b5f080b`, gepruefter PR #9,
auf dem bestehenden isolierten Pilot aktiviert. Eigenes Datenvolume vorher
konsistent privat gesichert; alte App-Images als Rollback behalten. Zugangsschutz,
Proxy und andere Anwendungen wurden nicht veraendert.

HTTPS-Gegenproben: alle acht Airport-Cases plus Baseline, beide Planner-Referenzen,
vier Energie-v1-Vergleiche und FlexLab inklusive negativer Daten-/Fehlerfaelle.
Der gespeicherte oeffentliche Flugplantag 03.10.2026 liefert zwei abgeschlossene
Kopplungsruns mit verifiziertem Execution-Commit, gleichem Welt-Hash und allen
sieben Daten-/JSON-/PDF-Hashes; bestehende Runs behalten ihren expliziten v1-Audit.
13,83 Sekunden inklusive HTTPS und Downloads fuer diese Gegenprobe, kein SLA.
HTML/Muenchen-JS/CSS sind bytegleich zum geprueften Subpath-Build. Ohne Login
antworten UI, API und Artefakte mit 401; HTTP leitet nur auf HTTPS um.

2.144 angenommene Auftraege und 98/456 rechtzeitige modellierte Abflugseintraege
bei beiden Laderegeln. Kein Optimierungsvorteil und keine reale Flughafen-OTP
nachgewiesen. Technisch `completed`, strenge Modellkriterien weiterhin `false`.

Dies ist eine kleine passwortgeschuetzte Demo, kein Mehrnutzer-Produkt: kein
Rollenmodell, kein SLA, keine datenbezogene Mandantentrennung oder globale
Speicherquote. Vor Dauerbetrieb Backup-/Aufbewahrung, Benutzerverwaltung und
Lab-Freigabe separat festlegen. Abgestimmte echte Hardwareversuche sind weiterhin
nicht enthalten.
