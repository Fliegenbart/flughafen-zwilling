# Hetzner Airport Demo Implementation Plan

**Goal:** Geschuetzte, getrennte Browser-Demo auf dem vorhandenen Hetzner-Host.

**Architecture:** Ein separater Compose-Stack mit genau einem Backend-Prozess,
eigenem persistenten Volume und ohne Monitoring-/Hardwareintegration. Vorhandener
HTTPS-Proxy schuetzt den gesamten `/airport/`-Pfad mit HTTP Basic Auth. Bestehende
Domain-Weiterleitung bleibt fuer alle anderen Pfade identisch.

**Tech Stack:** Docker Compose, Nginx, React/Vite, FastAPI/Uvicorn.

- [ ] Unterpfad-Routing und deaktiviertes Grafana mit roten Tests absichern.
- [ ] Optionale Vite-Basis und Workspace-Links anpassen; lokale Root-Demo erhalten.
- [ ] Separate Compose-Datei, Runtime-Konfiguration und Proxy-Include erstellen.
- [ ] Lint, Typecheck, Tests, Root-/Unterpfad-Build und Archive pruefen.
- [ ] GitHub-Stand committen/pushen und Remote-Commit verifizieren.
- [ ] Genau diesen Commit in einem eigenen Server-Checkout bauen. Kein Kopieren
      lokaler Betriebsdaten, Geheimnisse oder anderer Anwendungen.
- [ ] Zugangsdaten ausserhalb Git erzeugen; Nginx-Konfiguration vor Anpassung
      sichern und Syntax pruefen; nur graceful Reload, bei Fehler Ruecknahme.
- [ ] Unauthentifiziert 401 fuer UI/API/Artefakte, authentifiziert echte Runs,
      Restart-Recovery, Reports, Root-Weiterleitung und bestehende Dienste pruefen.
- [ ] Dokumentation, URL und private Zugangsdaten fuer Timo bereitstellen.
