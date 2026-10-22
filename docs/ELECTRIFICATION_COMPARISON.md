# Anschlussvergleich v4: eingeschwungen, gesteuert, ganzes Vorfeld

Seit dem Modell-Paket 1+3 (Oktober 2026) rechnen Startseite und Fachleute-Seite mit
`airport_electrification_v4`. v3 bleibt fuer eingefrorene Laeufe unveraendert erhalten
(Abschnitte weiter unten). Grundlage sind zwei gegengepruefte Recherchen (Verbrauch je Einsatz,
Parkhaus, weitere Geraete, Grossraum, Fracht); jede Zahl unten traegt ihre Herkunft.

## Was sich in v4 aendert

- **Speicher**: laedt aus allem, was am Anschluss in derselben Minute frei bleibt (bisher nur
  bis 80 % des Anschlusses), und entlaedt nur ueber Anschluss plus PV. Die Stufe mit Speicher
  wird nur bis zum Bedarf ohne Speicher gesucht; besteht der laufende Speicher dort nicht, bleibt
  er aus (`storage_mode: "off"`, rechnet genau wie ohne Speicher). Mit Speicher braucht es damit
  nie mehr Anschluss als ohne.
- **Ladeplanung** (`known_duty_soc_feedback_v2`): rechnet mit dem echten Ladestand statt mit
  dem nominal verbrauchten Anteil und plant 15 % Reserve auf kuenftige Einsaetze
  (`charging_plan.PLAN_MARGIN`). Die v3-Planung scheiterte schon bei 10 % Verbrauchsabweichung
  an jeder Anschlussgroesse.
- **Eingeschwungener Messtag** (`coupled_world.steady_cycle`): Erfolg misst sich am mittleren der
  drei Tage. Tag 1 schwingt vom Startstand ein, Tag 3 laeuft normal weiter, damit das Rechenende
  nichts verzerrt. Fahrzeuge und Speicher muessen am Ende des Messtags mindestens so voll sein
  wie an seinem Anfang. Ein Speicher, der am Messtag voll wurde, darf einen Fehlbetrag haben,
  den er bei vollem Speicher noch haette aufnehmen koennen, solange er dabei die Reserve nicht
  erreicht: Er pendelt sich dann knapp darunter ein (per Fixpunkt-Test bestaetigt). Die
  Energie-Untergrenze der Suche zaehlt nur Arbeit, die ganz im Messtag liegt.
- **Parkhaus** nach Nutzergruppen: Reisende (Ankunft 2-3 h vor dem Abflug, Frist bis 24 h,
  15-30 kWh), Tagesgaeste (2 h vorher, 10-16 h, 5-20 kWh) und Schnelllader (75 kW, Frist =
  Ladezeit + 5 min, nie verschoben oder gedrosselt). Mit Lademanagement laedt jeder Vorgang
  mindestens die gleichmaessige Rate bis zu seiner Frist und fuellt darueber freie Leistung nach
  Vorfeld, Schnellladern und Speicher. Ohne Steuerung laedt jedes Auto sofort.
- **Zehn Fahrzeugklassen** statt vier, mehrere Fahrzeuge je Flug, eigene Werte fuer
  Grossraumflugzeuge und Frachtfluege (siehe Tabelle).

## Erfolgsvertrag v4

Eine Anschlussstufe besteht, wenn alle Einsaetze bis zu ihrer Frist erledigt sind, die
Grundlast versorgt ist, jeder Parkvorgang mit Frist im Horizont voll ist (Fristen nach dem
Rechenende werden nicht geprueft) und der Messtag sich selbst traegt: Die Flotte laedt an ihm
so viel nach, wie sie verbraucht (laufende Einsaetze voll angerechnet), bis auf 10 % der
Tagesarbeit. Diese Schwankung entsteht, weil sich der Dienstplan von Tag zu Tag verschiebt; sie
tritt auch bei unbegrenztem Netz auf (CGN bis rund 6 %). Der Speicher muss eingeschwungen sein.
Die unabhaengigen Energiebilanzen muessen stimmen.

