#!/bin/sh
# Tests the packaged application without host sources, ports or persistent data.
set -eu
image="${AIRPORT_SMOKE_IMAGE:-airport-library-smoke:local}"
docker build -f deploy/demo/backend.Dockerfile -t "$image" .
container=$(docker run -d --network none --tmpfs /app/data \
  -e TWIN_REQUIRE_AUTH=false -e INFLUX_TOKEN= "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT HUP INT TERM
docker exec -i "$container" python - <<'PY'
import json
import time
import urllib.error
import urllib.request

base = "http://127.0.0.1:8000/api/v1"
for attempt in range(60):
    try:
        with urllib.request.urlopen(base + "/health", timeout=2) as response:
            assert response.status == 200
        break
    except (OSError, urllib.error.URLError):
        time.sleep(0.5)
else:
    raise AssertionError("Packaged backend did not become healthy")
with urllib.request.urlopen(base + "/library/scenarios", timeout=10) as response:
    scenarios = json.load(response)
expected = {
    "airport_case_01_spitzenwelle_v1", "airport_case_02_guillotine_v1",
    "airport_case_03_wetter_kompression_v1", "airport_case_04_gepaeckstau_v1",
    "airport_case_05_personalengpass_v1", "airport_case_06_sicherheitswelle_v1",
    "airport_case_07_enteisungsfenster_v1", "airport_case_08_schwarzstart_v1",
}
assert len(scenarios) == 8, f"Expected 8 packaged scenarios, got {len(scenarios)}"
assert {item["id"] for item in scenarios} == expected
assert all(len(item["sha256"]) == 64 for item in scenarios)
print("PASS: packaged HTTP library exposes all 8 scenarios with hashes")
PY
