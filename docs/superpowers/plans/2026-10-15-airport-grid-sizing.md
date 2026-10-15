# Airport Anschlussvergleich

## Ziel und Abgrenzung

Die freigegebene Weiterentwicklung vergleicht drei Ladeloesungen bei identischer
Flotte und Nachfrage. Ergebnis ist die kleinste erfolgreich gerechnete
Anschlussstufe im festgelegten 250-kW-Raster, kein mathematisch globales Optimum
und keine elektrische Ausfuehrungsplanung. Drei Regler bleiben sichtbar:
Elektroanteil, vorhandener Anschluss, Speicher der dritten Variante.

## Festgelegter Modellvertrag

- Neue Engine `airport_electrification_v2`. Alte Engines und die historische
  Demo bleiben reproduzierbar; deren Zeitannahmen werden nicht rueckwirkend ersetzt.
- Synthetischer Vorfeldbereich: 100 Fahrzeuge wie bisher, 180 Abflug- und 180
  Ankunftsabfertigungen pro Tag, drei regelmaessige Wellen mit je 60 Abfluegen
  in drei Stunden. 55 Minuten angenommene Bodenzeit, keine reale Rotation.
  Die erste Zeitspalte eines S-Eintrags ist immer der Abflug in Muenchen.
- Drei aufeinanderfolgende Tage, durchlaufende individuelle Fahrzeug- und
  Speicherzustaende, kein taegliches Zuruecksetzen. Anfangsladung der Fahrzeuge
  85 %. Am Ende muss jedes Elektrofahrzeug mindestens seine Anfangsenergie
  und der Speicher mindestens seinen Anfangsinhalt wieder erreichen.
- Baggage/Tractor/GPU: 7,7/15,6/50,6 kWh pro Auftrag und 50/72/160 kWh Batterie
  nach He et al. (2026), Tabelle 1, Narrow-body. Bus und Einsatzfenster bleiben
  offengelegte Annahmen. Keine Kopie fremden Programmcodes.
- Abgegrenzter Anschluss statt behauptetem gesamten Flughafen: 250 kW Grundlast,
  500 kWp PV mit angenommener schwacher Erzeugung (Faktor 0,2), kein BHKW,
  40 Parkhaus-Ladevorgaenge pro Tag. Keine gemessenen Muenchner Werte.
- Erfolgspruefung: alle Aufgaben rechtzeitig, alle Parkhausauftraege gedeckt,
  keine Grundlastunterdeckung, keine geliehene Anfangsenergie, geschlossene
  Energiebilanzen. Fahrzeugmangel sperrt eine Anschluss-Empfehlung.
- Rasterpruefung 0..8.000 kW, aufsteigend; keine Monotonieannahme. Bei keinem
  erfolgreichen Kandidaten `not_found`, keine erfundene Zahl.
  Stufen unter einer notwendigen mittleren Energiebilanz werden rechnerisch
  ausgeschlossen, nicht als simuliert ausgegeben.
- Die neue Referenz vergibt Aufgaben an das laengste freie geeignete Fahrzeug.
  Die alte SOC-Maximum-Regel bevorzugte elektrische Fahrzeuge gegenueber
  Fahrzeugen ohne Batterie und bleibt ausschliesslich fuer alte Engines erhalten.
- Vorhandener Anschluss wird separat tatsaechlich simuliert. Nachweisdaten
  und Messdaten-Handoff beziehen sich eindeutig auf diese ausgewaehlte Variante.
- GPU-Referenzlayout: 14 statt bisher 10 Ladepunkte. Die 60 Aufgaben einer Welle
  benoetigen rund 3,3 MWh Ladestrom; zehn 50-kW-Punkte stellen den Ausgangs-SOC
  bis Mitternacht nicht wieder her. Die neue Annahme gilt fuer alle Varianten.

## Umsetzung und Pruefung

1. Tests zuerst: neue wiederholte Welt, korrekte Zeiten, alte Hashes, unveraenderte
   Gesamtflotte, Ressourcen-Baseline, Endenergie-Gates und Raster-Suche.
2. Neue optionale Weltfelder nur fuer v2; Simulator fuehrt individuelle Zustaende
   durch und kann fuer Suchlaeufe Fahrzeug-Zeitreihen weglassen.
3. Separates Referenzszenario und Raster-Suche; additive API-Felder, begrenzter
   In-Memory-Cache und bestehender serieller Demo-Lock.
4. Drei einfache Karten: gepruefter Anschlussbedarf, Deckung am vorhandenen
   Anschluss, Abfertigungsbereitschaft und Netzspitze. Details und Quellen aufklappbar.
5. Unit/Integration, Frontend, Lint, Typecheck, Build, Archive, HTTP-Smokes und
   Desktop/Mobil im Browser. Keine Hardware, kein Influx-Token.
6. Commit und Push; Remote-SHA und CI pruefen. Hetzner: Netze/Bestand pruefen,
   nur Airport-Backend stoppen, Offline-Backup und Hashpruefung, unveraenderten
   Remote-Commit bauen, bestehende Smokes und neue Anschlussabnahme.
   Oeffentlichen Zugang und andere Stacks nicht veraendern. Release separat dokumentieren.

## Quellen

- He et al. 2026: https://doi.org/10.1038/s41467-026-71125-4
- Leijon et al. 2022: https://www.citelec.org/EVS35/download.php?f=papers%2FEVS35-1690131.pdf
- Miller/Rutledge 2025: https://doi.org/10.7771/2159-6670.1314
- WSP 2019 und Siemens 2024: vom Nutzer bereitgestellte Fachbeitraege;
  Systemgrenzen, Lastmanagement und standortspezifische Auslegung.

Literaturbasierte Parameter sind keine empirische Validierung. US-Referenzdaten
sind kein deutscher Flughafen-Nachweis. Kosten/CO2/ROI, elektrische Schutz- und
Lastflussrechnung sowie reale Anlagensteuerung bleiben ausserhalb dieses Schritts.
