#!/bin/sh
# Run only on a test host where both Hetzner subnets are unused.
set -eu
export TWIN_BUILD_GIT_COMMIT="${TWIN_BUILD_GIT_COMMIT:-proxy-smoke}"
override=$(mktemp)
project="airport-proxy-smoke-$$"
compose() { docker compose -p "$project" -f docker-compose.hetzner.yml -f "$override" "$@"; }
cleanup() { compose down >/dev/null 2>&1; rm -f "$override"; }
trap cleanup EXIT HUP INT TERM
cat > "$override" <<'YAML'
services:
  twin-core:
    volumes: !reset []
    tmpfs: [/app/data]
  frontend:
    ports: !override ["127.0.0.1::80"]
YAML
compose up --build -d --wait --wait-timeout 120
address=$(compose port frontend 80)
# Docker leitet den Port weiter, bevor nginx im Container annimmt; der erste Versuch kann
# dann mit "connection reset" (curl 56) scheitern. --retry-all-errors wiederholt auch das;
# --fail sorgt weiter dafuer, dass ein echter HTTP-Fehler den Smoke rot macht.
curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-all-errors \
  -H 'X-Real-IP: 198.51.100.42' -H 'Host: labpulse.ai' \
  "http://$address/api/v1/health?proxy-smoke=1" >/dev/null
compose logs twin-core | grep '198.51.100.42:0.*proxy-smoke=1.*200 OK'
echo 'PASS: trusted ingress gateway preserves client IP through frontend and uvicorn'