## Fahrzeugklassen und Verbrauch (v4)

Energie je Einsatz akkuseitig. "je Flug" = Fahrzeuge je Flugrichtung (Catering, Toiletten-
und Wasserwagen nur beim Abflug). Grossraumwerte in Klammern. Die Werte aus He et al. (2026)
beruhen auf Nennleistung mal Diesel-Lastfaktor und sind fuer Elektrogeraete 3- bis 5-mal zu
hoch; uebernommen sind dort nur Akkugroessen und Einsatzzeiten.

| Klasse | je Flug | kWh je Einsatz | Service + Rueckweg | Akku / Laden | Herkunft |
| --- | --- | --- | --- | --- | --- |
| Vorfeldbus | 2 (4) | 6,5 (6,5) | 15 + 10 min | 300 kWh / 80 kW | Fraport-Messung (Hess et al. 2023), 70 Plaetze je Bus |
| Gepaeckschlepper | 1 (3) | 2,5 (3,0) | 20 (35) + 5 min | 50 / 22 | CARB/SMF-Messung, Physik |
| Flugzeugschlepper | 1 | 3,0 (8,0) | 10 (15) + 10 min | 72 / 80 | Physik, Mototok, Goldhofer PHOENIX E |
| Bodenstromgeraet | 1 (2) | 16 (42,5) | 40 (100) + 5 min | 160 / 50 | ITW GSE 7400, EUROCONTROL-Bodenzeiten |
| Foerderband | 2 (1) | 1,0 (1,5) | 20 (30) + 5 min | 30 / 11 | Physik, Charlatte, EPRI, Stuttgart |
| Passagiertreppe | 2 (2) | 1,0 (1,3) | 20 (30) + 5 min | 30 / 6 | Stuttgart-Messung (3,26 kWh/Bh) |
| Container-Hublader | 2 (2) | 1,5 (3,5) | 15 (30) + 5 min | 65 / 22 | Physik, Trepel, AeroGround-Gegenprobe |
| Catering-Hubwagen | 1 (2) | 10 (12) | 25 (40) + 30 min | 120 / 22 | Kamag ECW, Physik |
| Toilettenwagen | 1 | 2,5 (4,0) | 10 (20) + 15 min | 40 / 12 | Charlatte, AeroGround-Gegenprobe |
| Frischwasserwagen | 1 | 2,0 (3,0) | 10 (15) + 15 min | 40 / 12 | Physik, AeroGround-Gegenprobe |

Abdeckung je Flughafen im Steckbrief (`coverage_pct`, `wide_coverage_pct`): Busse und Treppen
nur ohne Fluggastbruecke, mobiler Bodenstrom nur ohne feste 400-Hz-Anlage, Hublader bei
Schmalrumpf nur mit Containern (Drehkreuz 20 %, sonst 0-10 %), Catering 20-80 %, Toiletten-
wagen 60 %, Frischwasser 40 % der Schmalrumpf-Abfluege, Grossraum immer. Frachtfluege (CGN,
LEJ; Anteil je Ortsstunde im Steckbrief) bekommen keinen Bus, keine Treppe, kein Catering,
keinen Toiletten- oder Wasserwagen und immer mobilen Bodenstrom. Grossraumanteil an
Passagierfluegen am Spitzentag (Destatis, Betreiberzahlen): FRA 22 %, MUC 10 %, DUS 2,5 %,
BER 2 %, HAM 1,5 %, NUE und HAJ 0,5 %, sonst 0; an Frachtfluegen CGN 50 %, LEJ 30 %.

