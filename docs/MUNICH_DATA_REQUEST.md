# Muenchen: Datenanfrage fuer einen abgegrenzten Pilot

Zweck: Ein bestehendes FMG-Energiemodell ergaenzen, nicht ungeprueft nachbauen.
Kontaktaufnahme und Uebermittlung sind **nicht erfolgt**. Entwurf fuer Timo und
Christoph; alle Freigaben erfolgen mit Flughafen und Lab.

## Zuerst drei fachliche Entscheidungen

1. Welche konkrete Frage bleibt beim vorhandenen dynamischen Energiezwilling
   offen: Komponentenverhalten, Ladepriorisierung, Stoerungsrobustheit oder
   Fahrzeugverfuegbarkeit?
2. Welcher einzelne Bereich darf zuerst untersucht werden: P44 oder Busdepot?
   Eine gemeinsame Energieverbindung beider Bereiche darf nicht einfach
   unterstellt werden.
3. Welche bestehende Regelstrategie, Messmethode und Erfolgskriterien bilden
   die Kontrolle? Kriterien vor dem Versuch festlegen, nicht nach Ergebnissen.

## Minimales Datenpaket

| Daten | Erforderliche Angaben | Verwendung |
| --- | --- | --- |
| Last- und Erzeugungsgang | Anonymisierte Zeitreihe, kW, Zeitzone, Messpunkt-Abgrenzung, Qualitaetsflags und Luecken | Profil und Energiebilanz pruefen |
| Bereichskapazitaet | Freigegebene aggregierte Bezugs-/Einspeisegrenzen, Trafo-kVA und Leistungsfaktor-Annahmen | Kapazitaet statt Anzahl Ladepunkte modellieren |
| Ladepunkte | Anzahl und geteilte Leistungsgrenzen, Fahrzeuglimits, Ladeverluste | Keine Verwechslung von Saeulen, Steckern und Netzleistung |
| Sessions/Fahrzeuge | Pseudonyme, Anschlusszeiten, Start-SOC, Energiewunsch, Abfahrtsfristen | Energiebedarf und Termintreue |
| Busmissionen | Pseudonyme Einsaetze, Zeitfenster, Energiebedarf und Reservevorgaben | Betriebskopplung ohne reale Flugverspaetungen zu erfinden |
| PV/Speicher | Messprofile; falls beteiligt: kW, kWh, nutzbarer SOC, Verluste und Betriebsregeln | Physikalisch konsistenter Vergleich |
| BHKW-Kontext | Aggregierte elektrische Erzeugung sowie Waerme-/Kaelte-Abhaengigkeiten | Keine unzulaessige Strom-only-Abschaltoptimierung |
| Regelstrategie | Dokumentierte heutige Prioritaeten und Einschraenkungen | Faire Baseline |

Ein repraesentativer zusammenhaengender Zeitraum ist fuer einen ersten Replay
besser als ein einzelner schoener Tag. Fuer saisonale Dimensionierung sind
zusaetzlich Winter/Sommer und laengere, moeglichst jaehrliche Reihen erforderlich.
Keine automatische Jahreshochrechnung eines kurzen Demo-Zeitraums.

## Validierung

1. Zeitraster, Einheiten, Messgrenzen und Energieintegrale pruefen. Schlechte
   oder unvollstaendige Daten duerfen kein fachliches PASS erzeugen.
2. Modell auf einen freigegebenen Zeitraum abstimmen; Eingaben und Parameter
   versionieren. Ein anderer Zeitraum bleibt fuer unabhaengige Pruefung zurueck.
3. Referenzregel und vorgeschlagene Regel bei gleichem Start-SOC, Bedarf,
   Betriebskalender und Randbedingungen vergleichen. Fehlende Energie und
   verpasste Termine sichtbar lassen, nicht aus der Bilanz entfernen.
4. Erst danach passende Komponente im TestingLab nach separater Versuchsvorschrift
   pruefen. Simulation, Messdaten-Replay und realer Versuch getrennt kennzeichnen.

## Freigabe und Schutz

- Nur benoetigte, freigegebene und moeglichst aggregierte Daten anfordern.
  Kein vollstaendiger Sicherheits-/Netzplan erforderlich fuer den ersten Replay.
- Keine Namen, Kennzeichen, Zugangsdaten, Steuerungsadressen oder persoenlichen
  Bewegungsdaten anfordern. Pseudonyme allein sind nicht automatisch anonym.
- Rechte, NDA, Speicherort, Zugriff, Weitergabe und Loeschfrist mit FMG abstimmen.
  Kein Upload realer Daten ins oeffentliche GitHub-Repo oder externe Dienste.
- Keine Anlagenwrites. Jede spaetere HIL-Aktuierung braucht eigene Lab-/Anlagenfreigabe.
- Ergebnisse sind fuer den geprueften Bereich und Zeitraum gueltig, nicht
  automatisch fuer den ganzen Flughafen oder einen sicheren Schwarzstart.

Oeffentliche Ausgangsdaten: [MUNICH_PUBLIC_DATA.md](MUNICH_PUBLIC_DATA.md).
