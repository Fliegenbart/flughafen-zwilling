# Muenchen-Referenzpilot: freigegebener Implementierungsumfang

## Vertrag

Zusaetzlicher Arbeitsbereich `?workspace=munich`; Airport bleibt Default,
FlexLab bleibt separat. Keine Hardwarewrites. Kein kalibriertes FMG-Modell.
Oeffentliche Fakten bleiben im Quellen-Dossier; Betriebsparameter sind explizite
synthetische Annahmen. Keine CO2-, Kosten-, OTP- oder Schutztechnik-Aussagen.

## Umsetzung

1. `backend/app/munich/`: typisierte, begrenzte Annahmen; reproduzierbare
   Ladeauftraege; 24 Stunden in 5-Minuten-Schritten. Zwei getrennte Ladebereiche,
   Campusgrundlast, exogenes BHKW, PV (3 MWp Teilmenge von 7 MWp), optionaler
   hypothetischer Speicher. kVA * angenommener Leistungsfaktor als vereinfachte
   Wirkleistungsgrenze; keine Lastflussrechnung. Ladewirkungsgrad, Speicherverluste,
   Import/Export/Abregelung und nicht versorgte Grundlast bilanziert.
2. Beide Regeln teilen exakt dieselbe eingefrorene Welt. Baseline: sofortige
   Ladeanforderung mit proportionaler Leistungsbegrenzung. Vergleich: Busse zuerst,
   dann frueheste Frist, jeweils unter denselben Anschluss-/Bereichsgrenzen.
   Kein behauptetes globales Optimum. Gleiche Ergebnisse sind zulaessig.
3. Additive Domaene `airport_energy_v1` und Energie-KPIs im vorhandenen Run-Pfad.
   Vergleichs-API erzeugt zwei eingefrorene SIL-Runs im vorhandenen Worker.
   Herkunft, Annahmen, Auftraege und Welt-Hash bleiben im Record nachvollziehbar.
   Turnaround-Playbook fuer diese Domaene abweisen. Modellzeit nicht als kuenftige
   Livezeit in Influx schreiben. PDF/JSON/CSV ueber bestehenden Artefaktpfad.
4. `src/munich/`: eigene Command-/Compare-Ansicht, Versorgungsschema, Leistungs-
   und SOC-Verlauf, Ladefristen, Quellen und fehlende Echtdaten. Gleiche bestehende
   Sora/Mono-Typografie; Navy/Cyan/Amber; responsive, keine stillen Domaenenwechsel.
5. Tests: Bilanz und Energieerhaltung, Grenzen, Fristen, Reproduzierbarkeit,
   fairer Vergleich, Speicherverluste, keine erfundene PV-Gutschrift fuer initialen
   Speicher, API/Recovery/Audit/Artefakte, UI/Polling/Fehler/Routes. Alte Tests bleiben.
6. Docker-Demo neu bauen, lokalen 1440-/390px-Smoke und bestehende Demos pruefen.
   Doku mit tatsaechlichem Umfang aktualisieren. Archivintegritaet pruefen.
   Erst nach bestandenen Gates committen/pushen und Remote-Commit verifizieren.

## Nicht enthalten

Reale Netz-/Trafo-/Busdaten, Messdatenkalibrierung, Netz-/Waermeoptimierung,
Notstrom/elektrischer Schwarzstart, realer Klimanutzen, bestehender FMG-Zwilling-
Ersatz, HIL-Freigabe oder Flughafenpartnerschaft. Realdaten-Pilot benoetigt zuerst
`docs/MUNICH_DATA_REQUEST.md` und eine separat abgestimmte Versuchsvorschrift.
