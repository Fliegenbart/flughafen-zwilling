# Manueller Flugplanimport fuer Muenchen

## Bedienung

1. Den [offiziellen Saisonflugplan](https://www.munich-airport.de/saisonflugplan)
   als PDF herunterladen. Der einmal gepruefte Stand vom 02.10.2026 umfasst
   Sommer 2026 und Winter 2026/27. Der Link kann spaeter andere Staende liefern.
2. Im Arbeitsbereich `?workspace=munich` unter **Muenchner Flugplan** den
   Verkehrstag im Geltungsbereich und das PDF auswaehlen. **PDF importieren**
   ausloesen. Kein automatischer Abruf, kein API-Schluessel und kein Scheduler.
3. Stundenverteilung, Datum/Datenstand, Eintraege, PDF-Seitenbelege und Warnungen
   pruefen. Ankunft/Abflug oder Flugnummer, Airline, IATA und Terminal filtern.
4. Der ausgewaehlte Snapshot gilt als **Kontext fuer den naechsten Energievergleich**.
   Beide Runs erhalten denselben kompletten Snapshot. Bei bereits angezeigten
   Ergebnissen gilt weiter der eingefrorene damalige Kontext, nicht die neue Auswahl.
5. Flugplan-CSV/JSON sowie Run-Record, HTML-/PDF-Report herunterladen.
   `Kein Flugplan-Kontext` laesst bestehende Vergleiche unveraendert weiterlaufen.

## Was bereits echt ist, was noch nicht

**Echt ist ein importierter veroeffentlichter Saisonflugplan mit geplanten Zeiten.**
Der Parser verwendet bei Ankuenften die MUC-Ankunftszeit, bei Abfluegen die
MUC-Abflugzeit. Flugtage beziehen sich auf Muenchen; alle Zeiten sind Ortszeiten.
Geltung und Wochentage werden beruecksichtigt. Gegenflughafen-Zeiten am Vortag/
Folgetag verschieben nicht den Muenchner Verkehrstag.

**Noch nicht gekoppelt:** Energie-v1 nutzt den Flugplan nur als auditierbaren
Kontext. Er erzeugt weder Ladebedarf noch Busmissionen oder Flugverspaetungen.
Fahrzeugflotte, Auftraege, Energieverbrauch, Positionen und Flugzeugumlaeufe
fehlen weiterhin. Diese Angaben bleiben Annahmen oder benoetigen einen
freigegebenen FMG-Datenpilot. Ein Flugplan macht das Modell nicht kalibriert.

Unterschiedliche Flugnummern mit gleicher Richtung/Zeit/Verbindung koennen
Codeshare-/Mehrfacheintraege sein. Ohne Zuordnungsnachweis werden sie markiert,
nicht heuristisch zusammengelegt. Deshalb **Flugplaneintraege**, nicht eine
bestaetigte Zahl physischer Flugbewegungen. Exakt identische Zeilen werden
zusammengefasst, ihre PDF-Seiten erhalten.

Der manuelle Upload ist nicht extern beglaubigt. Die Referenz-URL benennt die
erwartete Quelle; Dateihash und Inhaltshash beweisen Konsistenz, nicht Herausgeber
oder Echtheit. Kein aktueller Live-Status, keine historischen Ist-Verspaetungen.
Vor einer dauerhaften automatisierten Nutzung oder Wiederveroeffentlichung
muss eine Daten-/Nutzungsvereinbarung geklaert werden.

## Vertrag und Schutz

- Parser `muc_season_pdf_v1`, Zeitzone `Europe/Berlin`; ISO-Ortszeit und UTC.
  Mehrdeutige/nicht existente Ortszeiten bei Zeitumstellung blockieren den Import.
- Maximal 6 MiB, 160 Seiten, 2 Mio. Textzeichen, 12.000 Saisonzeilen und
  2.500 Tageszeilen. Unlesbare Flugzeilen blockieren den gesamten Import.
- PDF-Text wird in einem separaten Unterprozess extrahiert, maximal 30 Sekunden.
  Der Upload selbst hat ein Zeitlimit von 15 Sekunden; keine Vergleiche waehrend
  des Imports oder des Ladens einer anderen Flugplan-Auswahl starten.
  Unter Linux zusaetzlich 512 MiB Adressraum und 20 Sekunden CPU-Zeit.
  Ein Import gleichzeitig. Keine URLs abrufen, PDF-Skripte/OCR ausfuehren oder
  Passwortschutz umgehen. Leeres Benutzerpasswort des oeffentlichen PDFs wird gelesen.
- Snapshots sind inhaltsadressiert und unveraenderlich; erneuter Import desselben
  PDFs/Tages verwendet denselben Snapshot und erhaelt die erste Importzeit.
- JSON unter `data/munich/flight_plans/`, im Demo-Datenvolume. Original-PDFs werden
  **nicht** gespeichert. Keine Flugplan-Betriebsdaten im oeffentlichen Git-Repo;
  Tests nutzen ausschliesslich erfundene Mini-Flugplaene.
- Bestehendes Backend bleibt genau ein Prozess. Kein Hardwarezugriff und keine
  Livezeit-/Influx-Eintraege fuer diese geplanten Tagesprofile.

## API

`POST /api/v1/munich/flight-plans?service_date=2026-10-03` mit PDF-Body und
`Content-Type: application/pdf` liefert HTTP 201 mit Snapshot.
`GET /api/v1/munich/flight-plans` liefert die gespeicherten Metadaten.
`GET /api/v1/munich/flight-plans/{snapshot_id}` liefert JSON samt Zeilen;
`GET /api/v1/munich/flight-plans/{snapshot_id}/export.csv` liefert CSV.

`POST /api/v1/munich/comparisons` akzeptiert optional `flight_plan_snapshot_id`.
Fehlender Snapshot: 404; korrupter gespeicherter Snapshot: 409; unbekanntes
PDF-Layout: 422; Dateigroesse: 413; Upload-Zeitlimit: 408; laufender Import: 429. Keine bestehende
Run-/Scenario-Schnittstelle wird ersetzt. Der `energy_world_hash` umfasst weiter
nur die Energie-Eingaben; der separate Flugplan-Inhaltshash und der Run-
Auditfingerprint belegen den mitgefuehrten Kontext.

## Naechster fachlicher Schritt

Auftraege aus dem echten Plan plus ausdruecklichen Einsatzannahmen ableiten;
Fahrzeug-SOC, Ladefenster, Energieverbrauch und Rueckkehrzeiten modellieren.
Erst dann kann fehlende Fahrzeugverfuegbarkeit nachvollziehbar Abfertigungen
verzoegern. Der Import ersetzt diese kausale Modellierung nicht.