Flotte: kleinste puenktliche Dieselflotte je Klasse mal Puffer; fuer die vier bisherigen
Klassen der Puffer der alten Referenz (Busse 3,3x, Gepaeck 2,2x, Schlepper 1,4x, Bodenstrom
2,3x), fuer die neuen 1,5x. In MUC ergibt das 97 Busse und 47 Bodenstromgeraete (AeroGround
2025: 95 und 53). Ladepunkte: Baender und Treppen 1 je Fahrzeug (langsam am Abstellplatz),
die uebrigen neuen Klassen 1 je 2 Fahrzeuge, die bisherigen wie in der Referenz.

Gegenprobe: Auf den Umfang der AeroGround-Flotte zurueckgerechnet (dort fahren Pushback,
Catering, Wasser- und Toilettenwagen nicht elektrisch) ergibt das Modell rund 20-26 kWh Strom
je Abfertigung netzseitig; gemessen sind 25,9 (Umwelterklaerung 2025, mit unsicherem
Nenner). Mit nur den alten vier Klassen waeren es 17-20 kWh.

## Grenzen v4

- Ein typischer Tag im Spitzenmonat; Winter (Heizung, kalter Akku) und Spitzentage fehlen.
- Crew- und Kleinbusse, Pkw, Schlepps zur Parkposition, Enteisung und Betankung fehlen.
- Frachter: Hauptdeck-Ladung ist nur ueber Hublader und Grossraum-Gepaeckzuege angenaehert.
- Bus und mobiler Bodenstrom werden je Klasse unabhaengig gelost, nicht als gemeinsame
  Aussenposition.
- Anteile fuer Catering, Toiletten- und Wasserwagen sowie Container bei Schmalrumpf sind
  Annahmen ohne veroeffentlichte Quote.

---

# Anschlussvergleich v3: vorausschauend laden, fair vergleichen

Die aktuelle Startseite nutzt `airport_electrification_v3`. Sie prueft die
kleinste erfolgreiche Anschlussstufe in **25-kW-Schritten**. Der vorhandene
Anschluss wird weiterhin separat simuliert. Die Suche setzt keine Monotonie
voraus und unterschlaegt keine fehlgeschlagenen Stufen. Das Ergebnis ist ein
Nachweis fuer diese Modellregel, kein kontinuierliches oder globales Optimum.

## Was sich fachlich aendert

- Alle Varianten teilen dieselben 100 Fahrzeuge, elektrischen Fahrzeug-IDs,
  Einsatzauftraege, Ladepunkte, Anfangsladungen, Lasten und PV-Annahmen.
- Zusaetzlich ist jetzt **jeder Auftrag einem festen Fahrzeug zugeordnet**.
  Die Zuordnung entsteht ohne Kenntnis der Laderegel oder Anschlussleistung.
  Bei Energiemangel wird gewartet; kein Diesel-Ersatz versteckt einen Engpass.
  `duty_roster_hash` bindet diese Zuordnung im Vergleich und in den Artefakten.
- Direktes Laden bedeutet sofortiges Laden freier Fahrzeuge bis zum Ladeziel,
  mit proportionaler Begrenzung am Anschluss und Transformator.
- Vorausschauendes Laden berechnet aus allen bekannten kuenftigen Einsaetzen
  den Energiebedarf vor jedem Einsatz und am Horizontende. Dieser Bedarf wird
  auf die erwarteten freien Lademinuten verteilt. Ladepunktteilung, Anschluss,
  Transformator, Grundlast, PV und unveraenderte Parkhauslast gehen in die
  Prognose der Lademoeglichkeiten ein. Die engste Energiebilanz bestimmt den
  aktuellen Bedarf; bei knappen Ladepunkten werden die dringendsten Fahrzeuge
  zuerst angeschlossen. Eine vollstaendige minutenweise Ladepunktrotation
  wird vor den Fristen als Planungsreserve beruecksichtigt.
- Der Minuten-Simulator erzwingt danach die wirklichen Ladepunktzahlen,
  Leistungen, Fahrzeugbelegung, Reserven und Energiefluesse. Eine guenstige
  Prognose allein fuehrt niemals zu PASS. Jede Anschlussstufe wird ausgespielt.
