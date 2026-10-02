#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <api-url> <allowed-origin>"
  exit 1
fi

API_URL="${1%/}"
ALLOWED_ORIGIN="$2"

echo "Checking allowed origin..."
curl -is -X OPTIONS "${API_URL}/api/v1/health" \
  -H "Origin: ${ALLOWED_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" | rg -i "access-control-allow-origin|HTTP/"

echo "Checking blocked origin..."
curl -is -X OPTIONS "${API_URL}/api/v1/health" \
  -H "Origin: https://blocked.example" \
  -H "Access-Control-Request-Method: GET" | rg -i "access-control-allow-origin|HTTP/"
