# Operations Studio: Design A fuer Airport Twin Core

Stand: 04.10.2026. Die visuelle Richtung A wurde vom Nutzer ausgewaehlt.
Diese Spezifikation beschreibt den Praesentationsumbau; eine Implementierung
oder ein Deployment ist damit noch nicht erfolgt.

## Ziel und Referenz

Die Flughafen-Oberflaechen werden vom dunklen Navy-/Glass-Cockpit zu einem
hellen, praezisen Engineering-Arbeitsbereich umgebaut. Ergebnisse, Konfiguration
und Nachweise erhalten eine klare Hierarchie statt vieler verschachtelter
Rahmen. Das ist ein Werkzeug fuer Systemtests, keine Marketing-Landingpage.

Verbindliche visuelle Referenz:
[A: Operations Studio](assets/2026-10-04-operations-studio.png), 1536 x 1024 px.
SHA-256: `c9228498053c9e047dca4f068219434b5751324c413f15f78349564f9e0ca5ff`.
Das Bild ist ein generierter Designentwurf, kein Laufzeit- oder Betriebsnachweis.
Die darin gezeigten Modellzahlen sind Beispiele, keine neuen Defaults.

## Umfang und Grenzen

- Gemeinsamer Flughafen-Rahmen in `src/WorkspaceApp.tsx` und dessen Styles.
- Airport-Standardansicht: acht Testfaelle, Runs, Telemetrie, Safety/Audit,
  Protokollinformationen und Playbook-Vergleich bleiben bedienbar.
- Muenchen: manueller Flugplanimport, gekoppelter Vergleich, Quellen und
  Einzelnachweise; der statische Energie-v1-Vergleich bleibt separat erhalten.
- Bestehende Frontend-HTML-Exporte erhalten dieselbe visuelle Linie ohne
  Aenderung ihrer Daten oder Auswertung. Backend-PDFs bleiben unveraendert.
- FlexLab behaelt seine eigene Oberflaeche, Fachlogik und read-only-Vertraege.
  Seine Route bleibt erreichbar; Flughafen-Styles duerfen nicht hineinwirken.
- Keine Aenderung an Backend, APIs, Payloads, Simulationskern, Worker,
  Kalibrierung, HIL-Vertraegen oder Freigaben. Keine neuen Hardwarewrites.
- Keine stille Domaenenumstellung. Default bleibt Airport Twin Core.

## Visuelles System

| Rolle | Festlegung |
| --- | --- |
| Arbeitsflaeche | Kuehles Off-White `#f4f6f8`, nicht Beige |
| Arbeitsbereiche | Weiss `#ffffff`, ruhige Trennlinien `#dde3eb` |
| Navigation | Graphit `#202832`, Text `#f3f5f8` |
| Haupttext | Dunkles Graphit `#102033` |
| Sekundaertext | Blaugrau `#5a6b80`, auch auf Weiss lesbar |
| Aktionsfarbe | Electric Blue `#2255ee` |
| Warnung | Dunkles Amber `#9a4a00` auf hellem Amber `#fff4df` |
| Fehler | Dunkelrot `#b42332`, nicht nur ueber Farbe erkennbar |
| Erfolg | Dunkelgruen `#176447`, nur fuer belegte passende Zustaende |
| Typografie | Lokal vorhandene Sora; IBM Plex Mono fuer IDs und Daten |
| Konturen | 1 px; Ecken meist 6 px, keine durchgaengigen Pillen |
| Raster | 8-px-Abstaende, 24-px-Hauptgutter, keine Card-in-Card-Kaskaden |

Titel etwa 30-32 px, Abschnittstitel 18-20 px, UI-/Tabellentext 13-14 px,
Metadaten mindestens 12 px. Controls bekommen explizite Schriftgroessen.
Primaeraktionen blau; Sekundaeraktionen weiss mit ruhiger Kontur. SVG-Icons
werden konsistent und sparsam eingesetzt, nie statt eines benoetigten Labels.
Keine Glasflaechen, Neon-Glows oder Gradient-Buttons. Das dezente Off-White
der Referenz ist kein Anlass fuer zusaetzliche dekorative Verlaufseffekte.

## Arbeitsbereich und Navigation

Bei Desktopbreite steht eine etwa 208 px breite Graphit-Navigation links.
Sie zeigt Airport Twin Core sowie die bestehenden Links Flughafen, Muenchen
und FlexLab. Auswahl, Fokus und aktueller Arbeitsbereich sind klar erkennbar.
URL-Parameter, Subpath `/airport/`, Lazy Loading und Dokumenttitel bleiben
funktional erhalten. Auf der FlexLab-Route bleibt der bestehende separate
Rahmen erhalten; der neue Rail-Rahmen gilt nur fuer Flughafenansichten.

