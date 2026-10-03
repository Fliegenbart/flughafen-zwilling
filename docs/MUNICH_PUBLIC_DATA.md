# Muenchen: oeffentliche Datengrundlage fuer den Airport-Pilot

Recherche: 2026-10-03. Nur Primaerquellen der Flughafen Muenchen GmbH.
**Noch kein implementierter oder kalibrierter Muenchen-Simulator.**
Der laufende Flughafen-Demonstrator und FlexLab wurden nicht veraendert.

Maschinenlesbarer Faktenkatalog: [munich_public_facts_v1.json](../data/references/munich_public_facts_v1.json).
Er ist bewusst kein Model-Pack. Fehlende Eingaben stehen auf `null`.
Quellenlinks und Bezugsjahre werden gespeichert; vollstaendige Fremdtexte werden
nicht kopiert. Abrufdatum ist nicht gleich Veroeffentlichungs- oder Inbetriebnahmedatum.

## Entscheidender Positionierungsbefund

**Muenchen hat bereits einen Energiezwilling.** Der integrierte Bericht 2025
beschreibt unter "5 Umweltwaerme" einen dynamischen digitalen Zwilling, der mit
einem externen Partner fuer den Umbau der Energieversorgung erstellt wurde.
Deshalb nicht behaupten, wir liefern den ersten Energiezwilling oder bislang
fehlende Energieplanung. Welche Funktionen dieser abdeckt, ist hier nicht bekannt.