- Parkhaus-Laderegel und proportionale Netzbegrenzung sind in beiden Varianten
  identisch. Ohne elektrische Vorfeldfahrzeuge und ohne stationaeren Speicher
  muessen die Leistungsreihen exakt gleich sein.
- Die dritte Variante ergaenzt denselben Planer um den gewaehlten Speicher.
  Die bestehende Peak-Shaving-Regel und Speicher-Endladung bleiben explizit;
  dem Planer wird keine fiktive kostenlose Anfangsenergie gutgeschrieben.

## Aussagegrenzen

`known_duty_energy_envelope_v1` ist eine deterministische vorausschauende
**Heuristik mit vollstaendig bekanntem Einsatzplan**, kein optimaler Solver,
keine reale Verspaetungsprognose und kein produktiver Anlagenregler. Sie kann
keinen Vorteil oder auch schlechtere Werte liefern. Einsparungen werden weder
vorgegeben noch durch geaenderte Flotte, schwache Ladeziele oder versteckte
Ersatzfahrzeuge erzeugt. Die bekannte Flotte ist keine FMG-Kalibrierung.

Der Erfolgskontrakt bleibt unveraendert: alle Auftraege rechtzeitig, Parken und
Grundlast versorgt, jedes elektrische Fahrzeug und der Speicher mindestens auf
Anfangsladung, unabhaengige Bilanzen korrekt. Drei bekannte wiederholte Tage
sind kein Jahresnachweis; Wetter, Defekte, Ladepunktwechselzeiten, Ladeleistung
bei hohem SOC und reale Betriebsabweichungen brauchen spaetere Kalibrierung.

Die notwendige mittlere Energieuntergrenze verwendet in v3 die exakt zugeordneten
elektrischen Auftraege auch bei gemischten Flotten. Unterhalb dieser Untergrenze
kann der unveraenderte Erfolgskontrakt nicht erfuellt werden. Die Grenze nimmt
optimistisch vollstaendige Nutzung der Erzeugung an und ist keine Empfehlung.

## Reproduzierbarkeit und Oberflaeche

Neue Laeufe speichern Engine v3, Policy `lookahead`, Welt-Hash, feste
Fahrzeugzuordnung und Planungsmethode. Historische Engines und ihre gespeicherten
Werte werden nicht umgeschrieben. Bestehende REST-Endpunkte bleiben erhalten;
Policy und Engine sind additive Erweiterungen fuer neue Runs. Alte Releases
koennen neue abgeschlossene Records lesen, aber keine neuen v3-Jobs ausfuehren.

Die Startseite behaelt drei Regler und drei Loesungen. Leistungsbalken verwenden
eine gemeinsame Skala; weniger, gleich viel und mehr Anschlussleistung werden
gleichermassen sichtbar. Annahmen, Kurven, Nachweise und Messdaten-Handoff bleiben
erreichbar. Schlechte oder veraltete Ergebnisse werden nicht als Vorteil gezeigt.

## Historischer Anschlussvergleich v2

Die damalige Startseite zeigte je Ladeloesung die kleinste erfolgreich gerechnete
Anschlussstufe in 250-kW-Schritten bis 8 MW. Der vorhandene Anschluss wird
zusaetzlich tatsaechlich simuliert; darunter angezeigte Betriebswerte und der
Messdaten-Handoff beziehen sich auf diesen vorhandenen Anschluss, nicht auf
die gesuchte Auslegungsstufe. Gleiche Bereitschaft bei weniger Anschlussleistung
ist ein moeglicher Nutzen. Ein Vorteil einer Regel oder Batterie wird nicht erzwungen.

## Referenz und Quellen

Abgegrenzter **synthetischer Vorfeldbereich**, nicht der gesamte Flughafen Muenchen.
180 Ankuenfte und 180 Abfluege je Tag, drei Tage mit kontinuierlichen Fahrzeug-
und Speicherzustaenden. Drei Wellen von jeweils 60 Abfluegen in drei Stunden,
55 Minuten angenommene Bodenzeit. Keine Codeshares oder reale Flugzeugumlaeufe.
Synthetische S-Zeilen tragen die Abflugzeit korrekt in der ersten Zeitspalte.

