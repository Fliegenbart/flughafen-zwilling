# Arbeitskontext

- Dieses Repository ist der aktive Arbeitsstand fuer Airport Twin Core.
- `origin`: `https://github.com/Fliegenbart/flughafen-zwilling.git`.
- Neue Branches verwenden den Prefix `codex/`.
- Angeforderte, fertig gepruefte Aenderungen hier committen und pushen;
  den Remote-Commit pruefen, bevor ein Push als abgeschlossen gemeldet wird.
- Die Airport-Implementierung wurde aus den historischen Quellcode-Aenderungen
  wiederhergestellt. Provenienz und Grenzen: `docs/RECOVERY_AUDIT.md`.
- `legacy/ems_baseline/` und `legacy/airport_grafana/` sind unveraenderte
  Archivsnapshots. Nicht darin entwickeln; `sh scripts/check-recovery.sh` prueft sie.
- Fuer den Pilot `docker-compose.demo.yml` verwenden. Das historische
  `docker-compose.yml` benoetigt eine andere lokale Serverkonfiguration.
- Tests ohne echte Hardware und mit leerem Influx-Token ausfuehren, sofern
  nicht ausdruecklich eine Monitoring-/Hardwareintegration getestet wird.
- Keine Secrets, .env, virtuelle Umgebungen, node_modules oder Betriebsdaten
  committen. Keine vollstaendigen Gespraechs-/Wiederherstellungslogs veroeffentlichen.
- Das Flughafenmodell bleibt als unkalibrierter Methodenprototyp gekennzeichnet.
- Vor einem fachlichen Ausbau `docs/TIMO_PILOT.md` lesen. SIL-Validierung ist
  keine empirische Validierung; keine Betriebs-/Optimierungsversprechen daraus ableiten.
- Backend genau ein Prozess. Worker und JSON-Storage sind nicht multiprozesssicher.
