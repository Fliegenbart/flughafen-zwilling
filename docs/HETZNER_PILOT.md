# Hetzner-Demo

## Aktiver Release vom 21.10.2026 (Kundenseite nach Steckbrief)

Code-Release `386b088e92c8b51e3f5153c159b2913b1808c4ae`, PR #41 (baut auf #40 auf),
aus `/opt/airport-releases/386b088`. Gepruefter Remote-Commit, sauberer Worktree,
CI fuer #41 erfolgreich (Backend, Frontend, Snapshots). Ruecknahmeziel:
`/opt/airport-releases/2c594ab`, SHA `2c594ab5d7c05ebb2876f7c604c0d49a471e5fcd`.

Neu: Startseite nach `docs/PRODUKT.md` (Satz, Treppe der Bausteine, Netzlast ueber
drei Tage, Praesentationsmodus, A4-Handout). Stufe 1 rechnet Laden ohne Steuerung.
Die Regler antworten aus der vorab gerechneten Tabelle
`backend/app/exchange/data/electrification_atlas.json` (im Image). Die alte
Vergleichsseite liegt unter `?seite=fachleute`.

Ablauf: Images gebaut, waehrend die alte Version lief. Danach nur `twin-core`
gestoppt, Volume gesichert, neue Version gestartet. Netze `10.253.250.0/24` und
`10.253.251.0/24` vorher geprueft, nur vom eigenen Projekt belegt.

Offline-Sicherung:

- `/opt/airport-backups/pre-386b088-20261021T133838Z.tar.gz`
- 2.691 Dateien; 68.922.109 Bytes; Modus 0600
- SHA256 `7bf31bad9091533956091dc03d04b09c0891dc848503453876631d7127274112`
- Pruefkopie entpackt, MD5 aller Dateien identisch (`LC_ALL=C sort`), Pruefkopie entfernt.

Abnahme:

- Lokal 375 Backend- und 227 Frontend-Tests; Lint, Typecheck, Ruff, Build.
- HTTPS: `/health` ok, Build `386b088` im Vergleich, Tabelle mit 2.860 Stellungen
  und 220 Werten ohne Steuerung, Vergleich 50 %/1.500 kW in 5,7 s
  (ohne Steuerung 1.625 kW, direkt 875, vorausschauend 800, mit Speicher 675).
  368 Runs und 9 Projekte nach dem Neustart vorhanden.
- Smokes ueber HTTPS bestanden: `smoke_electrification.py` (prueft Werte aus der
  Tabelle jetzt gegen den Endpunkt `/demo/electrification/atlas`),
  `smoke_public_simulation.py`, `smoke_demo.py --planner --all-cases`,
  `smoke_flexlab.py`, `smoke_munich.py`.
- Live-Browser 1.440 px: Treppe, Kurve, keine Konsolenfehler, kein Ueberlauf.
- Ein gesunder Backend-Prozess, keine Neustarts, keine Tracebacks oder 5xx im
  Logfenster. HTTP leitet auf HTTPS um. Die oeffentliche Demo bleibt oeffentlich;
  keine fremden Stacks, Auth-Einstellungen oder Netze geaendert.

## Release vom 16.10.2026 (einfacher Messdatenablauf)

Code-Release `2c594ab5d7c05ebb2876f7c604c0d49a471e5fcd`, PR #40, aus
`/opt/airport-releases/2c594ab`. Gepruefter Remote-Commit, sauberer Worktree,
CI `38914425210` erfolgreich (Backend, Frontend, Archive und Container-/Proxytests).
Ruecknahmeziel: `/opt/airport-releases/dd03409`, SHA
`dd03409d11ca75a33f2ed3b9f28072bee14e3ae8`. Dieser nachfolgende reine
Dokumentationscommit wird nicht als neuer Code deployt.

Neu ist ein Drei-Schritt-Einstieg: verifiziertes Lastprofil herunterladen,
CSV im Browser auswaehlen, Abweichungen ansehen. Keine Messdaten-Uploads oder
persistente Speicherung im Schnellvergleich, keine Anlagensteuerung und kein
PASS-/Validierungsurteil. Die Uebungsdatei ist im Inhalt als synthetisch markiert;
der bisherige formale Server-Workflow lehnt ihr Zusatzfeld ab. Dieser bleibt
separat aufklappbar und behaelt Eingaben beim Zuklappen. Anleitung:
[Lastprofil und Messdaten](MEASUREMENT_QUICKSTART.md).

