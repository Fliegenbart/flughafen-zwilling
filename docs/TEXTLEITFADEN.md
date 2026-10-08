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

## Was wir nicht schreiben

Diese Muster lassen Texte maschinell klingen. Sie kommen nicht vor.

- **Doppelpunkt-Enthüllungen.** Nicht „Der Haken: Der Anschluss …“, sondern ein
  normaler Satz: „Dafür ist der Anschluss …“.
- **Kurz-kurz-Takt.** Nicht zwei Mini-Sätze, die einander erklären („Noch nichts
  belegt. Wir rechnen mit Annahmen.“). Ein Satz, der den Gedanken trägt.
- **Dreierreihen** („wann, ob und was“), wenn zwei Dinge reichen.
- **Text über die Seite.** Kein „Hier steht …“, „Sie sehen …“, „Diese Seite …“.
- **Dauernde Absicherung.** Wie sicher eine Zahl ist, steht an der Sicherheitsstufe.
  Fließtext wiederholt das nicht.
- **Weichmacher** wie „schlicht“, „praktisch“, „spürbar“, „genau“, „womöglich“. Wo
  eine Schwelle dahintersteht, nennen wir sie.
- **Rhetorische Fragen.** Die Frage im Seitenkopf ist die einzige Frage der Seite.
  Abschnittstitel sind Aussagen.
- **Höflichkeitskaskaden** in Meldungen. Was ist passiert, was kann man tun. Kein
  „Bitte versuchen Sie es gleich noch einmal“.

Zum Schluss jede Seite einmal laut lesen. Was man einem Kollegen so nicht sagen
würde, wird umgeschrieben.

## Tonlage je Seite

Meist sitzt ein E.ON-Drive-Projektmanager mit dem Flughafen vor dem Bildschirm. Der
Text muss also nicht alles erklären, aber jede Zahl muss für sich stehen.

| Seite | Ton |
| --- | --- |
| Startseite | einladend, konkret, wenig Text |
| Daten | sachlich wie eine Checkliste |
| Durchrechnen | knapp wie ein Lagebericht: Uhrzeit, Menge, Folge; Vergleiche mit Zahlen statt Wertungen |
| Zusage | nüchtern, verbindlich |
| Meldungen | trocken und hilfreich |
| Testing-Lab | kollegial unter Fachleuten; Fachbegriffe sind erlaubt |

## Wörterbuch

| Statt | Schreiben wir |
| --- | --- |
| Anschlussgrenze | Netzanschluss, „was der Anschluss hergibt“ |
| Lastgang | Strombedarf über den Tag |
| Engpassfenster | knappe Phase |
| Basis | heutiger Stand |
| Variante | Lösung, Variante nur im Fließtext |
| Vorschau | Rechnung beim Verstellen, nicht gespeichert; „festhalten“ macht daraus eine Lösung im Projekt |
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
