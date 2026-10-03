# Manueller Muenchen-Flugplanimport

**Freigegebener Umfang:** Ein offizielles Saisonflugplan-PDF manuell importieren,
einen Muenchner Verkehrstag auswaehlen und den unveraenderlichen Plan im
Muenchen-Arbeitsbereich anzeigen. Kein Scheduler, kein Live-Feed und keine
erfundenen Flugzeugumlaeufe. Die Energie-v1-Simulation bleibt unveraendert;
ein ausgewaehlter Flugplan wird vorerst als Kontext in beiden Runs eingefroren.

**Architektur:** Ein begrenzter PDF-Extraktionsprozess, ein strikt validierender
Tagesparser und ein lokaler Snapshot-Store. Die UI bietet PDF-Upload, Datum,
Auswahl gespeicherter Tage, Stundenverteilung und durchsuchbare Einzelzeilen.
Bestehende Airport-/FlexLab-Schnittstellen bleiben erhalten.

## Schritte und Abnahme

1. Parser-Tests zuerst: MUC-Zeitspalte, Wochentag/Geltung, Tageswechsel nur am
   Gegenflughafen, doppelte identische Zeilen, Codeshare-Unklarheiten,
   fehlerhafte Flugzeilen, unbekanntes Layout und Sommerzeitgrenzen.
2. `backend/app/munich/flightplan.py`: strikt typisierte Snapshots, Herkunft,
   PDF-SHA256, kanonischer Inhalts-Hash, Seitenbelege und Stundenwerte.
   Unverstaendliche Flugzeilen fuehren nicht zu einem scheinbar vollstaendigen Plan.
3. `backend/app/munich/flightplan_pdf.py`: pypdf in einem zeit-/speicherbegrenzten
   Unterprozess; maximal 6 MiB, 160 Seiten und 2 Mio. Textzeichen. Keine externen
   URLs, Skripte, OCR oder passwortgeschuetzten Dokumente ausfuehren/aufladen.
4. API-Tests zuerst: PDF-Upload, Duplikatimport, Persistenz nach Neustart,
   JSON-/CSV-Export, falsche Dateien/Datum/IDs und eingefrorener Run-Kontext.
   Endpunkte unter `/api/v1/munich/flight-plans`; Upload als PDF-Requestbody.
5. UI-Tests zuerst: manueller Import, Fehlermeldungen, Auswahl fuer den naechsten
   Vergleich, Filter, Quellen und klare Grenze zur noch synthetischen Simulation.
   Separates `src/munich/FlightPlanPanel.tsx`, kein Ausbau der grossen Hauptdatei.
6. HTML-/PDF-Report: optionaler Flugplan-Kontext mit Datum, Datenstand, Hash,
   Eintragszahlen und Hinweis auf fehlende Fahrzeug-/Umlaufdaten.
7. `data/munich/` ignorieren. Keine Original-PDFs oder kompletten Fremdflugplaene
   committen; Tests verwenden synthetische Mini-PDFs.
8. Qualitaet: alle Backend-/Frontend-Tests, Ruff, Lint, Typecheck, Root-/Subpath-
   Build und Archivintegritaet. Echtes offizielles PDF zusaetzlich lokal pruefen;
   PDF-Import und Fehlermeldung im Browser verifizieren.
9. Fertige Aenderungen committen/pushen, Remote-Commit und CI pruefen. Fuer die
   bereits freigegebene Demo nur eigene Container aktualisieren und Flugplan
   per manuellem Einmalimport bereitstellen; keine Netz-/Hardwarezugriffe.

## Modellgrenzen

Geplante Flugplaneintraege sind keine beobachteten Starts/Landungen. Unterschiedliche
Flugnummern zur gleichen Zeit sind ohne Umlauf-/Codeshare-Daten nicht automatisch
dasselbe Flugzeug. Deshalb werden solche Gruppen als ungeklaert markiert, nicht
heuristisch geloescht. Zeiten sind Ortszeiten `Europe/Berlin`; bei mehrdeutigen oder
nicht existierenden MUC-Zeiten wird der Import blockiert statt eine UTC-Zeit geraten.
Der Datenstand und importierte Verkehrstag bleiben unabhaengig von Modellzeit und
Abrufzeit. Der Plan erzeugt in diesem Schritt noch keine realen Busmissionen oder
Flug-OTP. Nutzungsrechte fuer Weiterverteilung/automatisierten Abruf bleiben zu klaeren.
