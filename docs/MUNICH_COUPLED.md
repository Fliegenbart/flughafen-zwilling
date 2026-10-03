# MUC: Flugplan -> Fahrzeuge -> Energie

**Additiver, unkalibrierter Methodenprototyp.** Echter veroeffentlichter Plan,
aber angenommene Einsaetze/Verbraeuche/Flotten/Versorgung. Keine reale OTP/TOBT,
AC-Lastfluss-/Schutzpruefung, Investitionsempfehlung oder Anlagensteuerung.
Airport bleibt Standard; FlexLab und der statische Energie-v1-Pilot bleiben erhalten.

## Timo-Ablauf

1. `docker compose -f docker-compose.demo.yml up --build -d`, dann
   [Muenchen](http://localhost:5176/?workspace=munich) oeffnen. Bei aktivem
   Monitoring dessen Overlay wie im README erhalten; nichts `down -v` loeschen.
2. Offiziellen Saisonflugplan manuell als PDF fuer den gewuenschten Verkehrstag
   importieren oder gespeicherten Tag explizit auswaehlen. Kein Scheduler.
3. Im neuen Panel **Flugplan -> Fahrzeuge -> Energie** Annahmen ausklappen.
   Pro Klasse Fahrzeuge, Ladepunkte, Batterie/SOC, Reserve, Verbrauch inkl.
   Rueckfahrt, Servicezeit/Fristen und deterministische Einsatzabdeckung pruefen.
   Diese Zahlen sind keine behauptete FMG-Flotte.
4. Ungeklaerte Mehrfachgruppen nur nach bewusster Entscheidung als unabhaengige
   Nachfrage bestaetigen. Anderenfalls bleibt der Vergleich gesperrt. Keine
   stillschweigende Codeshare-/Umlauf-Zusammenlegung.
5. **Gekoppelten Vergleich starten**: zwei serialisierte SIL-Runs mit identischem
   Welt-Hash. Nur Laderegel und Ladepunktbelegung unterscheiden sich. Warten,
   bis beide terminal sind; `completed` bedeutet nicht fachlich PASS.
6. Aufgabenbereitschaft, unerledigte Auftraege, Energie-/Fahrzeugwartezeit und
   Parkhausenergie gleichzeitig betrachten. Keine Siegergarantie oder echte OTP.
7. Auftragstabelle nach Flugnummer/Fahrzeug/Klasse suchen; Regel wechseln,
   Fristverletzungen filtern und PDF-Seite, Frist, Serviceende und Ursache pruefen.
   Vollstaendige Einzelnachweise/SOC in CSV/JSON. HTML-Vergleichsbericht exportieren.
8. Optional in den Annahmen einen zeitlich begrenzten Netzimport- und/oder
   Ladepunktausfall einer Fahrzeugklasse aktivieren. Fuer einen reinen
   Ladepunktausfall das Netzlimit auf die normale Importgrenze setzen.
   Die Zeiten sind fortlaufende Minuten seit Verkehrstagbeginn, nicht Wandzeit.
   Referenz/Stress benoetigen getrennte Vergleiche, keine Umdeutung alter Ergebnisse.
9. Reload laedt den letzten Kopplungsvergleich; Worker-Recovery nutzt eingefrorene
   Welt und Flugplan unter gleicher Run-ID. Queue- und Execution-Commit sind getrennt.

## Fachlicher und numerischer Vertrag

- `airport_coupled_v1`, 1-Minuten-SIL ohne Adapter/Wandzeit-Warten.
  Verkehrstag wird von lokaler Mitternacht zu Mitternacht in UTC abgebildet
  (1440, bei DST 1380/1500 Minuten). Default Vorlauf 120/Nachlauf 240 Minuten.
  Anfangs-SOC gilt am Vorlaufbeginn; **Energie-KPIs umfassen diesen ganzen Horizont**.
- Pro abgedecktem Eintrag/Klasse ein hypothetischer Auftrag: Bus/Gepaeck bei
  Ankunft und Abflug, Pushback/GPU nur Abflug. Keine Passagierzahl, Gate-Geometrie,
  Inbound-/Outbound-Umlaeufe, Turnaround-Abhaengigkeiten oder Ist-Flugzustand.
  Mission-ID, Quelleneintrag, PDF-Seite, Plan-/PDF-Hash bleiben nachvollziehbar.
- Ankunft: Freigabe zur Planzeit, Frist nach angenommener Ankunftstoleranz.
  Abflug: Freigabe Planzeit minus Vorlauf, Frist Planzeit minus Puffer. Der
  Horizont muss alle nominalen Service-/Rueckkehrfenster abdecken, sonst Reject.
- Derselbe nicht-preemptive EDF-Auftragsdispatcher fuer beide Regeln. Belegtes
  Fahrzeug kann weder weiteren Auftrag noch Ladeleistung erhalten. Dispatch
  erst mit Missionsenergie oberhalb der Reserve. Verbrauch gleichmaessig ueber
  Service+Rueckfahrt; Serviceende ist Aufgabenbereitschaft, Rueckfahrt kann am
  Horizont noch andauern. Keine erfundene Fertigstellung nach Modellende.
- Null-Flotte/Null-Ladepunkte lassen Nachfrage bestehen. Keine fertige Aufgabe
  bei fehlender Energie. Wartezeit pro wartendem Auftrag/Minute separat als
  Fahrzeugmangel oder unzureichende Fahrzeugenergie; Summen sind kein Flughafen-Delay.
- Ungesteuert: sofortiges Laden bis Ziel-SOC, FIFO-Belegung freier Ladepunkte,
  gemeinsame Leistung proportional. Fristenprioritaet: Ladepunktbelegung
  bevorzugt Fahrzeuge mit kleinstem positivem Energiedefizit zum naechsten Einsatz;
  Leistungsverteilung nach fruehester verbleibender Auftrag-/Parkhausfrist,
  bei Gleichstand Vorfeld. Ohne Ruest-/Kabelwechselzeit. **Heuristik, nicht Optimum.**
- Fahrzeugflotte und Parkhaus teilen Campus-PV/BHKW/Netz/Speicher. Grundlast zuerst;
  synthetisches Tagesprofil wie v1, jetzt nach lokaler Uhrzeit. PV-Kapazitaet
  konfigurierbar; 7 MWp Referenz ist Campusgesamtwert, nicht zusaetzlich zu P43/P44.
  Keine gemessene Wetter-/Lastkurve und keine verifizierte elektrische Topologie.
- Ladeabgang upstream: `kVA * Leistungsfaktor`. LV-Ladeleistung geteilt durch
  Trafo-Wirkungsgrad belastet Campusbilanz. Lade-/Speicherwirkungsgrad separat.
  Grid zuerst bis Limit, Speicher danach bis Reserve; nur Erzeugungsueberschuss
  laden, nie gleichzeitiges Laden/Entladen. Export bis Limit, Rest PV-Abregelung
  bzw. sichtbar nicht absetzbares exogenes BHKW. Kein Gruenstrom-/CO2-/Waermenachweis.
- Parkhaus: synthetische fixe Auftraege, jeweils eigener modellierter Ladepunkt,
  max. 275, gemeinsame Trafo-/Netzgrenze. `energy_kpis.charging_*` Bedarfs-/
  Erfuellungsfelder beziehen sich hier nur auf Parkhaus; Ladeverlustfeld auf
  alle Ladevorgaenge. Endogene Flottenenergie separat in `coupled_kpis`.
- StressEvents: Intervall `[start_min, end_min)`, reduzierte Netzimportgrenze
  und/oder Ausfall bestimmter Ladepunkte. Konkurrierende Ausfaelle duerfen
  vorhandene Ladepunkte nicht uebersteigen. Netzgrenze kann nur reduziert werden.
- Bereitschaft eines modellierten Abflugseintrags: alle **modellierten** Aufgaben
  rechtzeitig; nicht abgedeckte Klassen werden nicht stillschweigend geprueft.
  Nenner und Zahl unerledigter Aufgaben/Abfluege explizit. Unfertige Fristverletzung
  ist Untergrenze am Horizont; mittlere Service-Verspaetung separat nur abgeschlossene.
- Leistungswerte/Vehicle-State gelten fuer das Intervall bis zum Zeitstempel,
  SOC/Energie fuer dessen Ende. Campus-Serie 1 Minute, Fahrzeugtrace alle 5 Minuten,
  Chart-Stuetzstellen 5 Minuten. Telemetrie-ts relativ zum Modellstart; Evidence-Minuten
  relativ zur Verkehrstagmitternacht. Keine Zukunfts-Livezeit in Influx/Grafana.
- Interne Standardkriterien: Bilanzreste <= 1e-6, Reserveverletzungen/unerledigte
  Aufgaben 0, alle Aufgaben rechtzeitig, Grundlast/Parkhausfehlenergie/BHKW-Rest
  jeweils <= 0.001 kWh. Technische Gegenproben sind keine empirische Validierung.

## API, Grenzen und Nachweise

`GET /api/v1/munich/coupled-reference`: vollstaendige Defaults/Engine/Policies.
`POST /api/v1/munich/coupled-comparisons`:

```json
{"flight_plan_snapshot_id":"<64-stelliger Inhalts-Hash>","seed":42,"config":{}}
```

`config` kann Teilannahmen enthalten; der Backend-Default wird vor Queueing
vollstaendig eingefroren. Max. 4 Klassen/300 Fahrzeuge, 10.000 Missionen,
275 Parkhausauftraege, 20 Stoerungen und vorhandener Backlog-Guard (10 Runs).
Unbekannte Felder, NaN/Infinity, unmoegliche Energie/Fristen/Horizonte werden
abgewiesen. Plan fehlt 404, nicht bestaetigte Mehrfachgruppen 400, Formfehler 422.

Zwei normale Run-IDs (202), keine separate Ausfuehrungsinfrastruktur. `coupled_kpis`
additiv im Summary; Legacy-Spannung/Frequenz/Blackout/Schaltzeit bleiben
Shape-Platzhalter, keine Messwerte. SIL-/Domain-Guard bei Queue und Ausfuehrung.
Turnaround-Playbook bleibt auch fuer Config-Snapshots dieser Domaene gesperrt.

Artefakte: `missions.csv`, `departures.csv`, `vehicles.csv`, `parking.csv`,
`coupled-evidence.json`, `report.json`, `report.pdf`, `record.json`, Telemetrie.
`build_meta.result_artifact_hashes` und `/safety.audit.artifact_hashes_match`
pruefen die vollstaendige, versionsabhaengige Dateiliste, nicht nur vorhandene
Manifest-Eintraege. Neue Runs (`result_audit_version=coupled_evidence_v2`)
hashen alle fuenf Datenartefakte **plus `report.json` und `report.pdf`**.
Der bestehende Fingerprint prueft Request/Szenario/Model-Pack/Telemetrie.
`report_consistent_match` gleicht KPIs, Modellkriterien, Assertions,
Eingabe-Snapshots und Execution-Metadaten mit dem gespeicherten JSON-Bericht ab.
Fehlende Telemetrie, unvollstaendige Manifeste und widerspruechliche Ergebnisse
geben keine positive Vergleichsfreigabe; die UI zeigt einen Fehler statt KPIs.

Alte Runs behalten ihr urspruengliches Fuenf-Dateien-Manifest. Die UI kennzeichnet
sie als `data_and_report_consistency_v1`: Datenartefakte gehasht, Report-Konsistenz
geprueft, **kein urspruenglicher SHA256-Nachweis fuer PDF/JSON-Berichte**.
Unbekannte Versionen werden abgelehnt statt auf Legacy heruntergestuft.
Der JSON-Bericht enthaelt das vor seiner Erstellung verfuegbare Datenmanifest;
die beiden Bericht-Hashes stehen danach im finalen `record.json`. Nur dieses
zirkulaere Manifest wird beim Metadatenvergleich ausgenommen.
**Lokale Konsistenzpruefung, keine externe Signatur/Echtheitsgarantie oder
empirische Validierung.** Ein gemeinsam veraenderter Record und seine Dateien
werden durch diese lokalen Hashes nicht authentifiziert.
CSV schuetzt importierte Strings vor Spreadsheet-Formeln; HTML escaped Fremdtext.
Laufzeit-/Flugdaten und PDFs nicht ins oeffentliche Git-Repo stellen.

## Technische Abnahme vom 03.10.2026

- 172 Backend- und 60 Frontend-Tests bestanden, inklusive Handrechnung fuer
  wiederholten Einsatz eines Fahrzeugs, Energie-/Fahrzeugmangel, Netz-/Portausfall,
  Bilanz, DST, eingefrorener Wiederanlauf und mutierte Artefakte.
- ESLint, TypeScript, Ruff, Root-/Subpath-Build und unveraenderte Archive geprueft.
- Isolierter Regression-Smoke: alle acht Airport-Cases, Baseline, beide Planner-
  Referenzfaelle, vier Energie-v1-Vergleiche und FlexLab inklusive Fehlerpfaden.
  Kein Hardwarezugriff, leeres Influx-Token, temporaerer Testdatenspeicher.
- Lokaler realer Importtag: zwei abgeschlossene Runs, identischer Welt-Hash,
  Quellen-/Ergebnis-Audit und PDF/CSV/JSON verfuegbar. Details/Nullvorteil in
  [Produkt-Gates](PRODUCT_READINESS.md), keine empirische Abnahme.
- Browser: manuelle Auswahl/Bestaetigung, Compare, Flugnummernfilter,
  gespeicherter Vergleich nach Reload; 1440/390 px ohne Seitenueberlauf.
  HTML-Download und Inhalte geprueft. Lokale Datei-Vorschau ist im Testbrowser
  gesperrt; kein vorgetaeuschter visueller Browsernachweis fuer den HTML-Export.
- Geschuetzter Hetzner-Pilot: Code-Release
  `e1bdd97fc674ee0547bd9180d73433e561b7093e`, GitHub-CI gruen, eigene Daten
  vor Update privat gesichert. Derselbe importierte Tag und Welt-Hash liefern
  zwei abgeschlossene Runs inklusive Quellen-/Artefaktpruefung und Downloads
  in 15,74 Sekunden (Wallclock inkl. HTTPS und Download, kein SLA).
  Execution-Commit in beiden Records stimmt mit dem Release ueberein.
- Ausgeliefertes HTML und Muenchen-JS/CSS sind bytegleich zum geprueften
  Subpath-Build. HTTPS-Regression: Airport-Baseline/Guillotine/Schwarzstart,
  beide Planner-Referenzen, vier Energie-v1-Faelle und FlexLab bestehen.
  Ohne Anmeldung: UI, neue API und Ergebnisnachweis jeweils 401; bestehende
  Root-Weiterleitung unveraendert. Browserbild-Nachweis ist lokal, nicht eine
  behauptete gerenderte Ansicht hinter dem HTTPS-Login.

## Noch offen fuer ein professionelles Kundenprodukt

Ergaenzende Nachweispruefung vom 03.10.2026: 188 Backend- und 64 Frontend-Tests
bestanden, inklusive fehlender/manipulierter Dateimanifeste, mutierter KPIs,
Modellkriterien/Assertions/Execution-Commit und fehlender Telemetrie/Berichte.
Neue und aeltere Runs wurden im lokalen Dashboard getrennt geprueft.
Die Ergebnisanzeige nennt den Nenner der modellierten Abflugseintraege;
unvollstaendige numerische Eingaben sperren den Start.
1440px-/390px-UI-Smoke ohne horizontalen Seitenueberlauf, ESLint, TypeScript,
Ruff, Root-/Subpath-Build und Archivpruefung bestanden. Keine Hardwaretests.

[Produkt-Gates](PRODUCT_READINESS.md): reale, freigegebene Missionen/Fahrzeug-
und Energiedaten, getrennte Kalibrier-/Holdout-Pruefung, feste Kundenfrage und
Kontrollstrategie, Rechte, Lab-Versuchsvorschrift, Wirtschaftlichkeitsvertrag
und Mehrbenutzer-/Datenbankbetrieb. Kein Preis-/Verkaufsversprechen aus dieser Demo.