Offline-Sicherung nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-2c594ab-20261016T142622Z.tar.gz`
- 2.502 Dateien; 58.450.853 Bytes; Modus 0600
- SHA256 `9819ab5bc590296796ee04251e65f6bb90e8e5398103dab5ae879291cb2802fd`
- Private Pruefkopie entpackt, alle Dateihashes verifiziert, Pruefkopie entfernt.
- Alle bisherigen 344 Runs, acht Projekte, zwei Flugplan-Snapshots und
  2.502 Dateipfade nach Neustart vorhanden. Projekt-Overviews und -Lagebilder
  erreichbar, Szenario-Bibliothek unveraendert acht Faelle.

Abnahme bestanden:

- 368 Backend-Tests und 210 Frontend-Tests; Lint, Typecheck, Ruff, normaler
  und Subpath-Build, Archivcheck. Profil-/CSV-Tests einschliesslich Auth,
  manipulierter Artefakte, fehlender Werte und Zeitdeckung.
- Drei durch Review gefundene UI-Zustands-/Dateianzeigefehler mit roten
  Regressionstests reproduziert und korrigiert; final keine Review-Blocker.
- Lokaler Browser: Variante uebernehmen, tatsaechliche Datei herunterladen,
  native Dateiauswahl, 4.320 Werte vergleichen. Alle exportierten CSV-Werte
  separat exakt gegen die verifizierte API-Projektion geprueft. Leere
  Vorlage wird abgewiesen, vorheriges Ergebnis verschwindet.
- Live-Browser: alter Referenzlauf `937569d719c249baa7cde2f7f7d78130`
  lesbar, Uebungsdatei heruntergeladen und ueber den Dateidialog ausgewaehlt.
  Ergebnis: 4.320 Werte, MAE 49,81 kW, Energieabweichung 4,85 Prozent,
  sichtbar als synthetische Uebung und nicht als Validierungsnachweis.
  Desktop 1.440 px und Mobil 390 px, kein horizontaler Seitenueberlauf,
  keine Browser-/CSP-Fehler. Ein gebuendelter Browser-Toolaufruf fuer Download
  und Dateidialog kam erst nach laengerer Wartezeit zurueck; die anschliessende
  Auswertung wurde erfolgreich verifiziert. Daraus wird keine Aussage ueber
  Dialoggeschwindigkeit in anderen Browsern abgeleitet.
- Live-Einstieg von der Startseite: Variante `managed_storage`, 50 Prozent
  elektrisch, 1.500 kW Anschluss ausgewaehlt und als neuer Run
  `b0e1b365fad049beb39ee8f984943b38` in den Schnellvergleich uebernommen.
  Variantenangabe und 4.320 Profilwerte korrekt; kein Chart- oder Projektumweg.
- HTTPS-Smokes `smoke_electrification.py --materialize`,
  `smoke_public_simulation.py`, `smoke_demo.py --planner --all-cases`,
  `smoke_flexlab.py`, `smoke_munich.py` und `smoke_coupled.py` bestanden.
  Neuer materialisierter Lauf `e680afdefe6d4545aa9ae45fbb5a8ab8` abgeschlossen.
  Die bestehenden Modell-Kapazitaeten sind unveraendert; Planner weiterhin
  ohne nachgewiesenen KPI-Gewinn. Negative FlexLab-Faelle bleiben negativ.
- `smoke_measurement_profile.py` ueber HTTPS fuer alten und neuen Run:
  Netzbezug, Vorfeld-Laden und Parkhaus, jeweils 4.320 exakte Minutenwerte,
  Einheit, SHA256 und Zeitsemantik verifiziert. Kein Messdaten-Upload.
- `smoke_pilot.py` aus dem Release-Worktree per stdin im laufenden Backend
  gegen `127.0.0.1:8000`: synthetischer Import, Replay, schlechte Daten und
  Paket-Hashes bestanden. Projekt `ab6d3476-4819-45c5-86a2-e218843739f1`,
  Bewertung bewusst `NOT_EVALUABLE`. Das Skript ist nicht als Datei im
  Container installiert; ein erster Aufruf dieses nicht vorhandenen Pfads
  scheiterte, der anschliessende stdin-Aufruf war erfolgreich.

Start `2026-10-16T14:27:13Z`, ein gesunder Backend-Prozess mit `--workers 1`,
keine Neustarts, leerer Influx-Token. Keine Tracebacks, Application-ERRORs oder
HTTP-5xx im kontrollierten Backend-Logfenster. Beide bestehenden Subnetze
`10.253.250.0/24` und `10.253.251.0/24` konfliktfrei. Host-Proxy unveraendert,
HTTP leitet auf HTTPS um. Die ausdruecklich oeffentliche Demo bleibt oeffentlich;
keine fremden Stacks, Hardwareadapter, Auth-Einstellungen oder Netzwerke geaendert.
Kein Rollback und kein Datenrestore erforderlich.

## Release vom 16.10.2026 (vorausschauende Ladeplanung)

Code-Release `dd03409d11ca75a33f2ed3b9f28072bee14e3ae8`, PR #39, aus
`/opt/airport-releases/dd03409`. Remote-Commit, sauberer Release-Worktree und
laufender Container-Build-SHA stimmen ueberein. CI `38906995680` vollstaendig
gruen. Vorher aktiv und Ruecknahmeziel:
`deb3d4335b8440b023ea7b8f40ec20c40f921688`.
Der folgende reine Dokumentationscommit wird nicht als neuer Code deployt.

Die Engine `airport_electrification_v3` ergaenzt eine vorausschauende
Energiehuellen-Heuristik mit bekanntem Einsatzplan und ein 25-kW-Suchraster.
Alle Varianten behalten dieselben Fahrzeuge, festen Fahrzeugzuweisungen,
Auftraege, Ladepunkte und Anfangsladungen. Keine Diesel-Ersatzfahrzeuge und
keine geliehene Anfangsenergie. Jede Stufe wird minutenweise ausgespielt;
Fahrzeuge und Speicher muessen am Ende mindestens ihre Anfangsladung haben.
Keine globale Optimalitaet, reale Prognose oder FMG-Kalibrierung.
[Modellvertrag und Grenzen](ELECTRIFICATION_COMPARISON.md).

Die hellere Vergleichsansicht behaelt drei Regler und drei gleichberechtigte
Varianten mit gemeinsamer Balkenskala. Anschlusswerte werden exakt in kW
angezeigt. Alte Ergebnisse verschwinden bei geaenderten Eingaben; Lastverlauf,
Pruefwerte, Annahmen und Messdaten-Handoff bleiben erreichbar.

Live ueber HTTPS nachgerechnet, jeweils mit 2 MWh Speicher in Variante 3:

| Elektroanteil | Direkt laden | Vorausschauend laden | Geplant + Speicher |
| --- | --- | --- | --- |
| 0 % | 375 kW | 375 kW | 325 kW |
| 50 % | 875 kW | 800 kW | 675 kW |
| 100 % | 1.400 kW | 1.225 kW | 1.150 kW |

Das sind die ersten erfolgreichen Stufen fuer diese Modellregeln, keine
kontinuierlichen Minima oder Anschlusszusagen. Bei 100 Prozent und einem
vorhandenen Anschluss von 1.250 kW sind zwar auch bei direktem Laden alle
540 Abfertigungen rechtzeitig bereit, die Fahrzeugladung wird dort aber
nicht vollstaendig wiederhergestellt. Beide geplanten Varianten bestehen.
Gleiche Bereitschaft allein ist deshalb kein ausreichender Erfolgsnachweis.

Offline-Sicherung nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-dd03409-20261016T132650Z.tar.gz`
- 2.309 Dateien; Archiv 47.344.695 Bytes, Modus 0600
- SHA256 `e472e3959f28a00140ac235d6fd9a48ee9cac9109da0197974f51e581f4a4229`
- In einer privaten Pruefkopie entpackt und alle Dateihashes verifiziert;
  diese temporaere Kopie anschliessend entfernt.
