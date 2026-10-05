# Airport Pilot Operations: Dedicated Instance

Dieser Schutz ist fuer **eine** dedizierte Kundeninstanz vorgesehen. Er ist
keine Mandantenfaehigkeit: Ein Runtime-Volume, `access.sqlite3`, Nutzer und
Sessions gehoeren genau einer Instanz. Kunden nie in dasselbe Volume, dieselbe
SQLite-Datei oder denselben Backend-Prozess zusammenlegen.

Das Flughafenmodell bleibt ein unkalibrierter Methodenprototyp. Zugangsschutz,
SIL-Laeufe und Backups sind keine empirische Validierung, Betriebsfreigabe oder
Optimierungszusage. Es werden keine Hardwarewrites eingefuehrt.

## Deployment Contract

Die lokale synthetische Demo bleibt standardmaessig offen:

```sh
TWIN_REQUIRE_AUTH=false
```

Fuer eine dedizierte HTTPS-Pilotinstanz muessen Betreiber die folgenden Werte
am **Backend** setzen. `TWIN_COOKIE_SECURE` ist absichtlich standardmaessig
`true`; nur ein lokaler HTTP-Test darf ihn explizit deaktivieren.

```sh
TWIN_REQUIRE_AUTH=true
TWIN_COOKIE_SECURE=true
TWIN_ALLOWED_ORIGINS=https://airport.example.customer
TWIN_DATA_DIR=/var/lib/airport-twin
```

Der Root-Integrator installiert den Access Hook im bestehenden `create_app`
nach dem Anlegen von `storage` und vor dem `return app`:

```python
from .instance_access import install_instance_access

install_instance_access(app, storage.base_dir)
```

Der Hook schuetzt bei aktivem `TWIN_REQUIRE_AUTH` jede HTTP-Route,
einschliesslich API, Artefakten, `/docs`, `/openapi.json`, `/metrics` und
`/api/v1/ready`. Nur `/api/v1/health`, `/api/v1/status` und die Login-/Session-
Endpunkte bleiben ohne bestehende Session erreichbar. Der Compose-Healthcheck
muss deshalb `/api/v1/health` verwenden. `POST /api/v1/auth/logout` erfordert
eine bestehende Session und denselben CSRF-Origin-Schutz.

Der Browser muss Requests mit Cookies senden. `POST`, `PUT`, `PATCH` und
`DELETE` brauchen eine `Origin`, die entweder exakt zu Schema und Host der
Anfrage passt oder in `TWIN_ALLOWED_ORIGINS` steht. Fehlt sie oder ist sie
fremd, wird der Schreibzugriff abgewiesen. Login weist einen vorhandenen,
fremden Browser-Origin ebenfalls ab. Das Session-Cookie heisst `twin_session`,
hat `HttpOnly`, `SameSite=Strict`, optional `Secure` und immer `Path=/`.
Damit funktioniert es auch bei einem Reverse Proxy unter `/airport`, wenn der
Proxy den Prefix vor dem Backend entfernt.

Die UI-Integration ruft vor geschuetzten Daten `GET /api/v1/auth/session` auf.
Bei `enabled=true` und `authenticated=false` zeigt sie ein Login mit `POST
/api/v1/auth/login` (`username`, `password`) und
`credentials: "include"`. Nach Erfolg sind `user` und `role` sichtbar zu
machen; `viewer` darf nur lesen, `operator` darf schreiben. Logout ruft
`POST /api/v1/auth/logout` mit `credentials: "include"` und Origin auf. Das
Frontend setzt oder liest nie das HttpOnly-Cookie.

## Account Provisioning

Es gibt keine Default-Accounts, Default-Passwoerter oder Passwort-Argumente.
Die Person, die den Account erstellt, gibt das Passwort interaktiv ein:

```sh
docker compose -f docker-compose.demo.yml exec twin-core \
  python scripts/instance_users.py --base-dir /app/data operator.name --role operator
```

Passwoerter werden mit `scrypt` gespeichert; bereits vorhandene
`pbkdf2_sha256`-Hashes werden konstantzeitlich verifiziert. Session-Tokens sind
zufaellig, nur ihr SHA-256-Hash liegt in SQLite. Fehlversuche werden pro
Client/Benutzer und zusaetzlich global in begrenzten In-Memory-Fenstern
limitiert. Das ist bewusst nur fuer **einen** Backend-Prozess ausgelegt.

