# Airport-Pilot fuer Timo

Start: [gemeinsame Anleitung](TIMO_PILOT.md).
[Airport Twin Core](http://localhost:5176/?workspace=airport) oeffnen.

## 1. Run pruefen

1. `API pruefen`: API muss OK anzeigen.
2. `Testprofil`: `Guillotine-Test` waehlen.
3. `Run Mode`: `SIL Schnelllauf` waehlen. `Backend Run starten` klicken.
4. Run-ID notieren. Zustand geht von queued/running nach completed.
5. OTP, Turnaround, Gate-/Crew-Auslastung, Queues und Delay-Kurven lesen.
6. `Bericht erzeugen`: HTML-Report / Druckdialog. Szenario und Run-ID pruefen.
7. Danach `Schwarzstart` mit denselben Modellparametern starten.

`completed` bedeutet technisch fertig, nicht automatisch fachlich PASS.
60 Demo-Sekunden sind 60 Modellsekunden, keine komprimierte Betriebsstunde.
Fraktionale Fluege und geringe Gate-Belegung sind Grenzen des heutigen
aggregierten Modells, keine realistischen Verkehrsprognosen.

Die anderen sechs Cases stehen im selben Dropdown. Die Parameter darunter
lassen sich veraendern; ohne eigene Referenzdaten sind Ergebnisse weiterhin
unkalibrierte Modellwerte. Ein geaenderter Fall ist kein Vergleich derselben Baseline.

## 2. Playbook-Vergleich pruefen

1. `Schwarzstart` und das gewuenschte Referenzprofil waehlen.
2. Im `Playbook Synthesizer` den Modus `Szenario` belassen.
3. `Playbook synthetisieren` klicken. Der Budgetwert ist ein Suchbudget;
   Warteschlange und Validierungsruns koennen die Gesamtzeit verlaengern.
4. Terminaler Job: Baseline, Empfehlung, Pareto-Alternativen und Validation-Run-IDs
   pruefen. Die technische Fertigstellung ist getrennt von der Machbarkeit.
5. `playbook.md`, `frontier.json` und `summary.csv` herunterladen.

Eine Empfehlung ohne Massnahmen ist zulaessig, wenn die Baseline die
konfigurierten Grenzen bereits erfuellt. Es wird kein positiver Nutzen erzwungen.
Kosten sind dimensionslose Demo-Punkte, keine Euro-Betriebskosten.
Validierung erfolgt im selben SIL-Modell, nicht unabhaengig an realer Hardware.

Arbeitsbereich-Wechsel oder Seiten-Neuladen beendet den Job nicht; Job-/Run-ID
fuer den API-Record sichern. Ein Backend-Neustart startet unfertige Jobs sauber
mit derselben ID neu. Kein Zwischenstand wird als Fortsetzung verkauft.

## 3. Optional Live-Grafana

Die Monitoring-Compose-Datei zusaetzlich aktivieren (siehe README).
`Demo Live starten` fuehrt das Szenario in Echtzeit aus und oeffnet das
[Cockpit](http://localhost:3000/d/airport-twin-cockpit/airport-twin-cockpit).
`admin` / `airport-demo`, ausschliesslich lokale Demo.
Refresh alle 10 Sekunden; richtigen Run waehlen. Auch dieser Echtzeitmodus
verwendet simulierte Adapter, keine echte Flughafenanlage.

## Grenzen und Rueckmeldung

Schwarzstart ist ein **Kapazitaets-Recovery-Szenario**, kein elektrischer
Schwarzstart. Flughafenenergie, Ladeinfrastruktur, PV, Batterie, Notstrom und
elektrische Schutzgrenzen sind noch nicht gekoppelt.

Bitte zurueckmelden: konkrete Systemtest-Frage, Case, Run-ID, erwartetes Verhalten
und beobachtetes Ergebnis. Vor Hardwareintegration erst Versuchsvorschrift,
Einheiten, Zeitmodell und Sicherheitsfreigabe festlegen.
