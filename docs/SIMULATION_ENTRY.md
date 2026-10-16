# Flughafen-Simulation: Einstieg

Der Haupteinstieg ist ein synthetischer Demonstrationstag. Die Regler fuer
Netzanschluss, Speicher, PV und zusaetzliche Fahrzeuge rufen den gekoppelten
Backend-Simulator auf. Eine lokale Netz-Naeherung waehrend des Verstellens ist
explizit vorlaeufig; Betriebskennzahlen erscheinen erst nach der Serverantwort.
Bei Fehlern gibt es keine als Rechnung dargestellten Ersatz-Beispielwerte.

`POST /api/v1/demo/simulation` ist begrenzt und zustandslos. Der fest definierte
synthetische Flugplan und Seed bleiben gleich. Die Berechnungs-ID identifiziert
die Eingaben/Engine, ist kein persistierter Run und keine empirische Validierung.
Die Antwort enthaelt Konfiguration, Hashes und berechnete Minutenreihen/KPIs.
Keine echten Adapter, keine Hardwarewrites, keine Kundendaten noetig.

Die Pruefskizze exportiert die aktuelle fertig berechnete Variante und ihre
Ausgangslage als lesbares HTML oder JSON. Eine Betriebskennzahl zur rechtzeitigen
Abfertigungsbereitschaft ist keine reale Abflug-OTP. Ein versiegelter Projektlauf
und unabhaengige Messdatenpruefung bleiben separate Arbeitsablaeufe.

Abnahme:

```sh
python3 scripts/smoke_public_simulation.py --base-url https://labpulse.ai/airport
```

Der Smoke berechnet dieselbe Ausgangslage zweimal und variiert danach jede
Stellschraube separat. Er schreibt keine Projekte und startet keine Hardware.
Im Browser zusaetzlich Start-CTA, Regler, Laden/Fehlerstatus, Zuruecksetzen,
Export und schmale Ansicht pruefen. Die oeffentliche Demo bleibt ohne Passwort;
keine privaten Daten hochladen.