| Bestandteil | Festlegung | Herkunft |
| --- | --- | --- |
| Flotte | 20 Busse, 35 Gepaeckschlepper, 10 Flugzeugschlepper, 35 GPUs | Annahme, insgesamt 100 |
| Gepaeckschlepper | 7,7 kWh/Auftrag, 50 kWh Batterie | He et al., Tabelle 1, Narrow-body |
| Flugzeugschlepper | 15,6 kWh/Auftrag, 72 kWh Batterie | He et al., Tabelle 1, Narrow-body |
| GPU | 50,6 kWh/Auftrag, 160 kWh Batterie | He et al., Tabelle 1, Narrow-body |
| Bus | 8 kWh/Auftrag, 300 kWh Batterie, 35 % Abdeckung | Annahme, nicht aus He et al. |
| Ladepunkte | 8 / 12 / 4 / 14; 80 / 22 / 80 / 50 kW | Referenzlayout-Annahme |
| GPU-Service | 40 Minuten, 5 Minuten Rueckkehr, Start 55 Minuten vor Abflug | Annahme, kein gemessener Umlauf |
| Grundlast / PV | 250 kW / 500 kWp, angenommener PV-Peakfaktor 0,2 | lokaler Bereich, schwache PV; keine Wetterdaten |
| Parken | 40 synthetische Vorgange je Tag, je 11 kW | Annahme, konkurrierende Last |
| BHKW | keines im abgegrenzten Bereich | Systemgrenze, nicht der Muenchner Campus |
| Speicher | Kapazitaet einstellbar, Leistung C/2, Anfang 50 %, Reserve 10 % | Annahme |

He et al. (2026), https://doi.org/10.1038/s41467-026-71125-4, liefert die
angegebenen Energie-/Batteriewerte, nicht unser Flottenlayout oder eine
Muenchner Kalibrierung. Anders als dort werden hier keine Fahrzeuge zum
Erreichen eines Ergebnisses hinzugefuegt. Leijon et al. (EVS35, 2022) stuetzt
die minutenweise Leistungsbilanz und die getrennte Betrachtung von PV,
Laden und Speicher. Miller/Rutledge (2025), WSP (2019) und Siemens (2024)
liefern System- und Planungsfragen, keine kalibrierten Betriebsparameter.
Keine fremden Programmteile oder US-Ergebnisdaten wurden uebernommen.

Die historische Ausstattung mit zehn GPU-Ladepunkten kann mit den hoeheren
literaturbasierten Einsatzenergien nicht alle Fahrzeuge bis Mitternacht
wieder aufladen. 14 GPU-Punkte sind deshalb eine explizite Annahme des neuen
Referenzlayouts. Sie sind in allen drei Varianten identisch. Die
nicht-elektrische Kontrollrechnung muss alle Aufgaben ohne Ressourcenengpass
erfuellen, sonst wird keine Anschlussleistung empfohlen.

## Erfolgsvertrag

Eine Anschlussstufe besteht nur, wenn gleichzeitig gilt:

- Jeder Fahrzeugauftrag ist bis zu seiner modellierten Frist fertig.
- Alle Parkauftraege sind vollstaendig geladen, die Grundlast ist versorgt.
- Jedes elektrische Fahrzeug erreicht am Ende seine individuelle Anfangsenergie
  (85 % SOC); die Batterie erreicht mindestens ihren Anfangsinhalt (50 %).
- Die unabhaengigen Fahrzeug- und Speicherbilanzen stimmen.