- Alle 2.309 vorherigen Dateipfade nach dem Start vorhanden.

Abnahme bestanden:

- 363 Backend- und 192 Frontend-Tests, Lint, Typecheck, beide Frontend-Builds,
  Archivcheck und CI inklusive Container-/Proxytests.
- Modellreview und Kontrollrechnungen zu Energiebilanzen, Ladepunkten,
  Zuordnungsidentitaet und Null-EV-Gegenprobe. 18 vollstaendige Replays vor/nach
  der Planer-Beschleunigung identisch. Alle acht historischen Airport-Cases
  behalten nach der SIL-Korrektur exakt dieselben KPIs und Telemetriedaten.
- Zusaetzliche Grenzwerte 50/100 Prozent mit 0/6 MWh lokal bestanden. Ohne
  Speicher haben beide geplanten Varianten identische Welten und Ergebnisse;
  nur diese identische Anschluss-Suche wird wiederverwendet. Die angezeigten
  Verlaeufe werden weiterhin separat gerechnet.
- Kalter Null-Speicher-Vergleich mit 100 Prozent auf Hetzner, isoliert mit
  1 CPU, ohne Netzwerk oder Datenmounts: 76,542 s, 1.400/1.225/1.225 kW.
  Erste Berechnungen sind nicht sofortig; UI nennt bis zu zwei Minuten.
  Wiederholte Anschluss-Suchen werden gecacht. HTTP-Limit bleibt 120 s.
