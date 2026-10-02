# Timos separater FlexLab-Pilot

**Optionales Zusatzwerkzeug, nicht der Flughafen-Arbeitsbereich.**
Gemeinsamer Start: [Timos Pilot](TIMO_PILOT.md).

## Die konkrete Frage

**Kann ich einen Lade-/Flexibilitaetsversuch ohne Excel-Nacharbeit anhand
von Ist-Leistung, Sollwert, Limit und vorab festgelegten Kriterien beurteilen?**

Die Anwendung ist ein lokaler Auswertungsarbeitsplatz. Kein Schreibzugriff auf
Anlagen; keine angenommene Kenntnis der konkreten E.ON-Pruefstaende.

## Start

```sh
git clone https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

[FlexLab Workbench](http://localhost:5176/?workspace=flexlab) oeffnen oder oben
`Messdaten / Zusatzwerkzeug` waehlen. Keine Registrierung erforderlich.
Docker muss laufen; erster Build braucht Internet. Startprobleme: `docker
compose -f docker-compose.demo.yml logs --tail=100 twin-core frontend`.

## Drei Dinge ausprobieren

1. **Sollwertsprung:** Referenzprofil belassen, Test starten. Die 180 Modellsekunden
   laufen bei 20x Wiedergabe in ca. 9 Sekunden. Soll-/Ist-Verlauf, Reaktionszeit,
   Kriterien und Run-ID lesen. Das ist ausdruecklich eine Simulation.
2. **Telemetrieausfall:** Testfall umstellen und starten. Fehlende Messpunkte
   muessen sichtbar bleiben und das Ergebnis muss `Nicht bewertbar` sein.
   Alternativ Antwortverzoegerung auf 20 s setzen: der Sollwertsprung verletzt
   das vorher festgelegte Reaktionszeitlimit. Nachher Referenzwerte zuruecksetzen.
3. **Messdaten:** `Simuliertes Beispiel` herunterladen und importieren. Danach
   eigene anonymisierte CSV im selben Format importieren. Pruefstand, Messintervall
   und akzeptierte Toleranzen vorher einstellen. Report, JSON und Trace exportieren.

Ein wiederholter identischer Test wird als vergleichbare Baseline angeboten.
Geaenderte Kriterien oder geaenderte Sollprofile werden nicht als identische
Baseline verrechnet. Unterschiede sind Beobachtungen, keine kausale Optimierung.

## CSV-Vertrag

```csv
ts_s,power_kw,setpoint_kw,limit_kw
0,20,20,80
1,20.1,20,80
2,,20,80
3,20,20,80
```

- Relative Sekunden, strikt aufsteigend, Dezimalpunkt, Komma/Semikolon.
- `power_kw`: positive Leistung = Bezug, negative = Einspeisung, leer = unbekannt.
- Sollwert muss wirklich aufgezeichnet sein und bereits eine gegebenenfalls
  wirksame Begrenzung enthalten. Keine frei angenommene Sollkurve als Messbeweis.
- `limit_kw` ist die obere positive Leistungsgrenze. Untergrenzen, Frequenz,
  Spannung und Kommunikationsprotokolle werden in v1 nicht geprueft.
- Energie wird nur ueber gueltige beobachtete Intervalle integriert. Datenluecken
  und schlechte Zeitabdeckung verhindern einen scheinbaren PASS.
- Originaldatei und SHA-256 bleiben im lokalen Run-Record nachvollziehbar.

## Rueckmeldung

Bitte Fall, Run-ID und ggf. Report nennen:

1. Passt das Datenformat zu einem vorhandenen Pruefstandexport?
2. Welche reale Versuchsvorschrift soll zuerst abgebildet werden?
3. Sind Toleranz, Einschwingfrist und Reaktionszeitdefinition fachlich passend?
4. Welche zusaetzlichen Signale fehlen (z. B. SoC, Spannung, Frequenz)?

Erster Integrationsschritt: **ein** anonymisierter realer Export + eine abgestimmte
Testvorschrift. Erst danach ein read-only Connector. Geraeteansteuerung nur mit
separater Sicherheitsfreigabe des Labs, nicht durch diese Anwendung.

## Betrieb

`completed` = technisch fertig; das fachliche Ergebnis steht separat.
`queued` = der einzelne lokale Worker bearbeitet noch einen anderen Test.
Abbruch ist moeglich. Nach Backend-Neustart beginnt ein unfertiger Test mit
derselben ID von vorn; `recovery_count` steht im JSON-Export.

Stoppen mit `docker compose -f docker-compose.demo.yml down`. Nicht `down -v`
verwenden, wenn Messdaten erhalten bleiben sollen. Keine Authentifizierung;
nur localhost, nicht als gemeinsamen Netzwerkdienst verwenden.