Die Suche testet aufsteigende Stufen, ohne monotones Verhalten vorauszusetzen.
Stufen unter einer notwendigen mittleren Energiebilanz werden analytisch
ausgeschlossen; dieser Grenzwert steht als `energy_lower_bound_kw` im Nachweis.
Teilweise elektrische Klassen werden dabei konservativ nicht als elektrische
Pflichtenergie angerechnet. Es gibt kein Guthaben aus Anfangsladung.
`not_found` bedeutet kein Nachweis bis 8 MW, nicht technisch unmoeglich.

Die neue Referenz vergibt Aufgaben zuerst an das laengste freie geeignete
Fahrzeug. Dadurch werden elektrische Fahrzeuge nicht wie bei der alten
SOC-Maximum-Regel systematisch vor nicht-elektrischen eingesetzt. Der
Antriebsmix und saemtliche Auftraege sind pro Vergleich identisch.

`airport_electrification_v2` fuehrt drei Tage ohne SOC-Reset durch. Das ist ein
begrenzter Wiederholbarkeitstest, **kein** Jahres-, Saison-, Netzschutz-,
CO2- oder Wirtschaftlichkeitsnachweis. Endzustaende je Fahrzeug werden im
gespeicherten `coupled-evidence.json` mitgeliefert. Der Server puffert nur
deterministische Suchergebnisse im begrenzten Prozessspeicher.

## Historischer Vertrag v1

Die folgenden Angaben dokumentieren die vorherige Demo. Gespeicherte v1-Welten
bleiben unveraendert nachrechenbar. Auch die separat erreichbare alte
Flottenerweiterungs-Demo behaelt ihren urspruenglichen Tag samt historischen
Zeitannahmen; nur der neue Standardeinstieg verwendet die korrigierte Referenz.

Die Startseite untersucht die Elektrifizierung einer bestehenden Flotte von
100 Fahrzeugen. Der Elektroanteil ersetzt nicht-elektrische Fahrzeuge; er
vergroessert die Gesamtflotte nicht. Die bisherige Flottenerweiterungs-Demo
bleibt ueber „Weitere Werkzeuge“ erhalten.

## Vergleichsvertrag

Alle drei Varianten teilen denselben synthetischen Flugplan, Seed,
Auftragssatz, Fahrzeug-IDs, Antriebsmix, Start-SOC der Elektrofahrzeuge,
Ladepunkte, Grundlast, PV, BHKW und Anschluss. Der Server prueft diesen
Vertrag und liefert Hashes fuer Auftraege und Anfangsflotte.

1. Direkt laden: bisherige unkontrollierte Ladeverteilung, kein Speicher.
2. Gesteuert laden: Prioritaet nach erreichbaren Einsatzfristen, kein Speicher.
3. Gesteuert plus Speicher: gleiche Prioritaetsregel plus die eingestellte
   Kapazitaet. Speicherleistung = Kapazitaet / 2, Start-SOC 50 %, Reserve 10 %,
   Netzladung unter 80 % der Anschlussgrenze.

Zusaetzlich liefert der Vergleich `uncontrolled`: dieselbe Flotte ganz ohne
Steuerung. Kein Anschluss bremst, jedes Fahrzeug laedt sofort mit voller
Leistung. Der Bedarf ist die hoechste Netzlast der drei Tage, auf 25 kW
aufgerundet. Anders als Variante 1 (sofort laden, am Anschluss proportional
begrenzt) zeigt das, was ein Anschluss ohne jedes Lademanagement tragen
muesste. Die Kundenseite nutzt diesen Wert als erste Stufe der Treppe; die
Fachansicht zeigt weiter Variante 1.

Die Auftragsdisposition ist in allen Varianten gleich. Ein Vorteil einer
Laderegel wird nicht vorausgesetzt. Auch unveraenderte oder schlechtere
Ergebnisse werden angezeigt. Der Elektroanteil wird deterministisch mit
Groesste-Reste-Verteilung auf Busse (20), Gepaeckschlepper (35),
Flugzeugschlepper (10) und Bodenstromgeraete (35) verteilt.

## Echte Flughaefen