- `smoke_electrification.py --materialize`: 0/50/100 Prozent, Endladungen,
  Anschlussstufen und gespeicherter Lauf `cefc0b5833b64acfb60145ee30f46ff1`
  inklusive Artefakten bestanden.
- `smoke_public_simulation.py`, `smoke_demo.py --planner --all-cases`,
  `smoke_flexlab.py`, `smoke_munich.py` und `smoke_coupled.py` ueber HTTPS
  bestanden. Vorhandener Snapshot
  `8a4a3241a933eb8e4e94efc54a93638f6c2bded7405bbe0efb4702736b53aed7`
  weiter nutzbar. Planner-Referenzen zeigen weiterhin keinen KPI-Gewinn;
  technische Fertigstellung alter Modellfaelle ist kein fachlicher PASS.
- Personalengpass zusaetzlich waehrend einer Bestandsabfrage getestet:
  `0ef3ad76a4fa40b1b2da10852db6bdf2`, vorher `running`, danach `completed`,
  Audit-Fingerprint korrekt. 343 Records wurden parallel gelesen.
- `smoke_pilot.py` mit dem neuen 72-Stunden-Lauf direkt gegen
  `127.0.0.1:8000` im Backend-Container bestanden. Das Skript erlaubt nur
  lokale Ziele. Synthetischer CSV-Import, Replay, schlechte Daten und
  Paket-Hashes geprueft: `NOT_EVALUABLE`, keine empirische Validierung.
- Live-Browser: Default, 100 Prozent/1.250 kW, echte Neuberechnung,
  ausgeblendete veraltete Ergebnisse, Fehlergruende, Lastverlauf und Handoff
  geprueft. Browser-Lauf `937569d719c249baa7cde2f7f7d78130` ist abgeschlossen:
  Policy `lookahead`, exakt 1.250 kW, 100 elektrische Fahrzeuge, 4.320
  Minutenwerte und wiederhergestellte Endladung serverseitig bestaetigt.
  Desktop 1.440 px und Mobil 390 px ohne horizontalen Ueberlauf;
  Browserkonsole ohne Fehler oder CSP-Warnungen, 37 selbst gehostete
  WOFF2-Dateien HTTP 200. Kein nativer Dateidialog in diesem Browser-Smoke;
  der CSV-/Replay-Pfad wurde separat ueber HTTP geprueft.
- Alle vorherigen 319 Laeufe, sieben Projekte und zwei Flugplan-Snapshots
  erhalten. Bisherige Projekt-Overviews und -Lagebilder HTTP 200,
  Bibliothek acht Faelle und `exchange/whoami` HTTP 200.

Zwei fruehere Kandidaten wurden bei fehlgeschlagener Live-Abnahme tatsaechlich
auf `deb3d43` zurueckgesetzt, jeweils ohne Datenrestore:
`f5e4108` ueberschritt im kalten 100-Prozent-Vergleich das HTTP-Zeitlimit.
`b643a1e` bestand den Ladevergleich, traf aber beim alten Turnaround-Code
unter paralleler Bestandsabfrage auf `telemetry_shutdown_timeout`.
Der finale Code beseitigt redundante Planerarbeit und verarbeitet SIL-
Telemetrie synchron vor dem Schliessen der Ausgabedatei, getrennt von der
Tickzeitmessung. HIL bleibt unveraendert asynchron. Callback-Fehler bleiben
Fehler; externe Callback-Abhaengigkeiten muessen begrenzte I/O-Zeiten haben.
Der optionale Influx-Requesttimeout ist explizit 10 s, wie zuvor der
Bibliotheksdefault. Im Pilot bleibt der Token leer. Fehlgeschlagene QA-Laeufe
wurden nicht nachtraeglich umgewertet oder geloescht.

