# Operations Studio: Implementierungsreview

Stand: 04.10.2026. Scope: freigegebenes Design A fuer Airport Twin Core und
Muenchen; reine Praesentationsaenderung. FlexLab, Backend, API-Vertraege,
Seeds, Worker, Simulation, HIL-Freigaben und Backend-PDFs bleiben unveraendert.

## Pruefstand

- Ausgangspunkt: freigegebene Spezifikation und Plan im selben Verzeichnisbaum.
- Visuelle Referenz: `../specs/assets/2026-10-04-operations-studio.png`;
  SHA-256 `c9228498053c9e047dca4f068219434b5751324c413f15f78349564f9e0ca5ff`.
- Gepruefter Implementierungscommit: `e755f175f710d7b9fb1855a1d68fa8956b90439f`.
- Tasks 1 bis 7 wurden einzeln implementiert und durch unabhaengige
  Spezifikations- und Qualitaetsreviews geprueft. Gefundene Darstellungsfehler
  wurden vor dem Handoff repariert; keine offenen Findings im freigegebenen Scope.
- Isolierte Docker-Demo: `docker-compose.demo.yml`, Projekt
  `airport-studio-qa`, UI-Port 5186, API-Port 8016, eigener Daten-Volume.
  Genau ein Uvicorn-Prozess, leerer Influx-Token, kein Monitoring-Overlay und
  keine angeschlossene Hardware. Bestehende Volumes wurden nicht geloescht.
- Ausgelieferter Frontend-Asset wurde mit dem gebauten Container abgeglichen.
  Die folgenden UI-Pruefungen betreffen diesen Build, nicht nur Vite/JSDOM.

## Automatische Regression

| Pruefung | Ergebnis |
| --- | --- |
| `npm run typecheck` | bestanden |
| `npm run lint` | bestanden, keine Warnungen |
| `npm run test` | 79 Tests in 9 Dateien bestanden |
| `npm run build` | bestanden |
| `TWIN_UI_BASE_PATH=/airport/ npm run build` | bestanden |
| `sh scripts/check-recovery.sh` | Archivsnapshots unveraendert |
| `git diff --check` | bestanden |
| Backend `pytest -q -p no:cacheprovider` | 188 Tests bestanden |
| Backend `ruff check --no-cache app/munich app/lab` | bestanden |

Backend-Tests liefen in einem vorhandenen Testcontainer mit schreibgeschuetztem
Checkout, ohne Netzwerk, mit temporaerem Datenpfad und leerem Influx-Token.
Eine bestehende Starlette/TestClient-httpx-Warnung bleibt. Beim Subpath-Build
bleibt die bekannte Warnung zur nicht-modularen `runtime-config.js` erhalten.

## Funktionale Browser-Abnahme

- Airport: alle acht Cases vorhanden; Guillotine und Schwarzstart explizit
  als SIL gestartet, beide terminal `completed`. Ausfuehrungsstatus und
  Modellkriterien werden getrennt angezeigt. Keine Mess-/Betriebsvalidierung
  daraus abgeleitet. Vor dem ersten Ergebnis zeigen KPI-Karten `n/a`, nicht 0.
- Planner: Capability-Gate, Start, Polling und terminaler Vergleich geprueft.
  Baseline, Empfehlung und vier validierte Pareto-Alternativen mit vollstaendigen
  Validation-Run-Links und Artefaktlinks sichtbar. Gleiche Werte erzeugen
  neutrale Null-Deltas, keine erfundene Optimierungswirkung.
- Nach Wechsel auf Schwarzstart bleibt der vorherige Guillotine-Playbook-Vergleich
  mit eigenem Szenario/Model-Pack/Seed und explizitem eingefrorenen Versuch markiert.
- Muenchen: manuell importiertes, ausdruecklich synthetisches Zwei-Zeilen-QA-PDF;
  fixierter Verkehrstag 03.10.2026. Kein automatischer Abruf und kein Import
  beim geschuetzten Pilot. Nach Reload kein automatischer Vergleichsstart.
- Gekoppelter Vergleich: beide Nachweisruns terminal, Quellen und vollstaendige
  Run-IDs vorhanden. Das kleine Fixture erzeugte gleiche Ergebnisse; Delta 0
  blieb neutral. Diese Werte sind keine Aussage ueber echten Muenchner Betrieb.
- Eingabeaenderung nach Abschluss: eingefrorener Ergebnis-/Schemakontext bleibt
  getrennt. HTML-Inhalt verwendet weiter den alten Netzparameter, nicht die
  nachtraeglich editierte Eingabe.
- Energie-v1: separat gestarteter Baseline-/Prioritaetsvergleich mit eigenem
  Netzlimit und beiden terminalen Ergebnissen. Coupled-Kontext nicht ueberschrieben.
  Ein `completed`-Run mit nicht erfuellten Modellkriterien bleibt sichtbar FAIL.
- Auftragsfilter, Filter fuer verfehlte Missionen, aufklappbare Methodik und
  erweiterte Annahmen bedient. Quellen-, CSV-/PDF-/Reportlinks bleiben auffindbar.
- FlexLab-Navigation geprueft: eigener bestehender Rahmen, kein `data-studio`,
  read-only-Kontext bleibt. Keine Hardwareaktionen ausgefuehrt.

## Responsive und Accessibility

- Tatsaechliche Viewports: 1536 x 1024, 1440 x 1000, 1024 x 900,
  390 x 844; zusaetzlich 768 x 512 als Reflow-Pruefung.
