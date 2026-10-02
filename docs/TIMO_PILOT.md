# Timos 20-Minuten-Pilot

## Auftrag

Nicht "Kann die Software einen Flughafen optimieren?", sondern:
**Hilft eine reproduzierbare Stoerungs-/Gegenmassnahmen-Simulation dem Lab,
eine konkrete Testfrage zu formulieren und Ergebnisse nachvollziehbar zu vergleichen?**

Alle KPIs sind unkalibrierte Modellwerte. Die SIL-Validierung bestaetigt die
Reproduktion im selben Modell, nicht die Wirkung an einem echten Flughafen.

## Start

Git, Docker Desktop und eine Internetverbindung fuer den ersten Build genuegen.
Im Terminal:

```sh
git clone --branch codex/recovery-audit https://github.com/Fliegenbart/flughafen-zwilling.git
cd flughafen-zwilling
docker compose -f docker-compose.demo.yml up --build -d
```

Browser: [http://localhost:5176](http://localhost:5176). Kein Login erforderlich.
Der erste Build kann mehrere Minuten dauern. Bei Problemen:

```sh
docker compose -f docker-compose.demo.yml ps
docker compose -f docker-compose.demo.yml logs --tail=100 twin-core frontend
```

Andere Startwege und optionale Grafana-Anbindung stehen im Root-README.

## Drei konkrete Tests

1. **Spitzenwelle:** `API pruefen`, Profil waehlen, `Backend Run starten`.
   Run-ID und KPI-Kurven beobachten, bis der Run `completed` ist.
2. **Guillotine-Test:** gleiche Modellparameter verwenden. Was passiert mit
   OTP/Delay, wenn Kapazitaeten gleichzeitig einbrechen? Anschliessend
   `Playbook synthetisieren`: Baseline, Empfehlung, Actions und Deltas lesen.
3. **Schwarzstart:** Recovery im Kapazitaetsmodell beobachten und ein zweites
   Playbook erstellen. `Bericht erzeugen` oeffnet den HTML-/Druckreport.

Ein Live-Run dauert ungefaehr 60 Sekunden. Das ist hier auch ein
60-Sekunden-Modellfenster, **keine beschleunigte Flughafenstunde**.
Die Forecast-Funktion kann laengere Modellhorizonte untersuchen, bleibt aber
im selben vereinfachten Modell.

`completed` bedeutet technisch fertig, nicht automatisch KPI-PASS.
`queued` bedeutet: der einzige RunWorker arbeitet noch an einem anderen Run
oder an einem Playbook-Validierungsrun. Pro Backend genau ein Prozess.

## Rueckmeldung an David

Bitte je Beobachtung Fall, Seed, Run-ID und ggf. Report nennen.

1. Startet das Tool ohne Hilfe und sind die Ergebnisse verstaendlich?
2. Welche Modellreaktion ist plausibel, welche fachlich falsch?
3. Welche reale Lab-Testfrage koennte damit untersucht werden?
4. Welche Messdaten und welche reale Vergleichsmethode waeren dafuer notwendig?

Nicht jede Gegenmassnahme muss alle KPIs verbessern. Engpassverschiebung und
unwirksame Eingriffe sind ebenfalls relevante Ergebnisse.

## Bedeutung fuer E.ON TestingLab

Der vorhandene Nutzen ist ein wiederholbarer Testablauf mit Stoerung,
Gegenmassnahme, Grenzwerten, Trace und Report. Ein spezifischer E.ON-Mehrwert
ist noch eine Hypothese: etwa die Erholung nach Ausfaellen kritischer
Infrastruktur. Eine Kopplung mit elektrischen Bodenfahrzeugen, Ladeleistung
und Energieversorgung ist **noch nicht implementiert**.

Nach dem Pilot zuerst eine reale Testfrage mit Timo festlegen, dann
Zeitmodell, Ressourcenwirkung und Validierung an Messdaten entwickeln.
Kein weiterer Feature-Ausbau ohne diese fachliche Grundlage.

## Sicherer Betrieb

Die Demo ist an localhost gebunden, hat keine API-Authentifizierung und
verwendet keine echten Betriebsdaten. Nicht als gehosteten Dienst oder an
Live-Hardware einsetzen. Stoppen mit `docker compose -f docker-compose.demo.yml down`;
Volumes nicht loeschen, wenn die Reports erhalten bleiben sollen.
