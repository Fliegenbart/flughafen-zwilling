# Muenchen-Referenzpilot: Stromversorgung und Ladefristen

## Start fuer Timo (ca. 10 Minuten)

Im Repository: `docker compose -f docker-compose.demo.yml up --build -d`.
Bei bereits aktivem Demo-Monitoring beide Compose-Dateien verwenden, siehe README.
[Muenchen oeffnen](http://localhost:5176/?workspace=munich).
Airport bleibt die Startseite, FlexLab bleibt separat.

1. Quellen-/Annahmenhinweis lesen. Es gibt keine echten FMG-Betriebsdaten.
2. `Referenztag`, Seed 42 und `Regeln vergleichen` waehlen. Beide Runs sollten
   technisch abschliessen. Auch ein Nullvorteil bei Ladefristen ist ein Ergebnis.
3. `Anschluss-Engpass` vergleichen. Die angenommene Importgrenze sinkt von 3500
   auf 2500 kW. Im synthetischen Seed-42-Fall unterscheiden sich Bus-Ladefristen.
   Das ist kein Nachweis, dass Muenchen einen solchen Engpass besitzt.
4. Netzspitze **und** Ladefristen/fehlende Energie/Grundlast betrachten.
   Ungesteuert laedt sofort und teilt knappe Leistung proportional.
   Busprioritaet versorgt Busse zuerst, dann frueheste Frist. Keine Optimalsuche.
5. `Speicheroption` pruefen. Beide Regeln erhalten dieselbe hypothetische
   2000-kWh-Batterie. Dies ist **kein** kausaler Vergleich mit/ohne Speicher.
6. Im Einzelnachweis Busdepot/Parkhaus wechseln und verletzte Fristen filtern.
   Ladefrist heisst Zielenergie erreicht, nicht realer Busumlauf erfuellt.
7. HTML-Vergleichsreport, Run-PDF, Ladeauftraege-CSV, Telemetrie-CSV und Record
   herunterladen. Welt-Hash, Seed, Eingaben und Quellenstand sind eingefroren.
8. Seite neu laden: letzter Vergleich wird im Browser wieder geladen.
   Bei Backend-Neustart startet ein unvollstaendiger Run mit derselben ID neu.
   Ein Code-Upgrade kann Ergebnisse aendern: Queue- und Ausfuehrungs-Commit bleiben
   getrennt im Record. Unversionierte Docker-Starts sind entsprechend markiert.

**Abgeschlossen ist nicht PASS; erfuellte Modellkriterien sind kein
Betriebsnachweis oder empirische Validierung.**

## Modellvertrag v1

- Domaene `airport_energy_v1`. 24 Modellstunden in 288 Intervallen von je
  5 Minuten, als SIL-Schnelllauf ohne Wandzeit-Warten oder Adapter.
- Die zwei Runs teilen Annahmen, Seed, erzeugte Auftraege und alle Profile;
  nur die Allokationsregel unterscheidet sich. Welt-Hash schliesst die Regel aus.
  Jeder Run hat ausserdem einen eigenen bestehenden Audit-Fingerprint aus
  Request, Szenario, Model-Pack und Telemetrie. Es gibt keine externe Signatur.
- Referenzassets: 275 P44-Ladepunkte, 50 Busdepot-Ladepunkte, 7 MWp Campus-PV
  mit 3 MWp P43/P44 **als Teilmenge**, jeweils Quellenstand 2025. Keine
  automatische Annahme, dass alle Ladepunkte gleichzeitig verfuegbar sind.
  Das v1-Profil ist auf diesen historischen Stand festgelegt. Eine spaetere
  Bestandsaktualisierung benoetigt eine eigene Profil-/Modellversion.
- Generierte Auftraege: ein Auftrag je verwendetem Ladepunkt. Busse: 300 kWh
  Batterie, 90 kWh Startenergie, 90-130 kWh Nachladebedarf, Ankunft 00:00-01:00,
  Frist 05:00-06:00. Parkhaus: 80/20 kWh, Bedarf 20-45 kWh, Ankunft 00:00-01:30,
  Frist 09:00-14:00. Alle Werte/Verteilungen sind **synthetisch**, kein Flugplan,
  keine empirische Busflotte. Auftraege haben 5-Minuten-genaue Grenzen.
- Grundlast: `background_load_kw * (0.92 + 0.08 * sin(2*pi*(minute-360)/1440))`.
  PV: angenommener Sinusbogen zwischen 06:00 und 18:00, multipliziert mit
  Profilfaktor und 7 MWp. Kein Datum, Wettermodell oder gemessener Lastgang.
  Profile werden am Intervallanfang abgetastet und ueber das Intervall konstant
  verwendet; Telemetrie ist am Intervallende gestempelt (05 Minuten bis 24:00).
  SOC zeigt den Zustand nach diesem Intervall, Leistung den Intervallwert.
- BHKW: konstanter exogener Fahrplan, keine thermische Optimierung. Netz zuerst
  bis zur Importgrenze; Batterie deckt danach Defizit oberhalb der Reserve.
  Grundlast vor Ladeauftraegen. Bei Versorgungsluecke wird Grundlast nicht
  stillschweigend verworfen, sondern als nicht versorgt bilanziert.
- Ladeabgaenge: angenommene `kVA * Leistungsfaktor` begrenzen Lade-Wirkleistung.
  PV und BHKW sind an der aggregierten Campusbilanz, nicht an einem verifizierten
  P44-/Depottrafo angeschlossen. Kein AC-Lastfluss, Leitungs-/Trafverlust- oder
  Spannungsmodell. Historische 20-kV-TAB begruenden keinen realen Netzplan.
- Speicher: nur Erzeugungsueberschuss laden, nie gleichzeitig entladen.
  Wirkungsgrad je Richtung und Reserve explizit. Anfangsenergie hat unbekannte
  Herkunft, keine PV-Gutschrift. PV-Nutzung bedeutet bilanzielle Restlast nach
  BHKW, inklusive Speicherladung, **nicht** garantierter spaeterer Verbrauch
  oder Grunstromquote. Ueberschuss exportieren bis Limit, dann PV abregeln;
  nicht absetzbare BHKW-Erzeugung ist eine Modellverletzung, keine Stellaktion.
- Interne Kriterien: Bilanzrest <= 1e-6 kW, nicht versorgte Grundlast,
  nicht absetzbares BHKW und fehlende Ladeenergie jeweils <= 0.001 kWh.
  Frequenz-/Spannungs-/Schaltzeitfelder sind nur API-Shape-Platzhalter (0).
  Safety-Endpunkt prueft Audit, nicht elektrische Sicherheit.
- Modellzeit wird **nicht** als zukuenftige Livezeit in Influx geschrieben.
  Muenchen-Kurven sind im eigenen Dashboard, bisheriges Grafana bleibt fuer
  Turnaround-Livetelemetrie. Kein irrefuehrender 24-Stunden-Livechart.

## API und Betrieb

`GET /api/v1/munich/reference` liefert Dossier/Defaults.
`POST /api/v1/munich/comparisons` mit `seed` und `assumptions` liefert zwei Run-IDs,
Vergleichs-ID und Welt-Hash (HTTP 202). Status, Record, Telemetrie, Safety und
Artefakte verwenden die bestehenden Run-Endpunkte. `charging.csv` ist ein
zusaetzlich freigegebenes Run-Artefakt. Das Turnaround-Playbook ist fuer diese
Domaene gesperrt; auch direkte HIL-/Adapter-Requests werden abgewiesen.

Ein Backend-Prozess, bestehender serieller RunWorker, JSON-Persistenz. Keine neue
Queue-Infrastruktur. Ein Vergleich erzeugt zwei Szenario-/Model-Pack-Snapshots,
die fuer Audit erhalten bleiben; keine automatische Bereinigung. Bei vollem
lokalem Backlog (10 ausstehende Runs) wird ein neuer Vergleich mit 429 abgewiesen.
Keine Authentifizierung: nur localhost, nicht als gemeinsame Lab-Netz-Anwendung
exponieren. Laufzeitdaten/privates FMG-Material nicht ins Repository stellen.

## Naechster Schritt mit FMG

**Muenchen besitzt bereits einen Energiezwilling.** Zuerst mit den Kontakten
klaeren, welcher Komponenten-/Systemtest heute fehlt und wie ein TestingLab-
Nachweis ihn ergaenzen kann. Realdaten und getrennte Validierungsperiode:
[MUNICH_DATA_REQUEST.md](MUNICH_DATA_REQUEST.md). Primarquellen und Zeitbezuege:
[MUNICH_PUBLIC_DATA.md](MUNICH_PUBLIC_DATA.md).
