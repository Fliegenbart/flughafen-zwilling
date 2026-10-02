# Airport Twin Core: Scope

Die aktive Implementierung umfasst acht Airport-Cases, KPI-Telemetrie,
serielle Worker mit Restart-Recovery, Playbook-Suche mit Baseline-Vergleich,
modellbasierte Forecasts, Reports und optionale Live-Observability.

Domain: `airport_turnaround_v1`. Parameter: Gates, Crew, Gepaeckkapazitaet,
Runway-Slots und Ankunfts-/Abflugraten. Stoerungen: Kapazitaetseinbruch,
Wetter, Gepaeck-/Security-/Enteisungsverzoegerungen und Recovery-Events.

Referenzschwellen: OTP >=85%, Turnaround <=55 min, Gate-Auslastung <=92%.
Diese Demo-Schwellen sind kein empirischer Nachweis geeigneter Flughafen-SLAs.

Die Cases und Startbefehle stehen im Root-README. Implementierungsprovenienz,
Tests und Modellgrenzen: `RECOVERY_AUDIT.md`. Timos Pilot: `TIMO_PILOT.md`.

## Nicht enthalten

- ADS-B/AODB oder andere Echtzeit-Flugdatenquellen.
- Kalibrierung an einem konkreten Flughafen oder reale Prognoseguete.
- Elektrische Bodenfahrzeuge, Ladeleistung und Energieversorgung im Airport-Modell.
- Automatische Aktuierung, externe Queue, mehrere Backend-Prozesse oder Hosting.
- Confidence-/Uncertainty-Layer mit unabhaengiger empirischer Abnahme.

Der naechste sinnvolle Schritt ist die fachliche Pilot-Auswertung, nicht ein
Neubau der gesamten technischen Plattform.
