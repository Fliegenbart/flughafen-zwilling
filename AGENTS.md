# Arbeitskontext

- Airport Twin Core ist der primaere Arbeitsbereich; Default-URL zeigt Flughafen.
- FlexLab Workbench ist separat unter `?workspace=flexlab` voll erhalten.
- Keine Domaene stillschweigend ersetzen. Fachlichen Wechsel vorab deutlich
  abstimmen; vorhandene Lab-Funktionen nicht als unbekannten Bedarf voraussetzen.
- Der FlexLab-Stand vor diesem Einstieg ist per Tag
  `flexlab-workbench-v1-2026-10-03` unveraendert auf GitHub gesichert.
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
- FlexLab-Kern: `backend/app/lab/`, UI: `src/lab/`, Vertrag: `docs/FLEXLAB_V1.md`.
- FlexLab ist messdatenbasiert und read-only. Keine Hardwarewrites einfuehren;
  Live-Connectoren und Versuchsvorschriften brauchen separate Lab-Freigabe.
- Schlechte Datenqualitaet darf nie zu PASS fuehren. Laufzeitdaten
  unter `data/lab/` nicht committen. Originalquellen und Einheiten erhalten.