Der Arbeitskopf enthaelt einen kompakten Titel, Kontext und Hauptaktionen,
keinen grossen Marketing-Hero. Modellgrenze und SIL-Kontext bleiben sichtbar.
Technische API-Einstellungen duerfen in eine eindeutig beschriftete
Aufklappsektion wandern, aber nicht entfallen.

## Muenchen-Arbeitsflaeche

Die Referenz wird als fokussierte Arbeitsflaeche umgesetzt:

1. Kopf: Flugplan, Flotte & Energie; Bericht und Vergleich starten.
2. Kontext: ausgewaehlter Verkehrstag, Seed, manueller Flugplan und
   nicht kalibrierter Modellstatus.
3. Ablauf: Flugplan, Flotte, Energie, Vergleich. Dies ist Navigation zu den
   vorhandenen Bereichen, keine neue fachliche State-Machine.
4. Links Testkonfiguration, rechts Vergleich und Ergebnisnachweise.
5. Darunter vorhandene Leistungs-/SOC-/Queue-Verlaeufe, Auftragstabelle,
   Filter, Run-IDs, Artefakte und Quellen in derselben visuellen Sprache.

Die zwei Laderegeln sind der bestehende feste Vergleich, kein neuer
auswaehlbarer Optimierer. Wo der Entwurf eine scheinbar editierbare Auswahl
zeigt, wird eine sachlich korrekte Zusammenfassung genutzt, sofern die
bestehende API dort keine Auswahl vorsieht. Alle aktuellen Flotten-, Netz-,
Lade-, Speicher-, Stress- und Seed-Eingaben bleiben erreichbar und erhalten
ihre bestehenden Handler, Einheiten und Validierungen.

Der gekoppelte und der statische Energie-v1-Test duerfen weder Eingaben noch
Run-Ergebnisse vermischen. Der statische Vergleich erhaelt einen eigenen,
klar benannten Bereich. Gespeicherte Ergebnisse kennzeichnen weiterhin den
eingefrorenen Versuch und nicht die inzwischen geaenderte Konfiguration.
Manueller Import, Behandlung ungeklaerter Gruppen und notwendige bewusste
Bestaetigungen bleiben erhalten.

## Ergebnis- und Auditdarstellung

Baseline und Fristenprioritaet bilden einen gemeinsamen Vergleichsbereich
mit klar getrennten Spalten. Die wichtigste Differenz steht dazwischen.
Weitere KPIs bleiben als lesbare Zeilen und Tabellen statt weiterer
verschachtelter Kacheln verfuegbar.

- Prozentwerte enthalten weiterhin Zaehler und Nenner sowie die Bezeichnung
  modellierte Abflug-Aufgabenbereitschaft. Sie werden nicht als reale OTP
  oder TOBT umbenannt.
- Null-Deltas bleiben neutral; ein Vorteil wird nicht erfunden. Negative
  Ergebnisse und nicht erfuellte Modellkriterien bleiben sichtbar.
- Technisch completed ist nicht gleich fachlich PASS.
- Welt-/Seed-Gleichheit, gepruefte Artefakte und Modellkriterien werden
  getrennt dargestellt. Hash-Pruefung ist kein empirischer Nachweis.
- Die beispielhaften 7 Dateien werden nie statisch eingebaut: Anzeige folgt
  dem vorhandenen Audit, einschliesslich schwaecherer Legacy-Nachweise.
- Bei fehlenden oder unpassenden Nachweisen gelten die bisherigen Guards:
  keine Anzeige scheinbar validierter Ergebnisse und kein PASS.
- Vor einem Run keine erfundenen KPIs; eine klare leere Ergebnisansicht
  erklaert, wie der Vergleich erzeugt wird.
- Lade-, Queue-, Fehler-, Abbruch- und Recovery-Zustaende bleiben sichtbar;
  zentrale Aktionen erhalten ihre bestehenden Disabled-Bedingungen.

Das Versorgungsschema bleibt ausdruecklich schematisch. Die Darstellung muss
die vorhandenen parallelen Quellen und Lastbereiche sachlich erhalten;
die horizontale Iconfolge im Entwurf ist kein elektrischer Serien-Netzplan.
Keine Flughafenkarte, Echtzeitbewegung oder neue Netz-Topologie erfinden.

## Airport-Standardansicht

Dasselbe System wird auf den vorhandenen Arbeitsablauf uebertragen:
kompakter Run-Kopf, gut lesbare Szenariokonfiguration, KPI-Band, Verlaeufe,
Baseline/Empfehlung/Pareto-Vergleich und technische Nachweise. Alle acht
Testfaelle bleiben erhalten. Planner-Capability-Gating und Polling bleiben
unveraendert. Unvalidierte Empfehlungen behalten ihre Kennzeichnung.

