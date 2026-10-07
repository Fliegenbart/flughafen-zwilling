# Textleitfaden Airport Energy Check

Für wen wir schreiben: Projektleute bei E.ON Drive und Verantwortliche am Flughafen
(Technik, Bodenverkehrsdienste, Energie). Sie kennen Schlepper, Abflugwellen und
Netzanschlüsse, aber keine Modellbegriffe. Im Testing-Lab-Raum schreiben wir für
Ingenieurinnen und Ingenieure; dort darf es fachlicher sein, aber nie maschinell.

## Sieben Regeln

1. **Erst die Bedeutung, dann die Zahl.** „Um 06:40 reicht der Strom nicht“ statt
   „Bedarf über Anschlussgrenze“.
2. **Sie-Form, aktiv, konkret.** Wer tut was? Kein Passiv und kein Substantivstil.
3. **Überschriften sagen etwas.** Keine Etiketten wie „Kennzahlen“, „Lesehilfe“,
   „Hebel“. Lieber eine Frage oder eine Aussage, die man auch ohne Text darunter
   versteht.
4. **Knöpfe sagen, was passiert.** „Lösungen durchrechnen“, nicht „Ausführen“.
5. **Kein Maschinenraum in der Kundensicht.** Nicht: Lauf, Seed, Welt-Hash, Engine,
   Holdout, Evidenzstufe, model_checked, API, Import, Basis. Diese Wörter dürfen
   höchstens in eingeklappten Details für Fachleute oder im Lab-Raum stehen.
6. **Ehrlich, aber menschlich.** Unsicherheit klar benennen („gerechnet, noch nicht
   gemessen“), ohne Juristendeutsch. Keine Versprechen, die das Modell nicht hält.
7. **Kurz.** Ein Gedanke pro Satz, selten mehr als 20 Wörter.

## Wörterbuch

| Statt | Schreiben wir |
| --- | --- |
| Anschlussgrenze | Netzanschluss, „was der Anschluss hergibt“ |
| Lastgang | Strombedarf über den Tag |
| Engpassfenster | knappe Phase |
| Basis | heutiger Stand |
| Variante | Lösung (Seitentitel), Variante nur im Fließtext |
| Pp. | Prozentpunkte |
| verspätete Abfertigung | nicht rechtzeitig fertig |
| Werkstatt | Detailwerkzeug (für Fachleute) |
| Beispieldaten | Beispielwerte |
| Holdout | Prüfmessung (zurückgehaltene Messreihe) |
| Kalibrierung | Abstimmung des Modells |
| Evidenz / Evidenzstufe | „Wie sicher ist das?“ |

## Wie sicher ist eine Zahl? (Stufen)

| Intern | Anzeige | Kurz erklärt |
| --- | --- | --- |
| assumption | Annahme | Eingesetzter Wert, noch ohne Beleg. |
| synthetic | Beispielwerte | Erfunden oder erzeugt, nur zum Ausprobieren. |
| model_checked | rechnerisch geprüft | Das Modell rechnet in sich stimmig. Mit der Wirklichkeit verglichen ist es noch nicht. |
| empirical_open | noch nicht gemessen | Eine Messung, die das bestätigt, steht aus. |
| empirical_passed | durch Messung bestätigt | Eine vorher festgelegte Prüfmessung hat es bestätigt, für genau diesen Vergleich. |
