"""Das Vorfuehr-Projekt aus scripts/seed_demo_project.py zeigt den kalibrierten Beispieltag."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from seed_demo_project import seed  # noqa: E402
from test_variants import AIRPORT, client  # noqa: E402,F401

from app.munich.flightplan_store import FlightPlanStore  # noqa: E402


def test_seeded_project_starts_from_the_calibrated_day(client, tmp_path):  # noqa: F811
    def call(method, path, body):
        response = client.request(method, path, json=body, headers=AIRPORT)
        assert response.status_code < 300, (method, path, response.text)
        return response.json()

    seeded = seed(call, FlightPlanStore(tmp_path), wait_s=60)
    today = client.post(f"/api/v1/projects/{seeded['project_id']}/situation/preview",
                        json={}).json()
    # Gleiche Zahlen wie das Beispielprojekt ohne Server (src/aec/beispieltag.json).
    assert today["policy"] == "uncontrolled"
    assert today["power"]["grid_import_limit_kw"] == 3500
    assert today["kpis"]["departures_total"] == 205
    assert today["kpis"]["delayed_departures"] == 33
    assert today["kpis"]["minutes_at_limit"] == 184
    board = client.get(f"/api/v1/projects/{seeded['project_id']}/variants").json()
    assert board["base"]["source"] == "coupled_run"


def test_committed_browser_files_match_the_model():
    """beispieltag.json und livePowerReference.json entstehen aus dem Backend-Modell.

    Aendert sich eine Regel im Modell (Einsatzvergabe, Ladereihenfolge, Leistungsbilanz), stimmen
    die eingecheckten Dateien nicht mehr, und die Naeherung im Browser (liveFleet.ts) rechnet
    nach alten Regeln. Dann `python scripts/make_live_power_fixture.py` ausfuehren und
    liveFleet.ts anpassen.
    """
    import json

    import make_live_power_fixture as generator

    day, reference = generator.build()
    assert json.loads(generator.DAY_OUT.read_text()) == day
    assert json.loads(generator.REFERENCE_OUT.read_text()) == reference