Finaler Start ab `2026-10-16T13:27:37Z`: ein gesunder Backend-Prozess mit
`--workers 1`, keine Neustarts, keine Fehler/Tracebacks oder HTTP-5xx im
kontrollierten Logfenster. Beide bestehenden Airport-Subnetze konfliktfrei,
Host-Proxy-Hash unveraendert. Die bewusst oeffentliche Demo bleibt ohne
Passwort, HTTP leitet auf HTTPS. Keine Hardwarewrites, kein Influx-Token,
keine Aenderungen an anderen Compose-Stacks.

Ruecknahme: Airport-Backend stoppen, aus `/opt/airport-releases/deb3d43` mit
`TWIN_BUILD_GIT_COMMIT=deb3d4335b8440b023ea7b8f40ec20c40f921688`
`up --build -d`, niemals `down -v`. Alte Releases koennen neue abgeschlossene
Records lesen, aber keine v3-Jobs ausfuehren. Sicherung nur bei
nachgewiesenem Datenschaden zurueckspielen.

## Release vom 15.10.2026 (literaturgestuetzter Anschlussvergleich)

Code-Release `deb3d4335b8440b023ea7b8f40ec20c40f921688`, PR #38, aus
`/opt/airport-releases/deb3d43`. Remote-Commit, sauberer Release-Worktree und
Container-Build-SHA stimmen ueberein. CI `38728813709` vollstaendig gruen.
Vorher aktiv: `55d360430f00f1cc3cdfeba86af15871cdddb93a`. Der separate
Dokumentationscommit aendert nicht den hier angegebenen laufenden Code.

Die Startseite berechnet je Variante die erste erfolgreiche Anschlussstufe
im 250-kW-Raster bis 8 MW. Alle Varianten haben dieselben 100 Fahrzeuge und
dieselben Auftraege. Die neue Engine `airport_electrification_v2` verwendet
eine ausdruecklich synthetische Vorfeld-Referenz mit 180 Ankuenften und 180
Abfluegen pro Tag, Literaturwerten fuer drei Fahrzeugklassen und drei
zusammenhaengenden Tagen ohne SOC-Reset. Jedes elektrische Fahrzeug und der
Speicher muessen am Ende mindestens ihre Anfangsladung erreichen. Der
vorhandene Anschluss wird separat simuliert; Messdaten-Handoff und
Detailkennzahlen beziehen sich auf ihn, nicht auf die gesuchte Stufe.
[Quellen, Annahmen und Grenzen](ELECTRIFICATION_COMPARISON.md).

Live nachgerechnet, jeweils mit 2 MWh Speicher in Variante 3:

| Elektroanteil | Direkt laden | Gesteuert laden | Gesteuert + Speicher |
| --- | --- | --- | --- |
| 0 % | 500 kW | 500 kW | 500 kW |
| 50 % | 1.000 kW | 1.000 kW | 750 kW |
| 100 % | 1.500 kW | 1.500 kW | 1.250 kW |

Dies sind erfolgreiche Rasterstufen im unkalibrierten Methodenprototyp,
keine exakten Minima, realen Muenchner Anschlusswerte oder Investitionszusagen.
Unveraenderte Ergebnisse werden nicht als Optimierungsgewinn dargestellt.

