# Elektrifizierung: konstante Flotte, drei vergleichbare Loesungen

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

Die Auftragsdisposition ist in allen Varianten gleich. Ein Vorteil einer
Laderegel wird nicht vorausgesetzt. Auch unveraenderte oder schlechtere
Ergebnisse werden angezeigt. Der Elektroanteil wird deterministisch mit
Groesste-Reste-Verteilung auf Busse (20), Gepaeckschlepper (35),
Flugzeugschlepper (10) und Bodenstromgeraete (35) verteilt.

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

- `POST /api/v1/demo/electrification`: Elektroanteil, Anschluss und
  Speicherkapazitaet; drei rein serverseitig berechnete Varianten.
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
