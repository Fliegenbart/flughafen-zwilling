# Pilot Studio: Vorfuehrung fuer Timo und Christoph

Der Flughafen bleibt der Produktkern. FlexLab bleibt separat erhalten. Diese
Version ist ein vorfuehrbarer Methoden-/Datenpilot, kein kalibrierter Flughafen-
Zwilling und keine Freigabe realer Anlagen.

## Lokal starten

```sh
docker compose -f docker-compose.demo.yml up --build -d
```

Muenchen unter `http://localhost:5176/?workspace=munich` oeffnen. Ein Backend-
Prozess, keine echten Adapter, kein Influx-Token. Daten liegen im persistenten
Volume. Fuer Kundendaten persoenliche Anmeldung aktivieren und eine eigene
Instanz verwenden: [Betrieb, Nutzer und Backup](PILOT_OPERATIONS.md).

## Zehn Minuten Vorfuehrung

Die Oberflaeche fuehrt mit einem Schritt-Navigator (`?schritt=system|betrieb|
robustheit|pilot|nachweise`, Pfeiltasten). Jede Aussage traegt einen
Evidenzstatus: Annahme, synthetisch, modellintern geprueft, empirisch offen – nie gruen.

1. **System verstehen:** Systemlandkarte oeffnen. Netz, PV, BHKW, Speicher,
   Ladeabgaenge und Fahrzeuge anklicken. Energiefluss ist die technische
   Zweitansicht, kein echter Stromlaufplan. Ein Parameterwechsel ist nur ein
   Entwurf; alte Ergebnisse bleiben eingefroren.
2. **Betriebswirkung pruefen:** Einen bereits importierten Flugplantag waehlen
   oder den offiziellen Plan manuell importieren. Quellen und ungeklärte
   Mehrfachgruppen pruefen. Gekoppelten Vergleich starten. Aufgabenbereitschaft,
   Energie-/Ressourcenwartezeit und Parkhaus-Trade-offs ansehen. Nullvorteile
   sind erlaubte Ergebnisse.
3. **Robustheit:** Unter demselben Flugplan und Seed vier Varianten mit zwei
   Laderegeln starten: Basis, 20 % weniger Netzimport, ein Bus-Ladepunkt aus,
   halber PV-Profilfaktor. Acht Runs laufen seriell. Das ist ein deterministischer
   Stress-Screen, kein statistischer Zuverlaessigkeitsnachweis.
4. **Konkreten Pilot vereinbaren:** Schritt 4 im Navigator oeffnen.
   Projekt, Entscheidungsfrage und Systemgrenze erfassen, dann
   **Abnahmekriterien vorab festlegen und sperren** (MAE, Energiefehler,
   Mindestpunkte, Mindestabdeckung). Gesperrte Kriterien sind unveraenderlich und
   werden mit SHA256 angezeigt und exportiert. Ein Holdout-Import ist erst danach
   moeglich.
   Fuer die Vorfuehrung `Synthetisches Beispiel laden`. Die Werte sind explizit
   erfunden. Eigene Grenzen eingeben und bewerten: CSV-Modellwerte allein
   ergeben wegen ungepruefter Herkunft bewusst `NOT_EVALUABLE`.
5. **Nachweise mitnehmen:** Entscheidungsbericht und Testpaket herunterladen.
   Das Paket enthaelt Originalquellen, Rollen, Bewertungen, Audit, Hashmanifest
   und einen read-only Versuchsentwurf. Es ist keine Hardware-Versuchserlaubnis.

## Echte Messdaten anschliessen

UTF-8 CSV mit `timestamp,measured_kw` und optional `model_kw`. ISO-Zeitstempel
mit Zeitzone, kW-Wirkleistung, explizite Messgrenze und Quelle. Keine erfundenen
Werte fuer Luecken. Vorzeichenkonvention dokumentieren. Maximal 5 MiB/100.000
Zeilen. Doppelte/nicht aufsteigende Zeitstempel, NaN/Inf, fehlende Messwerte und
unregelmaessige Abstaende sperren die Bewertung. Auch abgewiesene Imports
bleiben als nicht auswertbare Nachweise erhalten.

