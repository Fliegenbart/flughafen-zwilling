# Airport Energy Check (`src/aec`)

Das Kundenwerkzeug. Ziel: Ein Flughafen gibt seine Daten ein, das Werkzeug rechnet die
reale Last und zeigt, wo es kritisch wird und was hilft. Texte nach
`docs/TEXTLEITFADEN.md`.

## Aufbau

| Ordner          | Was drin ist                                                                                                                                                                                           | Darf importieren                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `api/`          | Der eine HTTP-Client (`http.ts`) und je Thema ein Modul: Projekte, Lagebild, Lösungen, Übersicht, Austausch, Daten. Kein React.                                                                        | `model/`, `types`, `sample`, `src/shared` |
| `model/`        | Reine Fachlogik und Formatierung: Lagebild, Antwortsätze, Datenstand, Austausch-Status, Fahrzeugklassen. Kein React, kein Netz.                                                                        | `types`, `src/shared`                     |
| `views/`        | Eine Datei je Projektseite (Daten, Zusage). Größere Seiten haben einen Unterordner mit ihren Bausteinen (`daten/`).                                                                                    | alles in `src/aec`                        |
| `arbeitsplatz/` | Durchrechnen (Schritt B), der Arbeitsbildschirm für den Kundentermin: Regler, Tageskurve, Vergleich, Präsentationsmodus, PDF-Seite. `festhalten/` hält eine Reglerstellung als Lösung im Projekt fest. | alles in `src/aec`                        |
| `labraum/`      | Der Testing-Lab-Raum (`?seite=lab`) mit Eingang, Verlauf und Modellstatus.                                                                                                                             | alles in `src/aec`                        |
| oben            | App-Rahmen und Gemeinsames: `AirportEnergyCheck`, `routes`, `ProjectPage`, `Home`, `Library`, `parts`, `types`, `sample`, `scenarios`.                                                                 |                                           |

## Regeln

- **Ein Thema, ein Ort.** Gibt es etwas schon (Client, Formatierung, Fahrzeugnamen,
  Statusbeschriftungen), wird es benutzt, nicht neu geschrieben.
- **Abhängigkeiten zeigen nach innen:** `views` → `api` → `model`. `model` kennt weder
  React noch das Netz.
- **Keine Kopplung an alte Werkzeuge.** `src/lab`, `src/munich`, `src/pilot` und `App.tsx`
  sind tabu, außer als Typ-Import (API-Verträge). Einzige Naht ist `Werkstatt.tsx`, die sie
  als Detailwerkzeuge einbettet. ESLint erzwingt das (`.eslintrc.cjs`). Was beide Seiten
  brauchen, liegt in `src/shared` oder `src/ui`.
- **Klein halten.** Wächst eine Datei über rund 300 Zeilen oder mischt sie zwei Themen,
  bekommt sie einen Unterordner mit Bausteinen.
- **Antwortsätze an einer Stelle.** Der Satz zu den festgehaltenen Lösungen kommt aus dem
  Backend (`backend/app/exchange/variants.py`), der Satz zur Tageskurve aus
  `model/headline.ts`.
- **Zwei Rechnungen, eine Aussage.** Beim Ziehen rechnet `model/livePower.ts` Minute für Minute
  wie das Backend (Leistungsbilanz) auf der Ladenachfrage aus `model/liveFleet.ts` (dieselben
  Regeln wie `coupled_simulator.py`, Laderegel „uncontrolled“, keine abgestimmten Konstanten).
  Nach einer kurzen Pause ersetzt die genaue Vorschau vom Backend die Kurve
  (`backend/app/exchange/live.py`). Beide zählen „Minuten voll ausgelastet“ nur im Verkehrstag.
  Ändert sich eine Regel im Modell, schlägt `test_committed_browser_files_match_the_model` an;
  dann `backend/scripts/make_live_power_fixture.py` laufen lassen und `liveFleet.ts` anpassen.
- **Ein Beispieltag.** `beispieltag.json` entsteht aus `backend/app/exchange/demo_day.py`
  (`backend/scripts/make_live_power_fixture.py`) und speist Startseite und Beispielprojekt.
  Dieselben Werte hat das Vorführ-Projekt auf dem Server (`backend/scripts/seed_demo_project.py`).