Offline-Sicherung nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-deb3d43-20261015T114458Z.tar.gz`
- 2.086 Dateien, 750.529.903 unkomprimierte Bytes; Archiv 32.281.884 Bytes,
  Modus 0600
- SHA256 `5eaf96df88093c1d40aba9db93078359028a32d7f77b1a2c396212e78b58155e`
- Wiederherstellung mit Dateihashes geprueft; temporaere Pruefkopie entfernt.
- Alle 2.086 gesicherten Dateipfade nach dem Start weiter vorhanden.

Abnahme bestanden:

- 339 Backend- und 190 Frontend-Tests, Lint, Typecheck, beide Builds,
  unveraenderte Archivsnapshots und GitHub-CI inklusive Container-/Proxytests.
- `smoke_electrification.py --materialize`: 0/50/100 Prozent, gleiche Flotte
  und Auftraege, Anschlussstufen und Endladezustaende. Gespeicherter SIL-Lauf
  `471a5c433d81447a883ff1c3f353734d`, Artefakte und Fahrzeug-Endzustaende geprueft.
- `smoke_public_simulation.py`, `smoke_demo.py --planner --all-cases`,
  `smoke_flexlab.py` und `smoke_munich.py` ueber oeffentliches HTTPS bestanden.
  Beide Planner-Referenzen liefern unveraenderte KPIs; kein Gewinn wird behauptet.
- `smoke_coupled.py` mit vorhandenem Snapshot
  `8a4a3241a933eb8e4e94efc54a93638f6c2bded7405bbe0efb4702736b53aed7` bestanden,
  inklusive Welt-/Artefakthashes und PDF. Die alten Modellkriterien bleiben
  unerfuellt; technische Fertigstellung ist kein fachlicher PASS.
- `smoke_pilot.py` mit dem neuen 72-Stunden-Lauf direkt gegen
  `127.0.0.1:8000` im Backend-Container bestanden. Das Skript erlaubt nur
  lokale Ziele. Synthetischer CSV-Import, Replay, ungueltige Daten und
  Paket-Hashes geprueft: `NOT_EVALUABLE`, keine empirische Validierung.
- Live-Browser: Startseite, 50 Prozent bei 750 kW, echte Neuberechnung,
  Fehlergruende, Quellen, 72-Stunden-Verlauf und Handoff in den
  Messdaten-Abgleich geprueft. Browser-Lauf
  `8f2fe9545cce4278bd34c77b50d5da32` hat 4.320 Minutenwerte. Desktop und
  390 px ohne horizontalen Ueberlauf, keine Browser-/CSP-Fehler,
  selbst gehostete Schriftdateien HTTP 200. Kein nativer Datei-Upload
  in diesem Browser-Smoke; der CSV-Pfad wurde separat ueber HTTP geprueft.
- Alle vorherigen 288 Laeufe, sechs Projekte und zwei Flugplan-Snapshots
  erhalten. Alle bisherigen Projekt-Overviews und -Lagebilder HTTP 200,
  Szenario-Bibliothek weiterhin acht Faelle.

Ein Backend-Prozess mit `--workers 1`, healthy, keine Neustarts, kein
Influx-Token und keine echten Adapter. Keine Fehler im kontrollierten
Startfenster. Beide bestehenden Airport-Subnetze konfliktfrei, Proxy-Hash
unveraendert. Die zuvor oeffentlich freigegebene Demo bleibt oeffentlich;
HTTP leitet auf HTTPS, UI und API antworten ohne Anmeldung. Andere Stacks
wurden nicht veraendert.

Ruecknahme: Airport-Backend stoppen, aus `/opt/airport-releases/55d3604` mit
dessen vollstaendigem Build-SHA `up --build -d`, ohne Volume-Loeschung.
Der unveraenderte alte Code wurde lokal mit einem neuen abgeschlossenen
Record gestartet; Listen und Lesen funktionieren. Neue Energiewerte liegen
im erweiterbaren Energy-Teil, nicht im streng validierten Coupled-Teil.
Noch nicht abgeschlossene Jobs der neuen Engine benoetigen weiterhin den
neuen Code. Alte v2-Welt, KPIs und alle Leistungsreihen sind unveraendert;
gemeinsamer Fingerprint
`a0be2acfa6eeb1100a23a49f925ddae9385b7307f0429088b3d9eb0ec59f6cb3`.
Sicherung nur bei nachgewiesenem Datenschaden zurueckspielen.

## Release vom 15.10.2026 (feste Flotte und Elektroanteil)

Code-Release `55d360430f00f1cc3cdfeba86af15871cdddb93a`, PR #37, aus
`/opt/airport-releases/55d3604`. Remote- und Container-SHA stimmen ueberein.
CI `38718935109` vollstaendig gruen. Vorher aktiv: `546af16`.

Die Startseite vergleicht eine konstante Flotte von 100 Fahrzeugen mit
einstellbarem Elektroanteil. Direktes Laden, gesteuertes Laden und gesteuertes
Laden mit Speicher teilen Auftraege, Fahrzeug-IDs, Antriebsmix, Start-SOC,
Ladepunkte und Anschluss. Die neue Engine ist `airport_electrification_v1`;
bisherige v2-Laeufe bleiben unveraendert. [Modellvertrag](ELECTRIFICATION_COMPARISON.md).

Offline-Sicherung nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-55d3604-20261015.tar.gz`
- 1.992 Dateien, 33.652.272 Bytes, Modus 0600
- SHA256 `abf8e99d34f0f4027452874d21f2df599a0c27b7bb1be7516c47d6d6f34f74a1`
- Wiederherstellung mit Dateihashes geprueft; temporaere Pruefkopie entfernt.