Audit-Ereignisse liegen in `access.sqlite3`; sie enthalten keine Passwoerter
und keine Session-Tokens. Das Volume und diese Datei sind betrieblich wie
personenbezogene Zugangsdaten zu behandeln. Keine `.env`, Zugangsdaten,
Betriebsdaten oder Archive in Git committen.

## Process And Volume Rules

- Pro Instanz genau ein Backend-Prozess. Worker und JSON-Storage sind nicht
  multiprozesssicher; auch das Login-Rate-Limit ist absichtlich pro Prozess.
  Die Fehlversuchszaehler liegen nur im Speicher: sie gelten ausschliesslich
  mit `uvicorn --workers 1` und beginnen nach jedem Neustart bei null.
- Login-Schutz: je IP+Benutzer nach 5 Fehlversuchen kurze Sperre mit
  exponentiellem Backoff (15 s, 30 s, ... hoechstens 5 min); je IP hoechstens 20
  Fehlversuche in 5 min. Global gibt es keine Sperre, ab 100 Fehlversuchen in
  5 min nur eine Verzoegerung (bis 2 s), damit ein Angreifer berechtigte Nutzer
  nicht aussperren kann.
- Hinter einem Reverse Proxy muss das Backend die echte Client-IP sehen:
  `--proxy-headers --forwarded-allow-ips=<Proxy-Netz>` (Hetzner: internes
  Netz `172.31.250.0/24` des Frontend-nginx, der `X-Real-IP` vom Host-Proxy
  uebernimmt). Ohne das teilen sich alle Clients die Proxy-Adresse und damit
  die IP-Grenze. Die lokale Demo (`docker-compose.demo.yml`) ist nicht
  oeffentlich proxied und startet ohne Proxy-Header.
- Jede Instanz erhaelt ein separates persistentes Volume und separate
  Credentials. `docker compose -f docker-compose.demo.yml` ist nur die lokale
  Demo, nicht ein gemeinsamer Kundenbetrieb.
- Der Reverse Proxy terminiert TLS und leitet nur an den einzelnen privaten
  Backend-Port weiter. Keine API, Dokumentation, Metriken oder Artefakte
  oeffentlich vor dem App-Schutz freigeben.
- Keine echten Hardwarewrites und keine Live-Connectoren ohne separate
  Freigabe und Versuchsvorschrift.

## Offline Backup And Restore

Ein Backup ist kein sicherer Live-Snapshot. Vor jedem Backup den einzelnen
Backend-Prozess vollstaendig stoppen und erst danach die Offline-Bestaetigung
geben. Die CLI nimmt waehrend des Vorgangs nur einen **advisory**
Wartungs-Lock gegen parallele Backup-/Restore-CLI-Laeufe; dieser Lock kann den
Backend-Prozess nicht koordinieren oder dessen Stillstand beweisen. Die CLI
verweigert deshalb den Lauf ohne explizite Offline-Bestaetigung:

```sh
docker compose -f docker-compose.demo.yml stop twin-core
python3 scripts/pilot_backup.py backup \
  --source /var/lib/airport-twin \
  --archive /srv/airport-backups/airport-$(date +%F).tar.gz \
  --offline-confirm
```

Das Archiv umfasst alle Runtime-Dateien. SQLite-Dateien werden per SQLite-
Backup-API in den Staging-Snapshot uebernommen, nicht als unkoordinierte
Live-Dateikopie. Ein `manifest.json` enthaelt fuer jede Datei Groesse und
SHA-256. Restore akzeptiert nur regulaere, manifestierte Archivmitglieder,
prueft Pfade, Checksums und SQLite-Integritaet und schreibt ausschliesslich in
ein neues, noch nicht vorhandenes Ziel:

```sh
python3 scripts/pilot_backup.py restore \
  --archive /srv/airport-backups/airport-2026-10-04.tar.gz \
  --destination /var/lib/airport-twin-restored
```

Danach erst die Deployment-Konfiguration auf das neue Volume zeigen lassen und
den einen Backend-Prozess starten. Ein Restore in ein bestehendes Volume oder
ein laufendes System wird absichtlich nicht unterstuetzt.