- Befuellte Airport- und Muenchen-Ansichten geprueft, nicht nur leere Karten.
  Dokumentbreite entspricht Viewportbreite. Breite Audit-/Pareto-Tabellen
  scrollen in ihrem lokalen, tastaturfokussierbaren Wrapper.
- Reparaturen: lokale Audit-/Pareto-Wrapper; korrekte Workflow-Selektoren;
  gekuerzte und aufklappbare Konfiguration/Methodik; nach Resize verbleibende
  unsichtbare Recharts-Tooltips werden im Chart begrenzt.
- Skip-Link fokussiert `studio-main` mit sichtbarer Kontur. Native Summary-
  und Select-Aktionen mit Tastatur geprueft; Formulare/Import bleiben bedienbar.
- Berechnete zentrale Kontraste: Haupttext/Weiss 16,45:1,
  Sekundaertext/Off-White 5,04:1, Weiss/Blau 5,83:1,
  Navigation 14,88:1, Erfolg/Weiss 7,12:1, Warnung/Weiss 6,26:1.
- Keine Console-Fehler oder Warnungen in der finalen Airport-Abnahme.

**Verbleibende manuelle Grenzen:** Das IAB bietet kein aktivierbares
200-%-Zoom- oder Reduced-Motion-Emulationsinterface. Der native Zoom-Shortcut
veraenderte den Viewport nicht; 768-px-Reflow ist kein Ersatznachweis fuer echten
200-%-Zoom. Die geladene `prefers-reduced-motion`-CSS-Regel wurde gelesen
(Animation/Transition aus, Scrollverhalten auto), aber nicht aktiv emuliert.
Viewport-Overrides wurden vor dem Handoff zurueckgesetzt.

## Bildvergleich mit Design A

Referenz und aktueller 1536-px-Browser-Screenshot wurden direkt angesehen.
Private Screenshots und Downloads werden nicht im Repository veroeffentlicht.

| Punkt | Soll / Ist / begruendete Abweichung |
| --- | --- |
| Navigation | 208-px-Graphitrail umgesetzt; Flughafen/Muenchen/FlexLab bleiben echte vorhandene Ziele. |
| Typografie | Lokale Sora fuer UI, IBM Plex Mono fuer IDs; kein externer Fontabruf. Metadaten mindestens 12 px. |
| Palette | Off-White, weisse Flaechen, Graphit und Electric Blue statt Navy-Glas/Neon. Statusfarben nur fuer belegte Zustaende. |
| Raster | 286-px-Testkonfiguration neben Vergleich/Nachweisen; mobile einspaltige Darstellung. Mehr vorhandene Guards als im Entwurf. |
| Kopf / Aktionen | Kompakter Arbeitskopf, blaue Primaeraktion, Workflow mit neutralen inaktiven Schritten und Verbindern. |
| Baseline / Nachweise | Gemeinsame Baseline-/Prioritaetsflaeche und Delta; volle IDs, dynamische Hash-Anzahl, Legacy-PDF-Warnung. Keine Beispielzahlen als Livewerte. |

Das Energieschema zeigt parallele Erzeugungs-/Speicher-/Lastbeziehungen aus dem
eingefrorenen Modell, nicht die fachlich falsche Serienanordnung des Bildentwurfs.
Das feste bestehende Regelpaar wird ehrlich benannt, nicht als Scheinauswahl.
Mehr echte Details liegen in aufklappbaren Bereichen; keine Guard-Entfernung
zugunsten einer kuenstlich kuerzeren Seite.

## Frontend-HTML-Reports

Alle drei bestehenden Exporte nutzen portable helle Report-Styles. Tests decken
Theme, Druckregeln, vorhandene Guards, eingefrorenen Kontext und Planner-Compare
ab. Muenchen-Coupled- und Energie-v1-HTML-Dateien wurden tatsaechlich heruntergeladen
und inhaltlich geprueft: IDs, Parameter, Warnungen und Print-CSS erhalten;
keine externen CSS-/Font-URLs. Private Dateien bleiben ausserhalb von Git.

Die Airport-Blob-Navigation wurde durch die Browser-Sicherheitsrichtlinie
blockiert. Kein anderer Browser, neuer Preview-Server oder Sicherheitsbypass
wurde eingesetzt. Eine visuelle Reportvorschau ist deshalb nicht abgenommen;
HTML-Inhalt/Styles und automatisierte Tests sind geprueft. Backend-PDFs bleiben
unveraendert.

## Scope und offene Folgeschritte

- Git-Diff enthaelt nur freigegebene UI-, Test-, Referenz- und Dokumentationsdateien
  sowie die lokale Companion-Ignore-Regel. Keine fachlichen Backend-/Seed-/FlexLab-
  oder Archivdateien; keine Zugangsdaten, Betriebsdaten, PDFs oder Voll-Logs.
- Die sieben bekannten lokalen Dateikopien wurden nicht veraendert oder gestagt.
- Bestehender npm-Audit-Befund: vier hohe transitive Dev-/Test-Abhaengigkeitsbefunde
  (braces, expect, jest-message-util, micromatch). Kein blinder Dependency-Upgrade
  in diesem Praesentationsscope; separat pruefen und beheben.
- Git-Handoff erfolgt als Review-PR gegen `codex/recovery-audit`; Remote-SHA wird
  nach dem Push geprueft. Kein automatischer Merge und kein Hetzner-Deployment.
- Flughafenmodell bleibt unkalibrierter Methodenprototyp. SIL-Erfolg ist weder
  empirische Validierung noch ein Betriebs-, Einspar- oder Produktreifeversprechen.