Abnahme: 322 Backend- und 189 Frontend-Tests, Typecheck, Lint, Subpath-Build
und Archivcheck bestanden. Neue HTTP-Abnahme `smoke_electrification.py
--materialize`: 0/50/100 Prozent, konstante Flotte/Auftraege, drei Varianten,
Energiebilanzen und gespeicherter SIL-Lauf
`46bd451d4a7a4883a03168c46267913f` erfolgreich. Bisherige v2-Welt, KPIs und
Leistungsreihen vor dem Update exakt gegen den alten Live-Release verglichen.
Alte oeffentliche Demo-Varianten nach dem Update weiterhin erfolgreich.

Browser lokal und live: drei Regler, Neuberechnung, 0/100 Prozent,
unveraenderte Gesamtflotte, ausgewaehlter Lauf im Messdaten-Abgleich;
Desktop und 390 px ohne horizontalen Ueberlauf, Live-Konsole ohne Fehler.
Bei 100 Prozent und 3,5 MW: 51/47/0 Lademinuten mit Leistungsengpass bei
direkt/gesteuert/gesteuert mit 2 MWh Speicher. Bereitschaft bleibt 76/310;
kein betrieblicher Nutzen wird daraus erfunden. FlexLab sowie alle acht
Airport-Cases, Stabilitaetsfall und beide Planner-Referenzen ueber HTTPS
bestanden. Die Planner-Referenzen zeigen keinen KPI-Gewinn.

Alle Dateien der Sicherung bleiben vorhanden. Ein gesunder Backend-Prozess,
keine Neustarts, Startfenster ohne Fehler/Tracebacks. Bestehende Airport-Subnetze
konfliktfrei und Proxy unveraendert; oeffentlicher Demo-Zugang bleibt bestehen.
Andere Stacks nicht angefasst. Ruecknahme ueber `/opt/airport-releases/546af16`
mit altem Build-SHA und `up --build -d`, ohne Volume-Loeschung. Der alte Code
kann neue Elektrifizierungsjobs nicht ausfuehren; fertig gespeicherte Artefakte
bleiben im Datenvolume erhalten.

## Release vom 13.10.2026 (fokussierte Flughafen-Demo)

Code-Release `546af16880ebc00df0f5add8c2179a0265169897`, PR #36, aus
`/opt/airport-releases/546af16`. Remote- und Container-SHA stimmen ueberein;
CI `38423542612` vollstaendig gruen. Vorher: `7930f02`.

Die Startadresse oeffnet direkt die Frage „Mehr elektrische Fahrzeuge.
Reicht die Stromversorgung?“ Drei sichtbare Regler und drei Vorher-nachher-Karten
ersetzen die bisherige Auswahl zwischen vielen Einstiegspunkten. PV, Quellen,
Projekte, Szenarien, Messdaten-Abgleich, FlexLab, Kurven und Exporte bleiben
aufklappbar erhalten. [Vorfuehrablauf](FOCUSED_AIRPORT_DEMO.md).