Neben dem erfundenen Beispielflughafen rechnet das Modell das ganze Vorfeld echter
deutscher Flughaefen (`backend/app/exchange/airport_model.py`). Grundlage ist je
Flughafen ein Steckbrief `backend/app/exchange/data/airports/<IATA>.json`
(Schema `airport_spec.py`), erstellt aus einer gegengeprueften Recherche
oeffentlicher Quellen. Jede Zahl, die die Rechnung treibt, traegt Begruendung und
Quellen; Annahmen sind als solche markiert.

- Flugplan: Abfluege an einem typischen Tag im Spitzenmonat (nur gewerblich, ohne
  allgemeine Luftfahrt), verteilt nach 24 Stundengewichten fuer Abfluege und
  Ankuenfte. Bei FRA, MUC, DUS, HAM, STR, HAJ, NUE, DRS, BRE, DTM, FMM und FKB sind
  die Gewichte aus dem veroeffentlichten Flugplan ausgezaehlt (einige Tage bis eine
  Woche im Oktober 2026, Frachtfluege dort teils nicht enthalten); bei BER, CGN und
  LEJ aus Eckdaten konstruiert (Laermberichte, Nachtruhe, Frachtnacht).
- Umfang: vier Fahrzeugklassen mit Verbrauchswerten fuer Kurz- und Mittelstrecke.
  Weitere Geraete, Pkw und der Mehrbedarf von Grossraumflugzeugen fehlen; an
  Drehkreuzen liegt der echte Bedarf deshalb hoeher. Die Seite sagt das bei jedem
  echten Flughafen unter dem Antwortsatz.
- Einsaetze je Flug: Abdeckung je Fahrzeugklasse aus dem Steckbrief, z. B. Busse
  nur an Aussenpositionen, mobile Bodenstromgeraete nur ohne festen 400-Hz-Strom.
- Flotte: vom Modell bemessen (`scripts/size_airport_fleets.py`). Je Klasse die
  kleinste Flotte, die das Profil mit Dieselfahrzeugen puenktlich schafft, dazu
  derselbe Puffer wie im Beispielflughafen (dort Busse 3,3x, Gepaeckschlepper 2,2x,
  Flugzeugschlepper 1,4x, Bodenstromgeraete 2,3x der Mindestflotte). Ladepunkte im
  selben Verhaeltnis. Akku, Energie je Einsatz und Ladeleistung wie im Beispiel.
- "Anschluss" heisst hier **Reserve fuers Vorfeld**: die Leistung, die das
  Flughafennetz fuer das Laden auf dem Vorfeld und im Parkhaus bereitstellt. Die
  uebrige Last und die Photovoltaik des Flughafens stecken schon darin; das Modell
  rechnet keine Grundlast und keine Flughafen-PV. Fast alle grossen Flughaefen
  betreiben ein eigenes Netz, die Frage ist deshalb intern.
- Raster und Obergrenze wachsen mit der Groesse (25, 50 oder 100 kW), ebenso die
  Speicherstufen. Die Vorab-Tabelle je Flughafen liegt in `data/atlas/<IATA>.json`
  (`make_electrification_atlas.py --airport FRA`) und gilt nur, solange die
  modellrelevanten Steckbriefwerte gleich sind (Fingerabdruck in `reference_id`).
- Die groesseren Welten (bis 1.500 Fahrzeuge je Klasse, 80.000 Einsaetze) gibt es
  nur in `trusted_scale()` fuer serverseitig erzeugte Flughafenmodelle. Alles, was
  von aussen kommt (Projekte, Varianten, Muenchen-Endpunkte), behaelt die bisherigen
  Grenzen.
- SIL-Laeufe gibt es weiter nur fuer den Beispielflughafen.

Schnittstellen: `GET /api/v1/demo/airports` (Steckbriefe mit Fakten und
Modellannahmen, nur Flughaefen mit Tabelle), `GET /demo/electrification/atlas?airport=FRA`,
`POST /demo/electrification` mit `airport`.

