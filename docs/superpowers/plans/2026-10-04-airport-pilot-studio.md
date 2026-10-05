# Airport Pilot Studio

Freigegebener Ausbau vom 04.10.2026. Airport bleibt primaer; FlexLab und Archive bleiben unveraendert.

## Lieferumfang

1. Interaktive Systemlandkarte und technische Energieflussansicht am gekoppelten Simulator. Entwurf und berechnete Evidenz klar trennen.
2. Persistentes Pilotprojekt mit konkreter Entscheidungsfrage, Messgrenze und Abnahmekriterien. CSV-Messdaten mit Originaldatei, Hash, Qualitaetspruefung, separater Kalibrierung/Holdout/Lab-Evidenz.
3. Gepaarter Mess-/Modellvergleich mit eingefrorenen Bewertungsschwellen. Fehlende/fehlerhafte Daten ergeben niemals PASS. Importierte Modellwerte sind keine automatisch verifizierte Run-Provenienz.
4. Begrenzte deterministische Stress-Suite mit unveraendertem Flugplan/Seed und expliziten Parameterabweichungen; keine statistischen Vertrauensintervalle behaupten.
5. Exportierbares read-only Testpaket mit Manifest, Quelldaten, Bewertungen und Versuchsentwurf. Keine Hardwarewrites oder automatische Lab-Freigabe.
6. Optionale persoenliche Anmeldung fuer dedizierte Kundeninstanzen, Rollen, Audit und gepruefter Offline-Backup/Restore. Keine behauptete Mandantentrennung innerhalb der alten globalen Run-API.

## Architektur

Neue Pilotmetadaten in SQLite; bestehende Run-/Worker-Vertraege und JSON-Artefakte erhalten. Genau ein Backend-Prozess. Auth optional fuer lokale synthetische Demo, bei Kundendaten erforderlich. Ein Kunde pro Instanz/Volume. Neue Funktionalitaet in abgegrenzten Modulen; Integration in bestehendes Muenchen-Cockpit.

## Abnahme

Backend- und Frontendtests, Lint, Typpruefung, Build und Archivschutz. UI-Smoke fuer Projekt/Import/Bewertung/Export und Systemgrafik auf Desktop/Mobil. Regression der gekoppelten Runs. Keine echte Hardware, INFLUX_TOKEN leer. Git-Push und Remote-SHA pruefen.

## Nicht softwareseitig erledigbar

Echte FMG-Messdaten, empirische Kalibrierung, vorab vereinbarte Fehlergrenzen, freigegebener Anlagenversuch und wirtschaftliche Kundenabnahme bleiben offen. Synthetische Beispiele werden als solche gekennzeichnet. Kein externes Deployment ohne gesonderte Freigabe.
