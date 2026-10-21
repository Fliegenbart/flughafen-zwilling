# Produktsteckbrief Airport Energy Check

Verbindlich für jede Änderung an der Kundensicht. Was hier nicht hilft, kommt nicht
in die Kundensicht. Vereinbart am 16.10.2026.

## Zweck

Ein Vertriebler von E.ON Drive zeigt einem Flughafen live, dass sein Netzanschluss
bei der Elektrifizierung knapp wird und wie das E.ON-Ökosystem das Stufe für Stufe
löst. Jede Zahl lässt sich im Folgetermin mit den echten Daten des Flughafens belegen.

## Wer bedient es

Christoph Ebert oder ein Vertriebler von E.ON Drive, am Laptop mit Beamer. Der
Flughafen schaut zu und fragt nach. Erklären darf der Mensch, das Tool muss nur
eindeutig sein. Kein Selbstbedienungs-Portal, kein E.ON-Branding vor dem Kauf.

## Die Kernfrage

„Reicht unser Anschluss, wenn wir das Vorfeld elektrifizieren, und was bringt
jeder Baustein?“ Jede Seite der Kundensicht beantwortet diese Frage oder führt
direkt zu ihr.

## Die Geschichte: das Ökosystem, Stufe für Stufe

E.ON Drive verkauft Flughäfen das komplette Ökosystem. Das Tool zeigt, was jeder
Baustein am Anschluss bewirkt:

| Stufe | Baustein | Was der Flughafen sieht |
| --- | --- | --- |
| 1 | Ladeinfrastruktur Vorfeld | So viel Anschluss braucht direktes Laden |
| 2 | + Lademanagement | so viel weniger, ohne Netzausbau |
| 3 | + Speicher | noch weniger |
| 4 | + Photovoltaik | weniger Netzbezug am Tag |
| 5 | Parkhaus (Mitarbeiter, Gäste, Mietwagen) | dieselbe Leitung, gemeinsam gesteuert |
| 6 | Netzausbau | wenn alles nicht reicht: wie viel genau |

Der Satz, den der Vertriebler sagen will: „Jeder Baustein spart Anschluss,
zusammen aus einer Hand.“

## Was in die Kundensicht gehört

- Wenige Regler: Elektroanteil der Flotte, Anschluss, Speicher, Photovoltaik, Parkhaus.
- Live: Jede Reglerbewegung zeigt das Ergebnis in unter einer Sekunde. Für den
  Beispielflughafen wird dafür vorab gerechnet; ein Kundenprojekt rechnet der
  Server vor dem Termin.
- Eine Antwort als Satz und ein Diagramm (die Treppe), darunter die Kurve über den
  Tag, die zeigt, wann es knapp wird.
- Eine Seite als PDF zum Hinterlassen, ein Präsentationsmodus für den Beamer.
- Ein eigenes Projekt mit Flugplan und Flotte des Flughafens, vorbereitet vor dem Termin.
- „So geht es weiter“ statt „Zusage“: Handout, Liste der Daten, die der Flughafen
  liefern soll, und das Angebot „Wir belegen die Zahlen mit einer Messung“.

## Was nicht in die Kundensicht gehört

Bleibt im Code und im Testing-Lab-Raum, taucht aber in keinem Menü auf, durch das
der Vertriebler im Termin klickt:

- Messdatei-Vergleich, Lauf-IDs, SIL-Läufe, Prüfgrenzen, Evidenzdetails.
- Abfertigungssimulation, München-Pilot, Pilot Studio, FlexLab-Werkbank.
- Kosten und Rendite, bis E.ON Preise freigibt.

## Woran wir Erfolg messen

1. Der Vertriebler zeigt die Geschichte in drei Minuten, ohne die Bedienung zu erklären.
2. Jeder Regler antwortet sofort.
3. Wer zuschaut, versteht die Hauptaussage in zehn Sekunden.
4. Auf dem Bildschirm widerspricht sich nichts. Jede Zahl lässt sich mit einer
   genannten Annahme begründen.

## Ehrlichkeit

Das Modell ist ein unkalibrierter Methodenprototyp (siehe `AGENTS.md`). Das steht
einmal, klar und ruhig da, nicht in jedem Satz. Vorab-Rechnungen sind echte
Modellrechnungen, keine Schätzungen. Der Beispielflughafen ist erfunden.

## Stand am 16.10.2026 und was fehlt

| Teil | Stand | Lücke zum Steckbrief |
| --- | --- | --- |
| Stufe 1 Ladeinfrastruktur | ohne jede Steuerung gerechnet (höchste Netzlast) | – |
| Stufen 2–3 (Lademanagement, Speicher) | Rechnung steht (`airport_electrification_v3`), vorab für alle Reglerstellungen gerechnet | Speicherregel ist einfach (lädt unter 80 % des Anschlusses aus dem Netz nach, muss am Ende voll sein); an 157 von 2.860 Stellungen, meist bei viel Parkhaus, senkt der Speicher den Bedarf nicht. Die Treppe schaltet Stufe 3 dann ab, statt eine höhere Zahl zu zeigen |
| Stufe 4 Photovoltaik | Regler (0 bis 4.000 kWp), wirkt auf alle Stufen | noch keine eigene Stufe der Treppe |
| Stufe 5 Parkhaus | Regler (0 bis 200 Ladevorgänge am Tag) | Parkhaus wird nicht gesteuert, kein gemeinsames Lademanagement |
| Stufe 6 Netzausbau | als Satz und rotes Schild unter der Treppe | – |
| Kundensicht | Startseite: ein Satz, Treppe, Kurve, „So geht es weiter“; Altwerkzeuge unter `?seite=fachleute` | eigenes Kundenprojekt noch nicht an die Treppe angeschlossen |
| PDF, Präsentationsmodus | Taste P, eine A4-Seite als Handout | – |
| Kosten | nicht enthalten | erst nach Preisfreigabe durch E.ON |