Offline-Sicherung, nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-546af16-20261013.tar.gz`
- 1.908 Dateien, 32.552.287 Bytes, Modus 0600
- SHA256 `aad0dabe396d3fce58bb8785025dd3f8d4c58abac74e2a28bdca543f8a72f9d0`
- Wiederherstellung per Dateihashes geprueft, temporaere Pruefkopie entfernt.

Abnahme: 188 Frontend- und 306 Backend-Tests bestanden, Typecheck, Lint,
Subpath-Build und Archivcheck gruen. Browser lokal und ueber HTTPS: Ausgangslage,
Regler, echte Neuberechnung, Ruecksetzen, drei sichtbare Regler und erhaltene
Werkzeuge geprueft. Desktop und 390 px ohne horizontalen Inhaltsueberlauf;
Live-Browserkonsole ohne Fehler. Der synthetische Test mit 20 weiteren Fahrzeugen
zeigt 209 statt 234 wartende Abfertigungen und 1.093 statt 193 kWh ungedeckten
Ladebedarf. Das ist ein Ergebnis des unkalibrierten Modells, kein empirischer
Nachweis. Oeffentliche Demo-Varianten und FlexLab-Smoke bestanden. Alle acht
Airport-Cases plus Stabilitaetsfall sowie beide Planner-Referenzfaelle wurden
nach dem Deployment ueber HTTPS erfolgreich ausgefuehrt. Das belegt den
technischen Ablauf; fuer die Planner-Referenzen ergab sich kein KPI-Gewinn.

Alle Dateien der vorherigen Sicherung bleiben vorhanden. Ein Backend-Prozess,
healthy, keine Neustarts; kontrolliertes Startfenster ohne Fehler/Tracebacks.
Bestehende Airport-Subnetze konfliktfrei, Proxy-Hash unveraendert. Andere Stacks
unberuehrt. Ruecknahme ueber `/opt/airport-releases/7930f02` mit dessen Build-SHA
und `up --build -d`, ohne Volume-Loeschung.

## Release vom 13.10.2026 (Messdaten-Abgleich)

Code-Release `7930f0282a367f5affde82e99a0a355fba6448d7`, PR #35 (aufbauend
auf PR #34), aus `/opt/airport-releases/7930f02` aktiv. Remote-SHA und
Container-Build-SHA identisch; CI `38396703061` vollstaendig gruen.
Vorher aktiv: `b1ad776b405f10f7f23eea00b4bad0bfe8b59c8a`.

Der bisherige Pruefbereich ist ein gefuehrter Messdaten-Abgleich:
gespeicherter gekoppelter Lauf, Prueffrage/Messgrenze und gesperrte Kriterien,
eigene CSV-Messreihe, serverseitiger Replay und Bewertung. Demo-Vorschauen
lassen sich ausdruecklich als normaler SIL-Lauf uebergeben. Keine fingierten
Auftraege oder Session-Erfolgsdaten; API-Fehler werden nicht durch Beispiele ersetzt.
Nur kW-Reihen, exakte vollstaendige Zeitdeckung ohne Interpolation. Diagnose,
Holdout-Kriterien und Betriebsfreigabe bleiben getrennt.

Offline-Sicherung nach Stoppen ausschliesslich des Airport-Backends:

- `/opt/airport-backups/pre-7930f02-20261013.tar.gz`
- 1.807 Dateien, 27.464.106 Bytes, Modus 0600
- SHA256 `c88d3e5b4c56798d34cbbeeeb3db499da98e26fb1a89a117d1c8f543b4cb6a2f`
- Wiederherstellung hashgeprueft, temporaere Pruefkopie anschliessend entfernt.

Abnahme:

- 187 Frontend- und 306 Backend-Tests; Lint, Typecheck, Subpath-Build,
  Archivcheck und CI inklusive Container-/Proxytests bestanden.
- Neuer HTTPS-Smoke `scripts/smoke_measurement_workflow.py` bestanden:
  Lauf `6a3d8553979847a99c7c23f028902372`, QA-Projekt
  `d1caacc0-f77b-4696-943a-72b0347d8a15`, berechneter MAE 17,510605 kW.
  Daten ausdruecklich aus dem Modell abgeleitet, deshalb `lab_diagnostic` und
  `NOT_EVALUABLE`, keine empirische Validierung. Ungueltige CSV bleibt invalid.
- Vier Demo-Stellschrauben, alle Airport-Cases, beide Planner-Referenzen und
  FlexLab-Smoke ueber HTTPS bestanden.
- Lokal im Browser: Auswahl, Speichern der Frage/Grenzen, Wiederaufnahme,
  Sperre bei ungueltiger Messreihe sowie direkter Simulations-Handoff geprueft.
  390-px-Ansicht ohne Inhaltsueberlauf. Live-Ansicht und gespeicherte Diagnose
  sichtbar, keine Browserfehler. Der automatisierte native Dateidialog blockierte;
  dessen vollstaendige manuelle Browserabnahme wird nicht behauptet. CSV-Import
  ist per Frontend-Test und echtem HTTP-End-to-End geprueft.
- Alle vorherigen fuenf Projekte, zwei Snapshots und 250 Laeufe erhalten.
  QA ergaenzt synthetische Daten. UI/Health/Readiness HTTP 200.
- Ein Backend-Prozess, healthy, keine Neustarts oder Fehler/Tracebacks im
  kontrollierten Start-/Abnahmefenster. Bestehende Airport-Subnetze konfliktfrei.
  Oeffentlicher Proxy unveraendert; andere Stacks nicht angefasst.

Rollback auf `/opt/airport-releases/b1ad776` mit dessen Build-SHA und
`up --build -d`, ohne Volume-Loeschung. Sicherung nur bei nachgewiesenem
Datenschaden zurueckspielen. Oeffentliche Demo unveraendert, keine privaten
Messdaten hochladen.

## Release vom 13.10.2026 (interaktive Flughafen-Simulation)

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

## Release vom 08.10.2026 (Arbeitsbildschirm)

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
