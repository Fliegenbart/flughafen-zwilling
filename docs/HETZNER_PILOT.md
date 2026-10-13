# Hetzner-Demo

## Aktiver Release vom 13.10.2026 (interaktive Flughafen-Simulation)

Aktiv ist `b1ad776b405f10f7f23eea00b4bad0bfe8b59c8a` aus
`codex/airport-simulation-entry` (PR #34), gebaut aus dem unveraenderten
Remote-Commit in `/opt/airport-releases/b1ad776`. Vorher aktiv war
`78a6bab5b664b9b08b131fd1d65735db14a3cd50`. Der kanonische Checkout ist nicht
die Quelle des laufenden Stacks; massgeblich sind Release-Worktree und
`TWIN_BUILD_GIT_COMMIT` im Container.

Neu: verstaendlicher Einstieg, vier Stellschrauben mit serverseitiger gekoppelter
Simulation, Ausgangslage/Variante, Berechnungs-ID sowie HTML-/JSON-Pruefskizze.
Illustrationen und vorlaeufige Netz-Naeherungen sind von fertigen Berechnungen
getrennt. Die Eingaben des Demonstrationstags sind synthetisch und unkalibriert.
Keine Hardwarewrites, keine echten Adapter und kein Influx-Token.

Vor dem Wechsel wurde nur das Airport-Backend gestoppt. Offline-Sicherung:

- Archiv: `/opt/airport-backups/pre-b1ad776-20261013.tar.gz`
- 1.640 Dateien, 24.321.720 Bytes, Modus 0600
- SHA256: `700f48bc925a0ddc8b77f4228dec69286fed7ec1fe462423afbf49184b37fc6b`
- Separat hashgeprueft wiederhergestellt; temporaere Pruefkopie danach entfernt.

Abnahme bestanden:

- Lokal 175 Frontend- und 304 Backend-Tests; Lint, Typecheck, Builds und
  unveraenderte Archivsnapshots. GitHub-CI auf Release-SHA gruen
  (Run `38374940370`, inklusive Containerbibliothek und Proxykette).
- Oeffentliche HTTPS-UI, Health, Readiness, Rollen- und Szenariobibliothek: 200.
  HTTP leitet mit 301 auf HTTPS um. Der ausdruecklich freigegebene oeffentliche
  Demo-Zugang bleibt bestehen; Proxydatei unveraendert.
- `smoke_public_simulation.py`: reproduzierbare Baseline und vier neu berechnete
  Varianten; keine Projektwrites. Gemessene Variantenrechnung rund 1,0 bis 1,5 s
  in diesem Lauf, kein SLA.
- `smoke_munich.py`, `smoke_demo.py --planner --all-cases`,
  `smoke_flexlab.py`: bestanden, einschliesslich erwarteter negativer Prueffaelle.
- `smoke_coupled.py` auf vorhandenem synthetischen Snapshot: beide Laeufe samt
  Artefakten geprueft, Vergleich `936d317f96194bed99772c597b619a9e`.
  Beide Laderegeln erreichen 24,52 % modellierte Abfertigungsbereitschaft;
  strenge Modellkriterien bleiben false. Kein Optimierungsvorteil belegt.
- `smoke_pilot.py` lokal im Backend-Container (Skript erlaubt nur localhost):
  Paket-Hashes geprueft, modellabgeleitete und schlechte Daten bleiben
  `NOT_EVALUABLE`; keine empirische Validierung.
- Browser live: Start-CTA, Netzregler, vorlaeufige Anzeige, Serverergebnis,
  Berechnungs-ID und Zuruecksetzen geprueft; Exporte waehrend Rechnung gesperrt.
  Fonts geladen, keine Browserfehler. HTML-Download lokal geprueft;
  responsive Ansicht lokal bei 390 px ohne Inhaltsueberlauf.
- Bestand: alle zuvor vorhandenen vier Projekte, zwei Flugplan-Snapshots und
  228 Laeufe weiterhin vorhanden. Smokes ergaenzen synthetische QA-Daten.
- Ein Backend-Prozess, gesund, keine Neustarts und keine Fehler/Tracebacks in
  der kontrollierten Start-/Abnahmephase. Beide bestehenden Airport-Subnetze
  `10.253.250.0/24` und `10.253.251.0/24` konfliktfrei; andere Stacks unberuehrt.

Rollback: Backend stoppen und aus `/opt/airport-releases/78a6bab` mit dessen
Build-SHA `up --build -d` starten. Keine Volumes loeschen; Daten nur bei
nachgewiesener Beschaedigung zurueckspielen. Oeffentlichen Proxy unveraendert
lassen, sofern der Betreiber keinen neuen Zugangsschutz anordnet.

## Oeffentliche Demo seit 13.10.2026

Auf ausdruecklichen Betreiberwunsch ist `/airport/` einschliesslich API und
Bedienung ohne Passwort erreichbar. `deploy/hetzner/airport-route.inc` setzt
dafuer `auth_basic off`. Alle Besucher teilen den Demo-Datenbereich und koennen
die angebotenen Aktionen ausfuehren. Keine privaten Kunden- oder Labordaten
hochladen. HTTPS, Anfrage-Limits, Upload-Limit und noindex bleiben erhalten;
noindex ist kein Zugriffsschutz. Andere Host-Routen bleiben unveraendert.

Die folgenden historischen Release-Abnahmen mit HTTP 401 dokumentieren den
damaligen geschuetzten Zustand, nicht den aktuellen oeffentlichen Betrieb.
Zur Ruecknahme die privat gesicherte Airport-Proxydatei wiederherstellen,
`nginx -t` pruefen und den Proxy graceful neu laden.

## Fuer Timo

- [Airport Twin Core](https://labpulse.ai/airport/)
- [Muenchen-Referenzpilot](https://labpulse.ai/airport/?workspace=munich)
- [Separate FlexLab Workbench](https://labpulse.ai/airport/?workspace=flexlab)

Der Browser benoetigt fuer diese oeffentliche Demo kein Passwort.
Im Pilot teilen alle Besucher denselben Demo-Datenbereich. Das ist
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

## Aufbewahrung auf dem Server

Nach jedem Deploy, sobald die neue Version geprueft ist:

- Entpackte Pruefkopien `/opt/airport-backups/verify-pre-*` loeschen; sie dienen nur dem
  Hash-Vergleich direkt nach der Sicherung.
- Sicherungen `pre-*.tar.gz` und Release-Worktrees `/opt/airport-releases/<sha>` der letzten
  fuenf Releases behalten, aeltere entfernen (`git worktree remove`, nie das aktive Release).
- Smoke-Images (`airport-proxy-smoke-*`, `airport-library-smoke`) und alte Image-Tags
  entfernen. Rollback erfolgt ueber den Release-Worktree und `up --build`, nicht ueber Tags.

Stand 08.10.2026 nach dem ersten Aufraeumen: Sicherungen 90 MB statt 2,5 GB, Releases 27 MB.

## Aktiver Release vom 08.10.2026 (Arbeitsbildschirm)

Code-Release `78a6bab5b664b9b08b131fd1d65735db14a3cd50` (PR #30) ist aktiv, gebaut aus
`/opt/airport-releases/78a6bab`; vorher `27b3850`. Keine Netz- oder Compose-Aenderung.
Datenvolume vorher offline gesichert (`pre-78a6bab-20261008.tar.gz`, 1.500 Dateien,
hashgleich wiederhergestellt). 401 ohne Login, Smokes ueber die Host-Bridge gruen.

Neu: Arbeitsbildschirm unter `?projekt=<id>&ansicht=neu` und `POST /situation/preview`.
Fuer die Vorfuehrung angelegt: Projekt "Testtag Vorfeld (synthetisch)"
(`d7c0aede-4e70-4275-8085-3cb44272d540`) mit synthetischem Flugplan (310 Abfluege).
Gemessene Vorschau auf dem Server: rund 0,8 s Rechnung, rund 1 s mit Netzweg (lokal 0,3 s);
Backend laeuft mit `cpus: 1.0` auf einem ausgelasteten Host.

## Release vom 07.10.2026 (Texte)

Code-Release `27b385046eb84e17b6ba3b446afc1ee868d3eacf` aus `codex/recovery-audit` (PR #26,
neue Texte nach `docs/TEXTLEITFADEN.md`) ist aktiv, gebaut aus `/opt/airport-releases/27b3850`.
Vorher aktiv: `31a12b2`. Keine Netz- oder Compose-Aenderung. Datenvolume vorher offline
gesichert (`/opt/airport-backups/pre-27b3850-20261007.tar.gz`, 1.360 Dateien, hashgleich
wiederhergestellt). Verifiziert: Execution-Commit, Readiness, 401 ohne Login fuer
UI/API/Assets/Lab-Raum, HTTP nur Umleitung, neue Texte im Bundle, `smoke_munich.py`,
`smoke_demo.py --planner --all-cases` und `smoke_flexlab.py` ueber die Host-Bridge erfolgreich.

## Release vom 07.10.2026

Code-Release `31a12b225c50d4e9b1ef681f8f1eef3ac9093b9e` aus `codex/recovery-audit`
ist aktiv, gebaut aus `/opt/airport-releases/31a12b2`. Vorher aktiv: `5a18f73`.
Enthalten: PR #22 (Abgleich in drei Fragen), PR #24 (Testing-Lab als eigener
Raum `?seite=lab`, Kundensicht mit vier Fragen und Pruefstatus) und PR #23
(Krisenfaelle als Energie-Stresstest in C, ausgewiesene Annahme). Keine Netz- oder
Compose-Aenderung.

Backend vor dem Wechsel gestoppt, Datenvolume offline gesichert
(`/opt/airport-backups/pre-31a12b2-20261007.tar.gz`, Modus 0600, 1.220 Dateien)
und hashgleich in ein separates Verzeichnis wiederhergestellt.

Verifiziert: Execution-Commit im Container, Readiness, ohne Login 401 fuer
UI/API/Assets/Lab-Raum, HTTP leitet nur auf HTTPS um. Neue Oberflaechen im
ausgelieferten Bundle. `smoke_munich.py`, `smoke_demo.py --planner --all-cases`
und `smoke_flexlab.py` gegen den Frontend-Port auf der Host-Bridge erfolgreich;
unbekannter Krisenfall im Variantenlauf ergibt 422. Authentifizierte
HTTPS-Smokes stehen weiterhin aus. Der Lab-Raum ist in dieser geteilten Demo
ohne Rollen- oder Zugriffstrennung fuer alle angemeldeten Nutzer sichtbar.

## Release vom 05.10.2026

Code-Release `5a18f732c37d800480dd071cebea0274c9af6af9` aus `codex/recovery-audit`
(PR #21, Schritt „Daten“) ist aktiv, gebaut aus dem Release-Worktree
`/opt/airport-releases/5a18f73`. Vorher aktiv: `5210afe`. Keine Netz- oder
Compose-Aenderung; Subnetze `10.253.250.0/24` und `10.253.251.0/24` gehoeren
weiterhin nur diesem Stack.

Backend vor dem Wechsel gestoppt, Datenvolume offline gesichert
(`/opt/airport-backups/pre-5a18f73-20261005.tar.gz`, Modus 0600, 1.082 Dateien)
und hashgleich in ein separates Verzeichnis wiederhergestellt.

Verifiziert: Execution-Commit im Container, Health/Readiness, ohne Login 401
fuer UI/API/Assets, HTTP leitet nur auf HTTPS um. `smoke_munich.py`,
`smoke_demo.py --planner --all-cases` und `smoke_flexlab.py` gegen den
Frontend-Port auf der Host-Bridge erfolgreich (FlexLab mit erwarteten
FAIL-/INCONCLUSIVE-Faellen). Authentifizierte HTTPS-Smokes stehen aus.

## Release vom 04.10.2026


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
