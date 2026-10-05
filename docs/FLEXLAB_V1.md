# FlexLab Workbench v1

## Auftrag und Grenze

Lokaler, messdatenbasierter Testarbeitsplatz fuer Lade- und Flexibilitaetsversuche.
Keine Live-Ansteuerung, keine behauptete Hardwarekalibrierung, keine autonome
Optimierung. Das vorhandene Airport-Modell bleibt unter `?workspace=airport`
erreichbar und seine API bleibt unveraendert.

## Nutzbarer Ablauf

1. Referenz-Pruefstand konfigurieren und Leistungssprung, Flex-Abregelung,
   Anschlusslimit oder Telemetrieausfall deterministisch simulieren.
2. Eigene CSV mit `ts_s,power_kw,setpoint_kw,limit_kw` importieren. Sekunden
   relativ zum Versuchsbeginn; Leistung in kW; leere Ist-Werte sind Datenluecken.
3. Ist/Soll/Limit als Zeitverlauf und dimensionsrichtige KPIs auswerten.
4. Akzeptanzkriterien vor dem Lauf einfrieren. Mangelhafte Daten ergeben
   `inconclusive`, nie einen scheinbar bestandenen Test.
5. Persistierte Historie, vergleichbare Baseline, CSV/JSON/HTML-Evidenzexport.

## Vertrag

- `/api/v1/lab/catalog`: Testfaelle, Referenz-Pruefstand und Importvertrag.
- `/api/v1/lab/runs`: GET Historie, POST Simulation.
- `/api/v1/lab/imports`: POST CSV als JSON (`filename`, `csv_text`,
  `case_id`, `bench`, `criteria`, `label`). Max. 5 MB / 100.000 Zeilen.
- `/api/v1/lab/runs/{id}`: Status und eingefrorene Konfiguration.
- `/api/v1/lab/runs/{id}/trace`: Messpunkte, auch waehrend Simulation.
- `/api/v1/lab/runs/{id}/cancel`: kooperativer Abbruch.
- `/api/v1/lab/runs/{id}/artifacts/{name}`: `record.json`, `trace.csv`, `report.html`.
- `/api/v1/lab/template.csv`, `/api/v1/lab/example.csv`: dokumentierter Import.

Persistenz unter `data/lab/runs/`, ein lokaler serieller Worker. Neustart setzt
unfertige Laeufe mit derselben ID zurueck und fuehrt sie neu aus. Kein
Multiprozessbetrieb. Importierte Rohdaten bleiben lokal und werden nicht
committet. Status: queued/running/completed/failed/cancelled.

## Auswertung

- Energie: Trapezintegration nur ueber valide, zeitlich abgedeckte Intervalle;
  getrennt bezogen/eingespeist, keine Interpolation ueber Datenluecken.
- Tracking: zeitgewichtete absolute Abweichung nach definierter Einschwingfrist.
- Limit: Ist-Leistung oberhalb aufgezeichnetem Limit + Toleranz; Dauer ueber
  beobachtete Intervalle, unbekannte Intervalle sind kein PASS.
- Reaktion: anhaltende Toleranzbandeinhaltung nach Sollwertspruengen.
- Qualitaet: Zeitabdeckung, Fehlwerte und maximale Luecke; unzureichende
  Datenqualitaet hat Vorrang vor einem PASS/FAIL.
- Abtastabdeckung gegen das vorab deklarierte Messintervall wird ebenfalls
  geprueft. Eine zu duenn abgetastete Reihe kann nicht allein durch ihre
  Anfangs-/Endzeit als vollstaendig gelten. Simulation hat feste 1-s-Abtastung.
- Ein Fallname ist kein Nachweis eines Versuchs: Sollwertanstieg, Abregelung,
  Limitabsenkung bzw. fehlende Telemetrie muessen im aufgezeichneten Trace
  vorkommen. Sonst ist dieser Fall nicht bewertbar. Die Auswertung bestaetigt
  damit eine Trace-Eigenschaft, keine unabhaengige Anlagenvalidierung.
- Vergleich nur bei gleichem Testfall, Kriterien, Pruefstand und Soll-/Limittrace.
  Deltas beschreiben beobachtete Unterschiede, keine kausale Wirksamkeit.
- Vergleichbare Methodenversion wird im Fingerprint eingefroren; bei spaeteren
  Aenderungen der KPI-Definition muss die Methodenversion angehoben werden.
- Datei-SHA256 bezieht sich auf den gespeicherten UTF-8-CSV-Text, nicht auf eine
  Sensor-Signatur. Backend-Quellhash dokumentiert die tatsaechliche Auswertungssoftware.

## Abnahme

Bestehende Airport-Tests bleiben gruen. Neue Tests fuer Parser, Integration,
Qualitaetsgates, Ranking-freien Vergleich, Persistenz/Recovery/Abbruch und
UI-Flows. Docker-Start, echter CSV-Import und Export im Browser pruefen;
Desktop und 390 px ohne Overflow. Hell gestaltete Instrumentenoberflaeche,
Sora/IBM Plex Mono, klare Source-/Read-only-Kennzeichnung.

## Datenqualitaets-Grenzen (Stand 04.10.2026)

Backend und Formular pruefen dieselben Grenzen: Mindestabdeckung `min_coverage_pct`
90–100 %, `max_gap_s` hoechstens 300 s, mindestens `expected_interval_s` und
hoechstens das 10-fache davon. Unzulaessige Werte werden vor dem Start abgewiesen.

- `circular`: Ist die Messreihe eine Kopie des Sollwerts, ist der Vergleich zirkulaer
  und ergibt **nie** pass.
- `reaction`: Bleibt nach einem Sollwertsprung jede messbare Reaktion aus, ist der Fall
  nicht bestanden bzw. nicht bewertbar – nie pass.
