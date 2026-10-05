# Zwei Arbeitsbereiche: Wiederherstellung und Abnahme

Stand: 2026-10-03, Europe/Berlin. Lokaler Methodenpilot, keine reale Hardware.

## Angeforderter Umfang

Airport Twin Core wieder zum Standard machen; die vorhandene FlexLab-Arbeit
bewahren und beide Anwendungen gemeinsam an Timo uebergeben. Kein erneuter
Fachwechsel, kein Nachbau angenommener fehlender Lab-Einzelgeraetetests.

- `/` und `?workspace=airport`: Flughafen, acht vorhandene Cases.
- `?workspace=flexlab`: unveraenderter FlexLab-Analysekern, getrennte Records.
- Sichtbarer Wechsel in beiden Oberflaechen, getrennte Pilotanleitungen.
- FlexLab-Vorstand auf GitHub gesichert: Tag
  `flexlab-workbench-v1-2026-10-03` zeigt auf
  `a17504188914132a87882ebf744d3e66c955f201`.
- `legacy/ems_baseline/` und `legacy/airport_grafana/` unveraendert.

## Dabei behobene Funktionsluecken

1. Der Airport-Entwicklungsstart benutzte ohne Runtime-Config Port 8000.
   Nun Same-Origin-Default; lokaler Backend-Fallback nur bei explizitem Opt-in.
2. Der Backend-PDF-Bericht lag nur im Datenvolume. Neuer additiver Downloadpfad
   `/api/v1/runs/{id}/artifacts/{name}` mit UUID-Pruefung und fester Whitelist.
   UI bietet PDF und CSV nach abgeschlossenem Run an.
3. Runs/Playbooks konnten veraenderte Katalogparameter statt ihrer urspruenglichen
   Eingaben verwenden. Neue Records speichern `scenario_snapshot` und
   `model_pack_snapshot` bei Queue-Eintritt; Suche, Validierung, Recovery und
   Audit-Recompute verwenden diese. Forecast aus einem neuen Run nutzt dessen
   eingefrorenen Kontext. Validierung bekommt ein job-spezifisches Modellprofil.
4. HTML-Export konnte den aktuell gewaehlten Fall statt des abgeschlossenen
   Runs benennen. Berichtskontext ist jetzt beim Start eingefroren; ein fremdes
   Playbook wird nicht ungeprueft in dessen Bericht gemischt.
5. Vergleichskarten in der schmalen Command-Rail ueberlappten. Karten stapeln,
   lange Run-ID-Links umbrechen, Chart-Panels nicht an der langen Rail strecken.
   `overflow: clip` verhindert unbeabsichtigtes Scrollen innerhalb der App-Shell.

Alte Records ohne Snapshots koennen verlorene Originaleingaben nicht nachtraeglich
rekonstruieren. Bei erneuter Ausfuehrung steht deshalb
`input_freeze=legacy_catalog_at_execution` im Record; keine rueckwirkende
Behauptung unveraenderter Originaldaten. Neue Records verwenden `input_freeze=queued`.

## Frische Verifikation

| Pruefung | Ergebnis |
| --- | --- |
| Frontend-Tests | 34 bestanden, inklusive Default/Deep-Links und eingefrorenem Berichtskontext |
| ESLint / strikter Typecheck / Produktionsbuild | erfolgreich |
| Backend-Tests | 94 bestanden, inklusive Input-Freeze, Download-Whitelist und Recovery nach Katalogaenderung |
| Archiv-SHA256-Manifeste | unveraendert |
| Compose-Konfiguration / Neubau | erfolgreich, Ports nur localhost |
| Airport Baseline + alle acht Cases | completed, KPIs, passende Audit-Fingerprints, PDF und CSV verfuegbar |
| Guillotine-/Schwarzstart-Planner | completed, Baseline/Empfehlung, modellintern gegengeprüfte KPIs, terminale Gegenprüf-Läufe und Artefakte |
| FlexLab-Smoke | Simulation, CSV-Import, Vergleich, Exporte und Abbruch erfolgreich |
| FlexLab-Fehlerprofile | Anschlusslimit korrekt FAIL; Telemetrieausfall korrekt Nicht bewertbar |
| Echter Backend-Neustart | FlexLab-Run mit derselben ID completed, recovery_count=1 |
| Browser | Airport/Guillotine/Schwarzstart und Playbook sichtbar erfolgreich; Wechsel zu FlexLab, neuer Test Bestanden |
| Responsive | 1440px/390px; bei 390px kein horizontaler Seitenueberlauf |

Lokale technische Referenzen, keine echten Lab-Messdaten:

- Airport Guillotine: `92f9b407e842427b9500e047e36c8dad`.
- Airport Schwarzstart: `6582f288164543148b0e01c7ef76917f`.
- Browser-Playbook Schwarzstart: `70fcecdc532b46838abf898b2243f696`.
- FlexLab-Browser-Test: `cc5a81c3-c797-4fa6-b083-455058d2da3a`.
- FlexLab-Neustart: `9041fdea-04ae-47c6-ae78-7b63893feeb4`.

## Was die Abnahme nicht belegt

**Kein empirisch validierter Flughafen-Zwilling und kein elektrischer
Schwarzstart-/Notstromtest.** Das aggregierte Gate-/Turnaround-Modell wurde
fachlich nicht erweitert oder kalibriert. Die kurzen Seeds ergeben weiter
sehr geringe Gate-Belegung und auf null gerundete abgeschlossene Abfluege.
Die Standard-Baselines erfuellen bereits die Schwellen; deshalb sind
Empfehlungen ohne Massnahmen und null Deltas korrekt, kein Optimierungsbeweis.

Keine neuen Live-Hardware-Connectoren, keine Anlagenwrites, keine Aussage,
dass FlexLab-Funktionen im bestehenden TestingLab fehlen. Timos eigener Rechner,
reale Versuchsdaten, Anlagenkalibrierung und Sicherheitsfreigabe sind nicht
Teil dieser lokalen Abnahme. Ein bekannter Starlette-Testclient-
Deprecation-Hinweis bleibt; die Tests bestehen.

Naechster fachlicher Schritt nur nach Abstimmung: konkrete gekoppelte
Flughafen-/Standort-Systemtestfrage, Kontrollmethode, Zeitmodell, Lasten,
Messsignale und erlaubte Eingriffe festlegen. Nicht stillschweigend den
Gate-Prototyp als Flughafen-Energiemodell verkaufen.
