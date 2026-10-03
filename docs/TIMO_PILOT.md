# Timos Pilot: Flughafen zuerst, FlexLab separat

**Der Flughafen-Zwilling ist die Hauptdemo. FlexLab ist ein optionales
Messdaten-Zusatzwerkzeug und ersetzt weder den Flughafen noch eure vorhandenen
Pruefstaende.** Es wird keine Kenntnis der konkreten Lab-Ausstattung behauptet.

## Ein Start, drei getrennte Arbeitsbereiche

Git und Docker mit Compose benoetigt; Docker muss laufen.

```sh
git clone https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

- [Flughafen / Standard](http://localhost:5176/): acht Betriebsszenarien,
  KPI-Kurven, Playbook-/Baseline-Vergleich und Reports.
- [FlexLab / Zusatzwerkzeug](http://localhost:5176/?workspace=flexlab):
  getrennte Leistungsversuche und CSV-Auswertung.
- [Muenchen / Energiepilot](http://localhost:5176/?workspace=munich): synthetische
  Campus-Strombilanz und Ladefristen-Vergleich, kein kalibriertes FMG-Modell.
- [API-Dokumentation](http://localhost:5176/docs).

Oben im Dashboard zwischen den Arbeitsbereichen wechseln. Keine Registrierung.
Nur localhost, keine gemeinsame Netzanwendung. Keine reale Anlagensteuerung.
Die Persistenz liegt im Docker-Volume; nicht `down -v` ausfuehren.

## Zuerst Airport ausprobieren

[Airport-Testablauf, ca. 15 Minuten](TIMO_AIRPORT_PILOT.md): Guillotine und
Schwarzstart im SIL-Schnelllauf starten, technische Fertigstellung von fachlichem
PASS unterscheiden, Kurven/Report pruefen und den Playbook-Vergleich ausprobieren.
Das Modell ist nicht kalibriert. Schwarzstart ist hier ein Airport-
Kapazitaetsstresstest, kein elektrischer Schwarzstart.

## Optional FlexLab anschauen

[Separater FlexLab-Testablauf](TIMO_FLEXLAB_PILOT.md). Eigene Leistungsdaten
importieren und gegen vorab festgelegte Kriterien beurteilen. Wenn solche
Funktionen bei euch schon bestehen, ist das kein angenommener neuer Mehrwert.
Die Arbeit bleibt verfuegbar und separat gesichert.

## Muenchen-Referenzpilot ausprobieren

[10-Minuten-Ablauf und Modellgrenzen](MUNICH_PILOT.md). Zuerst Referenztag,
dann synthetischen Anschluss-Engpass vergleichen. Quellen und angenommene Werte
bleiben sichtbar getrennt. Muenchen besitzt bereits einen Energiezwilling;
welchen zusaetzlichen Systemtest das Lab beitragen kann, ist noch abzustimmen.

## Die relevante Frage fuer das TestingLab

**Waere ein gekoppeltes Flughafen- oder Standort-Energieszenario als
Systemtest eurer vorhandenen Komponenten nuetzlich, statt weitere Einzelgeraete-
Flex-Tests nachzubauen?** Das ist eine zu pruefende Mehrwert-Hypothese.

Airport Twin Core simuliert Gate-/Turnaround-Kapazitaeten. Der zusaetzliche
Muenchen-Referenzpilot bildet eine synthetische Wirkleistungsbilanz und
Ladefristen ab, nicht die reale elektrische Anlage. Ein echter Energie-/Notstromversuch
benoetigt eine abgestimmte Versuchsvorschrift, Anlagenmodell, Messsignale,
Sicherheitsgrenzen und separate Hardwarefreigabe. Keine automatische Ansteuerung
aus dieser Demo.

Bitte fuer Rueckmeldung Fall, Run-ID und Report nennen:

1. Welche Systemtest-Frage fehlt heute, trotz vorhandener Geraetetests?
2. Flughafenbetrieb oder Standortenergie/Versorgung: welcher Kontext ist relevant?
3. Welche Lasten/Komponenten, Zeitmassstaebe und Messsignale gehoeren dazu?
4. Welche konkrete Versuchsvorschrift und Kontrollmethode sollen zuerst gelten?

## Diagnose / Stoppen

```sh
docker compose -f docker-compose.demo.yml ps
docker compose -f docker-compose.demo.yml logs --tail=100 twin-core frontend
docker compose -f docker-compose.demo.yml down
```

Grafana ist optional und nur fuer Airport-Telemetrie provisioniert. Start und
oeffentliche lokale Demozugangsdaten stehen im [README](../README.md).
Bei vorhandener Monitoring-Installation die beiden Compose-Dateien auch beim
Neuaufbau zusammen angeben. `queued` bedeutet: der serielle Worker wartet noch;
Logs bei dauerhaftem Warten pruefen, keine Betriebsdateien manuell loeschen.