Chart-Achsen, Grid, Legenden und Tooltips werden fuer helle Flaechen angepasst.
Es werden keine Datenreihen, Schwellen oder Zeit-/Einheitenkontrakte geaendert.
Run-ID und Fortschritt bleiben gut auffindbar. Simulierte Adapter und Grafana
werden nicht als reale Flughafen-Telemetrie dargestellt.

## Komponenten und Datenfluss

Die Umsetzung bleibt React, CSS und Recharts mit lokalen Fontsource-Fonts.
Der gemeinsame Flughafen-Rahmen ist fuer Navigation und Layout zustaendig.
Feature-Komponenten behalten die vorhandenen Requests, State-Hooks,
Polling- und Exporthandler. Praesentationsbausteine fuer Kopf, Buttons,
Hinweise und Ergebniszeilen werden klein und klar getrennt gehalten.
Bestehende Dateien werden nur soweit strukturiert, wie es der Designumbau
erfordert; keine unabhaengige Backend- oder App-Neuschreibung.

Alle sichtbaren Werte werden aus vorhandenen Records/States abgeleitet.
Eingefrorene Ergebnisse und editierbare Eingaben bleiben unterschiedliche
Quellen. Rasterbilder sind nur die Designreferenz: keine Screenshot-UI,
keine nicht funktionierenden Mockup-Controls in der laufenden App.

## Responsive und Accessibility

- Ab 1280 px: volle Navigation, Konfiguration und Ergebnis nebeneinander.
- Von 768 bis 1279 px: kompakte obere Navigation; Arbeitsraster darf bei
  Platzmangel einspaltig werden. Keine permanent zu schmale Ergebnisflaeche.
- Unter 768 px: obere Navigation, Konfiguration und Ergebnisse gestapelt;
  Baseline und Vergleich ebenso. Tabellen duerfen innerhalb ihres eigenen
  Bereichs horizontal scrollen, nie die gesamte Seite.
- Pruefbreiten: 1536, 1440, 1024 und 390 px; zusaetzlich Browser-Zoom 200 %.
- Semantische Ueberschriften, Labels, Tastaturbedienung, sichtbarer Fokus,
  Statusmeldungen und nicht nur farbliche Fehlerkennzeichnung.
- Textkontrast mindestens 4,5:1, grosse Texte 3:1. Falls ein angenaeherter
  Referenzfarbwert das nicht erfuellt, ist der Kontrast gezielt zu korrigieren.
- Kleine einmalige Entry-Animationen maximal 160-220 ms, keine Daueranimation;
  `prefers-reduced-motion` wird respektiert.

## HTML-Exporte

Bestehende Datenquellen, Case-Namen, KPI-/Delta-Berechnung, Fehlermarkierung,
Auditnachweise und Escaping bleiben erhalten. Heller Reportkopf, ruhige
Tabellen, blaue Akzente und klare Warnungen folgen der Referenz. Keine neuen
CDN- oder Font-Netzabhaengigkeiten; fuer portable Exporte robuste Fallbacks.
Die Druckansicht bleibt weiss und lesbar. Keine Compare-Daten erfinden,
wenn kein Playbook oder gekoppelter Vergleich vorliegt.

## Abnahme vor Fertigmeldung

1. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
2. `sh scripts/check-recovery.sh`; Archive bleiben unveraendert.
3. UI-Regression fuer Navigation, acht Cases, Run-Control, Planner-Gating,
   Baseline/Pareto, Flugplanimport, gekoppelte/statische Trennung und Auditfehler.
4. Browserpruefung an den genannten Breiten: alle Bereiche, Eingaben,
   Tabellen, Warnungen, Fokus und funktionaler Run-/Report-Workflow.
5. Vergleich zwischen Referenz und Browserbild: Navigation, Typografie,
   Palette, Raster, Controls und Ergebnis-/Nachweistabellen. Bewusste
   fachlich notwendige Abweichungen werden dokumentiert, nicht verschwiegen.
6. Keine Hardware, keine Messdaten-/Kalibrierungsbehauptung. Wenn ein
   Backend-Smoke erforderlich ist: SIL und leerer Influx-Token.
7. Nur gepruefte zugehoerige Dateien committen und pushen; Remote-SHA pruefen.
   Lokale Dubletten, Betriebsdaten und Companion-Zustandsdateien bleiben draussen.

Die Designfreigabe ersetzt keine Deployment-Abnahme. Ein spaeteres Deployment
muss den geschuetzten Hetzner-Pilot und vorhandene Daten beibehalten sowie den
tatsaechlich ausgelieferten Build und die relevanten Workflows pruefen.