Die Datenrollen `calibration`, `holdout`, `lab` bleiben getrennt. Kalibrier- und
Holdout-Zeitraeume duerfen sich innerhalb eines Projekts nicht ueberlappen.
Das allein kalibriert noch kein Modell; Parameter muessen fachlich ermittelt
und die gewaehlten Fehlertoleranzen vor einer unabhaengigen Pruefung vereinbart
werden. Regelmaessige Reihen beweisen keine vollstaendige Messabdeckung ausserhalb
ihres gelieferten Zeitfensters.

Fuer den **Run-Abgleich** `Minutenmittel am Intervallende` waehlen und einen
abgeschlossenen gekoppelten Run angeben. Die API prueft dessen Artefaktintegritaet
und uebernimmt die Modellwerte selbst. Zulässig sind Netzimport, Vorfeld-Laden
oder Parkhaus-Laden. Der vollstaendige Run-Zeitraum einschliesslich Vor-/Nachlauf
muss mit exakt passenden UTC-Minuten vorliegen. Kein Interpolieren, Verschieben
oder Auswaehlen nur guter Ausschnitte. Punktmessungen werden nicht stillschweigend
als Intervallmittel umgedeutet. Originaldaten bleiben unveraendert; Replay und
Run-Nachweise werden mit Hashes separat eingefroren und exportiert.

`PASS` bedeutet nur: dieser quantitative Vergleich erfuellt die gespeicherten
Fehlergrenzen. Es bedeutet weder empirische Gesamtvalidierung noch elektrische
Sicherheit oder reale Abflugpuenktlichkeit. Eine synthetisch aus dem Modell
abgeleitete Messreihe kann technisch PASS ergeben, bleibt aber zirkulaer und
ist **kein** unabhaengiger Validierungsnachweis.

## Wirtschaftlicher Ausschnitt

Nach einem geprueften Regelvergleich koennen eigene Bezugspreise und
Einspeiseerloese mit Quellenhinweis eingegeben werden. Berechnet wird nur der
Netzenergie-Kostenbaustein des simulierten Zeitraums. Kein Jahres-ROI, keine
Investitionsempfehlung. Brennstoff, Leistungspreis, CAPEX, Steuern, Batteriealterung
und Ausfallkosten sind ausgeschlossen. End-SOC und erbrachte Aufgaben mitbewerten.

## Vor echtem Einsatz noch gemeinsam klaeren

- Welcher Abgang und welche Flotte bilden den ersten klar abgegrenzten Pilot?
- Welche originale Messreihe, Missions-/Ladesessiondaten und Kontrollstrategie
  kann der Betreiber freigeben?
- Welche Fehlergrenzen und welche unabhaengige Holdout-Periode gelten vorab?
- Welche vorhandene Lab-Komponente soll mit welcher separat freigegebenen
  Versuchsvorschrift geprueft werden?

Technischer lokaler End-to-End-Smoke (erzeugt synthetische QA-Projekte):

```sh
python3 scripts/smoke_pilot.py --base-url http://localhost:5176 --run-id RUN_ID
```

## Toleranzen-Sperre und Bewertungsgruende

API: `GET/PUT /api/v1/pilot/projects/{id}/tolerances` (`lock: true` sperrt). Der erste
Holdout-Import sperrt einen Entwurf automatisch. **PASS nur fuer Holdout** mit vorab
gesperrten Kriterien; Kalibrier- und Labordaten bleiben `NOT_EVALUABLE`
(`role_not_holdout`). Weitere Gruende, in der UI auf Deutsch erklaert:
`tolerances_not_frozen`, `tolerances_not_locked`, `tolerances_set_after_import`,
`insufficient_rows`, `insufficient_coverage`, `tolerance_mae_too_loose_for_measurement`,
`circular`, `unit_suspect`, `metric_overflow`, `calibration_holdout_overlap`,
`model_provenance_*`, `source_*`.
