# Airport Energy Check (`src/aec`)

Das Kundenwerkzeug. Ziel: Ein Flughafen gibt seine Daten ein, das Werkzeug rechnet die
reale Last und zeigt, wo es kritisch wird und was hilft. Texte nach
`docs/TEXTLEITFADEN.md`.

## Aufbau

| Ordner | Was drin ist | Darf importieren |
| --- | --- | --- |
| `api/` | Der eine HTTP-Client (`http.ts`) und je Thema ein Modul: Projekte, Lagebild, Lösungen, Übersicht, Austausch, Daten. Kein React. | `model/`, `types`, `sample`, `src/shared` |
| `model/` | Reine Fachlogik und Formatierung: Lagebild, Antwortsätze, Datenstand, Austausch-Status, Fahrzeugklassen. Kein React, kein Netz. | `types`, `src/shared` |
| `views/` | Eine Datei je Seite (Daten, Tag, Engpass, Lösungen, Zusage). Größere Seiten haben einen Unterordner mit ihren Bausteinen (`daten/`, `loesungen/`). | alles in `src/aec` |
| `labraum/` | Der Testing-Lab-Raum (`?seite=lab`) mit Eingang, Verlauf und Modellstatus. | alles in `src/aec` |
| oben | App-Rahmen und Gemeinsames: `AirportEnergyCheck`, `routes`, `ProjectPage`, `Home`, `Library`, `parts`, `types`, `sample`, `scenarios`. | |

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
- **Antwortsätze an einer Stelle.** Für gerechnete Projekte kommt der Satz der Seite
  Lösungen aus dem Backend (`backend/app/exchange/variants.py`); `model/variants.ts` gilt
  nur für Beispielwerte und muss gleich formuliert sein.
