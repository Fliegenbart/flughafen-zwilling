"""Legt das Vorfuehr-Projekt mit dem Beispieltag an (app/exchange/demo_day.py).

Der Beispieltag ist erfunden. Das Projekt bekommt den Flugplan des Tages und einen gekoppelten
Lauf mit dem heutigen Stand (3,5 MW Anschluss, keine Batterie) als Basis. Dasselbe zeigt das
Beispielprojekt ohne Server. Auf dem Server im Container ausfuehren (der Plan wird ueber den
Speicher des Backends abgelegt, alles andere laeuft ueber die API):

    docker exec -i <backend-container> python - --base-url http://127.0.0.1:8000 \\
        < backend/scripts/seed_demo_project.py

Mehrfaches Ausfuehren legt ein weiteres Projekt an; der Plan wird nur einmal gespeichert.
Das Skript sendet nur den Header `X-Exchange-Role: admin`. Es laeuft deshalb nur bei
ausgeschaltetem Instanz-Login (TWIN_REQUIRE_AUTH=false, so laeuft der Container), sonst antwortet
die API schon auf den ersten Aufruf mit 401.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "app").is_dir():
    sys.path.insert(0, str(ROOT))

from app.exchange.demo_day import SEED, TITLE, busy_day, heute_config  # noqa: E402
from app.munich.flightplan_store import FlightPlanStore  # noqa: E402

PROJECT_NAME = "Beispieltag Vorfeld (erfunden)"
WAIT_S = 180

Call = Callable[[str, str, "dict | None"], dict]


def seed(call: Call, plans: FlightPlanStore, *, wait_s: float = WAIT_S) -> dict:
    """Projekt anlegen, Flugplan und Basislauf verknuepfen; gibt Projekt und Plan zurueck."""
    plan = plans.save(busy_day())
    project = call("POST", "/api/v1/pilot/projects", {
        "name": PROJECT_NAME,
        "decision": "Reicht der Netzanschluss für die elektrische Vorfeldflotte?",
        # Die Startseite haengt den Anschluss selbst an; hier steht er nicht noch einmal.
        "scope": f"{TITLE} mit 205 Abflügen in drei Wellen",
        "acceptance_note": "Nur zur Vorführung, keine echten Daten.",
    })
    link = f"/api/v1/projects/{project['id']}/links"
    call("POST", link, {"kind": "flight_plan_snapshot", "ref_id": plan.snapshot_id})
    pair = call("POST", "/api/v1/munich/coupled-comparisons", {
        "flight_plan_snapshot_id": plan.snapshot_id, "seed": SEED,
        "config": heute_config().model_dump(mode="json"),
    })
    # Die Vergleichslaeufe kommen in der Reihenfolge der Laderegeln: zuerst "uncontrolled".
    base_run = pair["runs"][0]["run_id"]
    deadline = time.monotonic() + wait_s
    while True:
        status = call("GET", f"/api/v1/runs/{base_run}", None)
        if status.get("state") == "completed":
            break
        if status.get("state") == "failed":
            raise RuntimeError(f"Basislauf {base_run} ist fehlgeschlagen: {status.get('error')}")
        if time.monotonic() > deadline:
            raise TimeoutError(f"Basislauf {base_run} wurde nicht rechtzeitig fertig.")
        time.sleep(0.5)
    call("POST", link, {"kind": "coupled_run", "ref_id": base_run})
    return {"project_id": project["id"], "snapshot_id": plan.snapshot_id, "run_id": base_run}


def http_call(base_url: str) -> Call:
    def call(method: str, path: str, body: dict | None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            base_url.rstrip("/") + path, data=data, method=method,
            headers={"Content-Type": "application/json", "X-Exchange-Role": "admin"})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    return call


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--data-dir", default=os.environ.get("TWIN_DATA_DIR", "/app/data"))
    args = parser.parse_args()
    result = seed(http_call(args.base_url), FlightPlanStore(Path(args.data_dir)))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
