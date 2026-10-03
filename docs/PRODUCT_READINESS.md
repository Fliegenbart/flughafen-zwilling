# Airport Twin Core: Produktprogramm fuer einen bezahlten E.ON-Pilot

## Ziel und Grenzen

Ein professionelles Entscheidungs- und Systemtestwerkzeug fuer
Flughafen-Elektrifizierung, das E.ONs vorhandene Komponentenpruefungen ergaenzt.
Das Gesamtziel ist **nicht** mit einer guten Demo oder gruener CI erreicht.
Ein Verkaufserfolg, Preis und Kundennutzen sind bisher nicht nachgewiesen.
Keine Kontaktaufnahme, Datenfreigabe oder Versuchsgenehmigung wird behauptet.

## Anforderungen und beweisbare Freigaben

| Gate | Geforderter Nachweis | Aktueller Stand nach SIL-Kopplung |
| --- | --- | --- |
| Fachlicher Produktkern | Flugplan -> Auftraege -> Fahrzeuge/SOC -> Lade-/Netzleistung -> modellierte Fristverletzung, keine daneben stehenden unabhaengigen Kurven | Additives `airport_coupled_v1`; explizite angenommene Einsaetze aus manuell gewaehltem Plan |
| Physik und Betrieb | Leistungs- und Energieerhaltung, keine Doppelbelegung, SOC/Reserve, Charger-/Feeder-Grenzen, keine vorgetaeuschte Bedienung bei Ausfall | Handrechnungs-/Konservations-/Ausfalltests fuer zwei Regeln; aggregierte Wirkleistung, kein AC-Lastfluss |
| Fairer Vergleich | Gleiche Welt/Seed/Startzustaende/Missionen, nur dokumentierte Strategie unterschiedlich; Nullvorteile und Nachteile sichtbar | Identischer Welt-Hash; Laderegel/Portbelegung variieren; Parkhaus-Trade-off und Nullvorteil sichtbar |
| Erklaerbarkeit | Nachweis pro Aufgabe, Flugplaneintrag, Fahrzeug, Ursache, Zeitschranke; unabgeschlossene Aufgaben nicht verschweigen | Aufgaben-/Abflug-/SOC-/Parkhaus-CSV, JSON-Zeitreihe, Ursachenfilter und Quellenseite |
| Reproduzierbarkeit | Versionierte Eingaben/Engine, Wiederanlauf, Artefakthashes, Pruefung von mutierten Inputs und Ergebnissen | Eingefrorene Welt/Quelle, Recovery-Worker, vollstaendiger SHA256-Manifest-Check inklusive neuer JSON/PDF-Berichte; KPIs/Kriterien/Execution-Metadaten gegen Report; aeltere Nachweisstufe explizit, keine externe Signatur |
| Bedienbarkeit | Klarer gefuehrter Versuch, Annahmen und Quellen getrennt, mobile Ansicht, Compare/Exports, Fehlerpfade | Manuelle Auswahl/Bestaetigung, zwei SIL-Runs, Compare/HTML/PDF/CSV; kein automatischer Import |
| Realismus | Freigegebene Flotten-/Auftrags-/Lade-/Netzprofile; Zeit- und Einheitenvertrag; Unsicherheiten und Abdeckungsgrenzen | Keine privaten FMG-/Lab-Daten |
| Empirische Validierung | Festgelegte Baseline/Kriterien; getrennte Kalibrier- und Holdout-Zeitraeume; Abweichung pro Messgroesse | Offen, benoetigt Datenpilot |
| Lab-Nachweis | Read-only Messdaten-Replay; separate Versuchsvorschrift und Freigabe fuer reale Komponentenversuche | FlexLab vorhanden, keine gekoppelte Lab-Freigabe |
| Wirtschaftliche Entscheidung | Vom Kunden freigegebene Kosten-/Risikoannahmen, Sensitivitaet, nachgewiesener Trade-off statt unbelegter ROI | Offen, kein Preis-/ROI-Nachweis |
| Produktbetrieb | Kunden-/Rollenmodell, persistente Datenbank, Quoten, Backup-/Restore-Test, Monitoring und Updates; kein JSON-Mehrprozessbetrieb | Passwortgeschuetzte Einprozess-Demo |
| Daten-/Nutzungsrechte | Abgestimmte Zweckbindung, Rechte fuer Flug-/Messdaten, Loeschfristen, Verantwortlichkeiten | Manueller oeffentlicher Flugplan, keine Dauerlizenz |
| Kundenabnahme | Timo/Christoph/FMG-Verantwortliche akzeptieren eine konkrete fehlende Systemtestfrage und Pilot-Ergebnisgrenzen | Noch zu vereinbaren |

Diese Gates bleiben offen, bis ihre Nachweise vorliegen. Simulationsergebnisse
beweisen keine realen Flughafen-Verspaetungen, elektrische Sicherheit,
Kalibrierung, CO2-Einsparung, optimale Investition oder Zahlungsbereitschaft.

## Referenzgegenprobe vom 03.10.2026

Manuell importierter oeffentlicher Plan, Verkehrstag 03.10.2026, Datenstand
02.10.2026: 916 veroeffentlichte Eintraege, nicht bestaetigte physische Bewegungen.
Vier ungeklaerte Mehrfachgruppen wurden fuer **diesen** SIL-Test explizit als
unabhaengige Nachfrage angenommen. Unkalibrierte Defaults, Seed 42: 2.144
modellierte Aufgaben, keine unerledigten Aufgaben, aber nur 21,5 % rechtzeitige
Abflug-Aufgabenbereitschaft. Beide Laderegeln erzielen denselben Wert.
**Kein Optimierungsvorteil nachgewiesen.** Beide Runs enden `completed`, die
strengen Modellkriterien bleiben wegen verspaeteter Aufgaben `false`.
Diese Gegenprobe dient der Nachvollziehbarkeit; sie sagt nichts ueber reale
Muenchner Verspaetungen oder die Eignung der angenommenen Flottengroesse.
Der kontrollierte Handrechnungs-Test zeigt kausale Energiewirkung in einer
separaten Miniaturwelt, keine behauptete Kundenwirkung.

## Arbeitsreihenfolge

1. Kausale SIL-Kopplung und technische Gegenproben bauen, bestehende Bereiche erhalten.
2. Entscheidungscockpit mit Missionen, SOC, Engpaessen und fairen Regelvergleichen integrieren.
3. Replay-Vertraege und Datenqualitaets-Gates fuer freigegebene Missionen/Last-/Ladeprofile.
4. Kundenfrage, Kontrollstrategie und Pilotabnahme vorab mit Lab/Flughafen festlegen.
5. Holdout-Pruefung und Komponenten-/Systemtest unter separater Lab-Freigabe.
6. Wirtschaftliche Szenarien und Produktbetrieb erst auf dieser Basis freigeben.

Primarquellen fuer die fachliche Abgrenzung: EUROCONTROL A-CDM Specification,
30.01.2025, https://www.eurocontrol.int/publication/eurocontrol-specification-airport-collaborative-decision-making-cdm .
Sie benoetigt u.a. die Verknuepfung von Inbound-/Outbound-Fluegen und Milestones.
Solche Umlaeufe fehlen im oeffentlichen Saisonflugplan. Deshalb wird im
gekoppelten Modell **Aufgaben-/Abfertigungsbereitschaft**, nicht echte TOBT/OTP,
ausgewiesen. Quellenstand 03.10.2026; keine behauptete A-CDM-Konformitaet.