Ein moeglicher Zusatznutzen ist die Validierung von Komponenten-/Ladestrategien
im TestingLab mit nachvollziehbaren Auswirkungen auf konkrete Betriebseinsaetze.
Das ist eine Hypothese, die die Kontakte zuerst bestaetigen muessen.
[FMG Klimaschutz 2025](https://bericht2025.munich-airport.de/impact-report/umwelt-und-klimaschutz/klimaschutz/).

## Verifizierte Eckdaten

| Kennzahl | Bezug | Bedeutung / Grenze |
| --- | --- | --- |
| 43,4 Mio. Passagiere; 337.438 Flugbewegungen | 2025 | Jahreswerte, kein Tagesflugplan; Flugbewegungen enthalten Starts und Landungen |
| P44: 275 Ladepunkte | September 2025 | Kein Nachweis fuer Gleichzeitigkeit, Ladeleistung oder Trafogroesse |
| P43/P44: zusammen 3 MWp PV | 2025 | Teil der Campus-PV, nicht zusaetzlich zum Gesamtwert |
| Busdepot: 50 Ladepunkte | August 2025 | Leistung und Betriebsprofile fehlen |

[FMG Wirtschaftsbericht 2025](https://bericht2025.munich-airport.de/financial-report/konzernlagebericht/wirtschaftsbericht/).

| Kennzahl | Bezug | Bedeutung / Grenze |
| --- | --- | --- |
| Campus-PV: 7 MWp | Ende 2025 | Installierte Spitzenleistung, kein gemessener Erzeugungsgang |
| PV-Ziel: 50 MW | 2030 | Ausbauziel, kein heutiger Bestand |
| Freiflaechen-PV: 3,7 MWp mit Batteriespeicher | Ankuendigung fuer 2026 | Aktueller Inbetriebnahmestand und Speichergroesse nicht verifiziert |
| 55 emissionsfreie Busse | 2025 | Flottenzahl, keine Batterie-, Fahr- oder Ladeprofile |
| Drittes Stromnetz | Bau geplant 2027 bis Ende 2029 | Nicht als bestehendes Netz darstellen |

[FMG Klimaschutz 2025](https://bericht2025.munich-airport.de/impact-report/umwelt-und-klimaschutz/klimaschutz/).

Das BHKW deckt laut Bericht ungefaehr 80 % des Strombedarfs. Diese Aussage
beschreibt einen Energieanteil, keine konstante Leistung. Waerme und Kaelte sind
mit der Stromerzeugung gekoppelt. Ein reines Netz/PV/Batterie-Modell waere fuer
das Ist-System unvollstaendig.

Der berichtete Stromverbrauch von 5,03 kWh je Passagier umfasst den gesamten
Campus inklusive Drittkunden und Niederspannungsverlusten. Mit gerundeten
43,4 Mio. Passagieren ergibt sich rechnerisch **rund 218 GWh/Jahr**. Das ist ein
abgeleiteter Kontextwert, kein separat gemessener Jahreswert und kein Lastgang.
[FMG Nachhaltigkeitskennzahlen 2025](https://bericht2025.munich-airport.de/impact-report/nachhaltige-entwicklung/nachhaltigkeitskennzahlen/).

Das FMG-Mittelspannungsdokument nennt 20 kV Betriebsspannung, PDF-Seite 8.
**Der Dokumentfuss traegt den Stand 03.02.2014**, obwohl die Datei aktuell
verlinkt ist. Gueltigkeit und heutige Netzdaten mit FMG bestaetigen. Eine
bestimmte P44-/Depot-Trafostation oder deren Leistung folgt daraus nicht.
[FMG TAB Mittelspannung](https://www.munich-airport.de/_b/0000000000000032057458bb6811e3c4/technische-anschlussbedingung-ms.pdf).

Die Umwelt-Radweg-Seite nennt 25 MW elektrische BHKW-Leistung fuer sechs
Motoren **im Jahr 2022**. Nicht ungeprueft als aktuelle verfuegbare Leistung nutzen.
[FMG Umwelt-Radweg](https://www.munich-airport.de/umwelt-radweg-6699942).

## Nicht uebernommene oder unklare Angaben

- Presse-Suchtreffer zum P44-Projekt nennen 11 kW nominal und bis 22 kW sowie
  138 Saeulen. Der verlinkte Artikel leitet beim direkten Abruf zum Newsroom um.
  Deshalb keine verbindliche Anschluss-/Ladeleistung daraus parametrisiert.
- Unterschiedliche oeffentliche Texte nennen ueber 600 beziehungsweise ueber
  1.140 Ladepunkte mit unterschiedlichen Abgrenzungen. Kein summierter
  Campus-Ladebestand abgeleitet.
- Drittanbieter-Vergabetreffer nennen geplante MS-Kapazitaeten. Ohne gepruefte
  Primaerunterlage wurden diese nicht als Netzanschlussleistung uebernommen.
- Keine PV-Ertragsreihe, Batteriegroesse, reale Trafo-Kapazitaet oder empirische
  Flughafenverspaetung aus unpassenden Jahres-/Bestandswerten erfunden.

## Vorgeschlagener erster Bauumfang, noch zur Freigabe

**MUC Referenzpilot: P43/P44 und Busdepot mit vereinfachter Campus-Strombilanz.**
Bestehende Flughafenfaelle und FlexLab bleiben voll erhalten.

Die Bausteine sind Netz, BHKW, PV, ein optionaler hypothetischer Speicher und
zwei getrennte Ladebereiche. Reale Bestandszahlen werden belegt; Lastprofile,
Anschlussgrenzen und Einsatzplaene sind bis zum Datenpilot sichtbare Annahmen.
Die Verbindung der Bereiche ist ein schematisches Modell, kein realer Netzplan.
Keine festen Defaultwerte fuer unbelegte elektrische Grenzen in diesem Dossier.

Erster Vergleich: ungesteuertes Laden gegen eine transparente Prioritaetsregel,
bei identischen synthetischen Sessions, Missionen, Wetterprofilen und Stoerungen.
Ergebnisse: Leistungs-/Energiebilanz, Netzspitze, PV-Nutzung, Speicherzustand und
erfuellte Lade-/Einsatztermine. Keine behauptete Gesamtflughafen-OTP oder reale
CO2-/Kosteneinsparung. Falls beide Regeln gleich gut sind, wird das gezeigt.

Nicht Teil dieses ersten Umfangs: reales Netzlayout, Kurzschluss/Schutztechnik,
Spannungsqualitaet, elektrischer Schwarzstart, vollstaendige Waermeplanung,
reale Anlagensteuerung oder Ersatz des bestehenden FMG-Energiezwillings.
Der Speicher ist eine Vergleichsoption, nicht ein behaupteter vorhandener Bestand.

## Datenpilot mit den Kontakten

Konkrete Liste und Validierungsfolge: [MUNICH_DATA_REQUEST.md](MUNICH_DATA_REQUEST.md).
Zuerst klaeren, welchen Systemtest der vorhandene Zwilling heute nicht abdeckt.
Keine nicht-oeffentlichen Flughafenplaene, Messdaten oder Versuchsergebnisse ins
GitHub-Repo stellen. Die oeffentliche Recherche begruendet keine Partnerschaft.