Kundenseite: Auswahl im Kopf (`?flughafen=FRA`). Die Reserve ist zuerst offen; die
rote Linie zeigt dann den Bedarf mit Lademanagement, und der Satz nennt nur den
Bedarf je Stufe. Erst eine eingetragene Reserve fuehrt zu "reicht" oder "reicht
nicht". Parkhaus anfangs aus, weil es bei echten Flughaefen auf einer groben
Annahme beruht (je oeffentlichem Ladepunkt ein Vorgang am Tag).

## Modellgrenzen

Die neue Engine `airport_electrification_v1` erweitert den bestehenden
gekoppelten Simulator. Nicht-elektrische Fahrzeuge haben dieselben
Einsatz-/Rueckkehrzeiten, beziehen keinen Ladestrom und erhalten keinen
fiktiven Batterie-SOC. Kraftstoff, Betankung, Emissionen und Kosten werden
nicht modelliert. Die nicht-elektrische Verfuegbarkeit ist daher eine
vereinfachende Annahme. Keine reale Flug-OTP, kalibrierte Flughafenplanung,
Hardwaresteuerung oder ROI-Aussage.

Die Energiekennzahlen umfassen Vor- und Nachlauf (30 Stunden im Demotag).
Warteminuten werden ueber Auftraege summiert. Parkhaus und Grundlast bleiben
als konkurrierende Lasten erhalten; Grundlastunterdeckung wird sichtbar
gewarnt. Ein Speichergewinn beinhaltet die angenommene Anfangsladung, keine
Behauptung eines zyklisch nachhaltigen Jahresbetriebs.

## Schnittstellen und bestehende Daten

- `POST /api/v1/demo/electrification`: Elektroanteil, Anschluss,
  Speicherkapazitaet, Photovoltaik (`pv_kwp`, Standard 500) und Ladevorgaenge
  im Parkhaus (`parking_sessions`, Standard 40); drei rein serverseitig
  berechnete Varianten plus `uncontrolled` (siehe Vergleichsvertrag).
- `GET /api/v1/demo/electrification/atlas`: vorab gerechnete Anschlussstufen
  fuer alle Reglerstellungen des Beispielflughafens (`entries`: direkt,
  vorausschauend, mit Speicher; `peaks`: ohne Steuerung). Erzeugt von
  `backend/scripts/make_electrification_atlas.py`, liegt in
  `backend/app/exchange/data/electrification_atlas.json`. Passt die Datei
  nicht zu Engine, Referenz oder Raster, wird sie ignoriert und der Vergleich
  rechnet wie bisher.
- `POST /api/v1/demo/electrification/runs`: zusaetzlich `solution` mit
  `direct`, `managed` oder `managed_storage`; friert genau diese Variante
  fuer den bestehenden SIL-Worker und Messdaten-Abgleich ein.
- Der bisherige `/demo/simulation`-Vertrag bleibt erhalten. v2-Welten ohne
  Elektroanteil werden weiterhin unveraendert als vollelektrisch interpretiert;
  das neue optionale Flottenfeld fehlt in ihren serialisierten Hashdaten.
- `electric_vehicles` ist nur mit der neuen Engine erlaubt. Alte v2-Laeufe
  bleiben lesbar und ausfuehrbar.

## Abnahme

Konstante Gesamtzahl und Auftraege bei 0/1/33/50/99/100 Prozent; konstante
Vergleichsbedingungen der drei Varianten; keine elektrische Ladung und kein
SOC fuer nicht-elektrische Fahrzeuge; Energiebilanz; Reproduzierbarkeit;
Unveraendertheit der bisherigen Demo; persistierter SIL-Lauf entspricht der
gewaehlten Vorschau. Frontend: drei Regler, drei echte Ergebnisgruppen,
keine alten Ergebnisse nach Eingabeaenderung, Fehler mit Neuversuch,
Desktop-/Mobilansicht und erreichbare Bestandswerkzeuge.
