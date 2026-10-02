# FlexLab v1: lokale Abnahme

Stand: 2026-10-02, lokale Docker-Demo. Keine reale Anlage angeschlossen.

## Geprueft

- 88 Backend-Tests, einschliesslich aller 67 vorhandenen Airport-Tests.
- 28 Frontend-Tests, einschliesslich aller 18 vorhandenen Airport-Tests.
- ESLint, TypeScript, Produktionsbuild und Ruff fuer den neuen Backend-Kern.
- Archivpruefsummen unveraendert (`scripts/check-recovery.sh`).
- Docker-Build und gesunder Start mit bestehendem Datenvolume.
- API-Smoketest: CSV-Import, Simulation, Baseline-Deltas, Artefakte, Abbruch.
- Sollwertsprung und Flex-Abregelung = PASS mit Referenzkonfiguration.
- Anschlusslimit = FAIL wegen beobachteter Limitverletzung; kein verstecktes
  Aufweichen der Grenzwerte.
- Telemetrieausfall = Nicht bewertbar; fehlende Werte bleiben als Luecken sichtbar.
- Backend-Neustart waehrend eines laufenden Tests: dieselbe ID beendet den
  vollstaendigen Neustart, `recovery_count=1`.
- Browser: Test starten, CSV-Beispiel herunterladen, normale Datei-Auswahl,
  Import auswerten, Historie oeffnen und vergleichbare Baseline auswaehlen.
- Standalone-HTML-Bericht gerendert, inklusive Profil, Kriterien und Provenienz.
- 1440-px-Desktop und 390-px-Mobilansicht. Seitenbreite bei 390 px exakt 390 px;
  Tabellen koennen innerhalb ihres Containers horizontal scrollen.

## Noch nicht nachgewiesen

- Nutzen und korrekte Versuchskriterien an Timos realen Messreihen.
- Kalibrierung, reale Protokoll-/Geraeteintegration oder geschlossener Regelkreis.
- OCPP-/EEBUS-Konformitaet, Netzschutz, Frequenz-/Spannungsqualitaet.
- Netzwerkbetrieb mit Authentifizierung, Mehrbenutzer-/Multiprozessbetrieb.
- Neue FlexLab-Runs im bisherigen Airport-Grafana-Dashboard (nicht implementiert).

Bekannte Testumgebungswarnung: Starlette-TestClient meldet eine zukuenftige
HTTPX-Umstellung. Tests bestehen; die Warnung betrifft nicht die Live-Auswertung.

## Naechster fachlicher Gate

Ein anonymisierter Messdatenexport und eine konkrete Versuchsvorschrift aus dem
Lab. Zuerst Zeitbasis, Vorzeichen, Sollwertbedeutung, Toleranzband, Einschwingfrist
und Sensorqualitaet gemeinsam abnehmen. Erst danach ein read-only Live-Connector.
