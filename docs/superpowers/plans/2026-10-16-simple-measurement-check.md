# Einfacher Lastprofil- und Messdatenablauf

## Freigegebener Umfang

Ein Flughafen-Anwendungsfall, keine Anlagensteuerung. Die aktuelle Variante
wird als unveraenderlicher SIL-Lauf uebernommen. Danach genau drei Schritte:
Profil herunterladen, CSV lokal auswaehlen, Abweichungen ansehen. Keine
Messdatei wird im Schnellvergleich hochgeladen oder persistent gespeichert.
Eine explizit synthetische Uebungsdatei macht den Ablauf ohne Lab-Daten testbar.
Kein PASS, keine empirische Validierung und keine automatische Kalibrierung.
Der bisherige formale Workflow bleibt unter weiteren Nachweisen erhalten.

## Umsetzung und Pruefung

1. Tests fuer einen read-only Profil-Endpunkt schreiben: fehlender/ungeeigneter
   Lauf, nicht verifizierte Artefakte, Metrik-Whitelist, UTC-Minuten und Auth.
   Bestehende `_verified_coupled_series` wiederverwenden, keine neue Audit-Logik.
2. Reine CSV-/Diagnosefunktionen mit Tests fuer Export, Rundlauf, Zeitdeckung,
   Einheitenverdacht, fehlende/negative/nicht-endliche Werte, Duplikate und
   synthetische Herkunft. Keine Interpolation, Umdeutung oder positiven Urteile.
3. Kompakte UI im vorhandenen Design: Profil, leere Vorlage, Uebungsdatei,
   Dateiauswahl und Drag-and-drop; Ergebnis mit MAE, Energie und Spitzenwerten.
   Ergebnis bei Datei-/Lauf-/Metrikwechsel sofort verwerfen. Alte Experten-UI
   nur auf Wunsch laden. Ausgewaehlte Variante ohne Chart-Umweg uebergeben.
4. Backend-/Frontend-Tests, Lint, Typecheck, Build, Archivcheck. Browser:
   echter Datei-Rundlauf plus Negativfall, Desktop und 390 px, Konsole pruefen.
5. Geprueften Remote-Commit mit gruener CI deployen. Vorher nur Airport-Backend
   stoppen und Volume offline sichern. Genau ein Worker, unveraenderte Netze,
   Proxy und andere Stacks. Ruecknahmeziel ist der live verifizierte Vorrelease.
   Live-Abnahme und Release-Nachweis dokumentieren, Commit/Push verifizieren.

## Dateigrenzen

- `backend/app/pilot/measurement_profile.py`: read-only Profilprojektion.
- `src/aec/labraum/measurementData.ts`: reiner lokaler CSV-Vertrag/Diagnose.
- `src/aec/labraum/QuickMeasurementCheck.tsx` und CSS: gefuehrter Einstieg.
- `LabPage.tsx`, `MeasurementHandoff.tsx`, `ElectrificationStudy.tsx`: Integration.
- Bestehende Simulation, Hardwareadapter und formale Bewertung bleiben unveraendert.
