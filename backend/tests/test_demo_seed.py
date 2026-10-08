"""Das Vorfuehr-Projekt aus scripts/seed_demo_project.py zeigt den kalibrierten Beispieltag."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

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


def test_project_values_over_the_fleet_limit_name_the_cause(client, tmp_path):  # noqa: F811
    """Das Speichern prüft gegen die Standardflotte (100), die Basis des Beispieltags hat 101."""
    def call(method, path, body):
        response = client.request(method, path, json=body, headers=AIRPORT)
        assert response.status_code < 300, (method, path, response.text)
        return response.json()

    pid = seed(call, FlightPlanStore(tmp_path), wait_s=60)["project_id"]
    saved = client.put(f"/api/v1/projects/{pid}/assets", headers=AIRPORT, json={"entries": [
        {"key": "fleet.bus.vehicles", "value": 150, "unit": "Stück"},
        {"key": "fleet.gpu.vehicles", "value": 100, "unit": "Stück"},
        {"key": "fleet.bus.chargers", "value": 8, "unit": "Stück"}]})
    assert saved.status_code == 200, saved.text
    expected = ("invalid_assets: Projektwerte passen nicht zur Basis: "
                "Das Modell rechnet höchstens 300 Fahrzeuge, die Flotte käme auf 305.")
    preview = client.post(f"/api/v1/projects/{pid}/situation/preview", json={})
    assert preview.status_code == 409 and preview.json()["detail"] == expected
    held = client.post(f"/api/v1/projects/{pid}/variants", headers=AIRPORT, json={
        "name": "Mehr Anschluss", "changes": {"grid_import_limit_kw": 4000}})
    assert held.status_code == 409 and held.json()["detail"] == expected


def _fake_api(bodies: dict, run_status: dict):
    def call(method, path, body):
        bodies[(method, path)] = body
        if path == "/api/v1/pilot/projects":
            return {"id": "p1"}
        if path == "/api/v1/munich/coupled-comparisons":
            return {"runs": [{"run_id": "r1"}, {"run_id": "r2"}]}
        if path.startswith("/api/v1/runs/"):
            return run_status
        return {}
    return call


def test_seed_names_the_failure_of_the_base_run_at_once(tmp_path):
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="r1 ist fehlgeschlagen: kein Platz"):
        seed(_fake_api({}, {"state": "failed", "error": "kein Platz"}),
             FlightPlanStore(tmp_path), wait_s=30)
    assert time.monotonic() - started < 5


def test_seed_project_texts_are_ready_for_the_customer_view(tmp_path):
    bodies: dict = {}
    seed(_fake_api(bodies, {"state": "completed"}), FlightPlanStore(tmp_path), wait_s=5)
    project = bodies[("POST", "/api/v1/pilot/projects")]
    assert project["decision"] == "Reicht der Netzanschluss für die elektrische Vorfeldflotte?"
    # Die Karte eines Serverprojekts zeigt nur diesen Text; der Anschluss steht darin, ohne
    # Doppelpunkt und mit geschuetztem Leerzeichen vor der Einheit.
    assert project["scope"] == (
        "Beispieltag (erfunden) mit 205 Abflügen in drei Wellen, Anschluss 3,5\u00a0MW")
    assert project["acceptance_note"] == "Nur zur Vorführung, keine echten Daten."


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
