# Wiederhergestelltes Airport-Dashboard

Exportdatum: 2026-10-02, Europe/Berlin.

Quelle: vorhandene lokale Grafana-Datenbank im Docker-Volume
`digitalerzwillingbundeswehr_grafana_data`, schreibgeschuetzt gelesen.
Exportiert wurde ausschliesslich das Dashboard-JSON mit UID
`airport-twin-cockpit`, Titel `Airport Twin Cockpit`.

Enthalten sind fuenf Panels fuer OTP, Turnaround, Ressourcenauslastung,
Warteschlangen und Verzoegerung. Refresh ist `10s`, der Default-Zeitraum
`now-24h` bis `now`; die sichtbare `run_id`-Variable steht auf `All`.

Datasource-Konfiguration, Zugangsdaten, Sitzungen, Datenbank und Betriebsdaten
sind nicht Teil dieses Exports. Das Dashboard benoetigt einen neu eingerichteten
Influx-Datenfluss mit passenden Airport-Metriken und ist allein keine
lauffaehige Testplattform.
