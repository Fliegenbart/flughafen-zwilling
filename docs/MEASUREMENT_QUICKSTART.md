# Lastprofil und Messdaten: in drei Schritten

1. Auf der Flughafen-Startseite einen Vergleich berechnen. Unter **Das Ergebnis
   selbst ueberpruefen** eine Variante waehlen, dann **Lastprofil & Messdaten
   oeffnen**. Gespeichert wird nur die Simulation, keine Messung. Das Profil
   gehoert zum eingestellten Anschluss, nicht zur separat gesuchten Mindeststufe.
2. **Lastprofil herunterladen** liefert berechnete kW-Minutenmittelwerte.
   **Leere Messvorlage herunterladen** liefert dieselben Zeitstempel ohne
   Messwerte. Zum Ausprobieren unter **Zum ersten Mal hier?** die ausdruecklich
   synthetische Uebungsdatei herunterladen und rechts als Datei auswaehlen.
3. Messgrenze und Zeitsemantik bestaetigen, **Messdaten vergleichen** klicken.
   Kurven, mittlerer absoluter/gerichteter Fehler, Energie und Leistungsspitzen
   werden lokal berechnet. Ergebnis bei Bedarf als JSON herunterladen.

## Datenvertrag und Grenzen

- Eigene Datei: UTF-8 CSV, `timestamp,measured_kw`, Komma als Trennzeichen,
  Dezimalpunkt, kW. ISO-Zeit mit expliziter Zeitzone; jedes Feld bezeichnet den
  Mittelwert der Minute, die an diesem Zeitpunkt endet.
- Vollstaendiges, identisches Zeitraster der Simulation, mindestens 60 Werte.
  Keine Luecken, Duplikate, negativen Bezugs-/Ladeleistungen, NaN oder Inf.
  Keine Interpolation, Zeitverschiebung oder Einheitenumrechnung. Maximal 5 MiB.
- Die Datei wird nur im Browser gelesen. Kein Upload, keine lokale persistente
  Speicherung, keine Hardwarewrites. Beim Neuladen muss sie erneut ausgewaehlt
  werden. Ein heruntergeladener Vergleich enthaelt die Dateimesswerte; behandeln
  Sie diesen Export entsprechend ihrer Vertraulichkeit.
- Uebungsdateien enthalten `data_kind=synthetic_exercise` und absichtlich
  veraenderte Modellwerte (+5 % +1 kW). Sie sind nicht unabhaengig; der formale
  Pilot-Import lehnt diese zusaetzliche Spalte ab.
- Der Schnellvergleich ist immer eine **Diagnose**, nie PASS/FAIL,
  Modellvalidierung oder Betriebsfreigabe. Ein Nullfehler beweist keine
  unabhaengige Messung. Die Herkunft hochgeladener Dateiinhalte ist nicht
  verifiziert; die Daten bleiben lokal, trotz des allgemeinen Begriffs Import.
- Keine vorbereiteten Pruefauftraege, automatische Kalibrierung oder
  Anlagensteuerung. Ein realer Versuch erfordert passende Messgrenzen und
  separate Freigabe durch den Anlagenbetreiber.

## Bestehender formaler Ablauf

Unter **Formalen Nachweis mit Pruefkriterien und gespeicherten Daten fuehren**
bleibt die bisherige serverseitige Projekt-/Holdout-Pruefung unveraendert
erreichbar. Erst beim ersten Aufklappen wird sie geladen. Ihre Eingaben bleiben
beim Zuklappen erhalten. Dort werden Dateien auf dem Server gespeichert;
vertrauliche Daten gehoeren nicht in die geteilte oeffentliche Demo.

## Read-only API

`GET /api/v1/runs/{run_id}/measurement-profile?metric=grid_import_kw`

Weitere erlaubte Metriken: `ground_charging_kw`, `parking_kw`. UUID, abgeschlossener
gekoppelter Lauf und bestehende Sicherheits-/Artefaktpruefung erforderlich.
Ausgabe: `points[{timestamp,model_kw}]`, kW, 60 Sekunden, `interval_end_mean`,
Run-ID, Provenienz mit Artefakt-SHA256. Die Instanz-Authentifizierung gilt auch
hier; keine neue ungeschuetzte Ausnahme. Der GET legt keine Datensaetze an.
