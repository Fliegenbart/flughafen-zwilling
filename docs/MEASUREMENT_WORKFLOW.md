# Simulation mit Messdaten ueberpruefen

Freigegebener Ablauf: gespeicherte gekoppelte Berechnung auswaehlen, konkrete
Prueffrage und Messgrenze festlegen, Kriterien vor dem Import sperren, eigene
CSV-Messdaten hochladen und vom Server den Modellwerten zuordnen lassen.
Keine Beispielauftraege, keine lokalen Statussimulationen, kein Hardwarezugriff.

Umsetzung:
1. Demo-Vorschau auf ausdruecklichen Klick als normalen SIL-Lauf speichern.
2. Pruefbereich durch vier gefuehrte Schritte ersetzen; bestehende Pilot-API
   fuer Projekt, Import, Replay, Kriterien, Bewertung und ZIP wiederverwenden.
3. Leere Zustaende und API-Fehler ohne erfundene Ersatzdaten anzeigen.
4. Abgeschlossene Runs und servergepruefte Modellwerte verwenden. Zeitstempel,
   kW-Einheit und Intervallende erklaeren; keine Zeitverschiebung/Interpolation.
5. Labordiagnose von unabhaengigem Holdout und von realer Betriebsfreigabe trennen.
6. Frontend-/Backendtests, echter HTTP-Smoke, Browserabnahme und gesichertes
   Hetzner-Deployment mit unveraendert oeffentlichem Demo-Zugang.

Die oeffentliche Demo ist kein Ort fuer vertrauliche Messdaten. Fuer reale
Kundendaten ist eine getrennte geschuetzte Instanz erforderlich. Der neue Ablauf
behauptet weder empirische Gesamtmodellvalidierung noch eine Anlagenfreigabe.
