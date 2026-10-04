# Airport Pilot Studio: technische Abnahme

## Gepruefter Umfang

- Systemlandkarte und Energiefluss im gekoppelten Muenchen-Pilot; Entwurf und
  eingefrorene KPIs/Flugplantage getrennt, positionsabhaengige Verbindungslinien.
- Persistente Projekte, Original-CSV, Qualitaetsgates, getrennte Datenrollen,
  zeitlicher Overlap inklusive erster Intervallabdeckung, versionierte Bewertungen.
- Run-Abgleich nur gegen serverseitig integritaetsgepruefte gekoppelte Artefakte,
  exakte UTC-Minutenmittel, keine freie Run-ID als Herkunftsnachweis akzeptiert.
- Vier Stresskonfigurationen, zwei Regeln, identische Missionsnachfrage;
  ungueltige Artefakte liefern weder KPI-Zusammenfassung noch Delta.
- Read-only Testpaket inklusive eingefrorenem Run und Zeitreihe, Hashmanifest;
  persoenliche optionale Instanz-Anmeldung, Rollen, CSRF, Audit, Offline-Restore.

## Nachweise

- Frontend: Lint, Typecheck, 94 Tests; Root- und `/airport/`-Build.
- Backend: 208 Tests, Ruff fuer aktive Lab-/Muenchen-/Pilotmodule und Instanzzugang.
- Original-Snapshots: `sh scripts/check-recovery.sh` unveraendert bestanden.
- Docker QA lokal 5186/8016, bestehendes Volume erhalten. Kein Hetzner-Deployment.
- Browser: Pilotprojekt angelegt, synthetisches CSV importiert, eigene Grenzen
  bewertet; ungepruefte Modellherkunft bleibt NOT_EVALUABLE. Acht Stresstest-Runs
  aus UI abgeschlossen mit Integritaetsnachweis. Desktop 1440, Mobil 390 ohne
  horizontalen Seitenueberlauf; Grafik besitzt eigenen Scrollbereich.
- `scripts/smoke_pilot.py`: synthetisch abgeleitete Messreihe gegen gespeicherten
  Run abgeglichen, injizierten Fehler quantifiziert, defekte Daten blockiert,
  ZIP-Dateihashes verifiziert. Dies prueft Software, nicht Modellguete.
- Backup/Restore: SQLite-Integritaet, Dateierhaltung, Korruption und Traversal
  getestet; Archiv wird exklusiv mit Dateimodus 0600 erzeugt.

## Grenzen

Keine realen FMG-Messdaten, keine unabhaengige empirische Kalibrierung, kein
Anlagenversuch oder Kundenabnahme. Netzenergie-Kosten sind nur ein Ausschnitt
mit Nutzertarifen, kein ROI. Ein Kunde pro Instanz, ein Backend-Prozess;
vorhandene Run-Dateien sind weiterhin nicht multiprozesssicher. Auth/Rollen sind
unit-/integrationgetestet, kein externer Penetrationstest. Browser-HTML-Download
ist in der IAB-Umgebung eingeschraenkt; Reportinhalt und Escaping sind getestet.
Der Hardwarepfad bleibt unveraendert; kein realer Adapter verwendet.
