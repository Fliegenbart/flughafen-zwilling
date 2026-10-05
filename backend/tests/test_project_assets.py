"""Projektwerte Flotte und Anlagen (Schritt "Daten"): Validierung, Einheiten, Rollen, Kopplung."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.exchange.assets import AssetEntry, apply_assets, data_status, normalize
from app.main import create_app
from app.munich.coupled_models import CoupledConfig
from app.munich.flightplan_store import FlightPlanStore
from test_coupled_world import schedule
from test_pilot_evidence import project

AIRPORT = {"X-Exchange-Role": "airport"}
LAB = {"X-Exchange-Role": "lab"}

FULL = [
    {"key": "grid_import_limit_kw", "value": 4.2, "unit": "MW",
     "source": "Netzbetreibervertrag 2025", "source_date": "2025-11-01"},
    {"key": "fleet.bus.vehicles", "value": 24, "unit": "Stück",
     "source": "Fuhrparkliste FMG", "source_date": "2026-09-30"},
    {"key": "fleet.bus.chargers", "value": 10, "unit": "Stück",
     "source": "Fuhrparkliste FMG", "source_date": "2026-09-30"},
    {"key": "pv_capacity_kwp", "value": 6500, "unit": "kWp", "source": "Anlagenregister"},
]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "false")
    with TestClient(create_app(data_dir=tmp_path)) as test_client:
        yield test_client


def _put(client, pid, entries, headers=AIRPORT):
    return client.put(f"/api/v1/projects/{pid}/assets", headers=headers,
                      json={"entries": entries})


def test_units_are_converted_and_originals_kept():
    entries = normalize([AssetEntry(key="grid_import_limit_kw", value=4.2, unit="MW",
                                    source="Vertrag")])
    assert entries[0]["value"] == pytest.approx(4200)
    assert entries[0]["unit"] == "kW"
    assert entries[0]["original_value"] == 4.2 and entries[0]["original_unit"] == "MW"
    assert entries[0]["status"] == "echt"
    assumption = normalize([AssetEntry(key="pv_capacity_kwp", value=7, unit="MWp")])
    assert assumption[0]["value"] == pytest.approx(7000) and assumption[0]["status"] == "annahme"


@pytest.mark.parametrize("entry, message", [
    ({"key": "grid_import_limit_kw", "value": 5, "unit": "kWh"}, "Einheit „kWh“ passt nicht"),
    ({"key": "fleet.bus.vehicles", "value": 2.5, "unit": "Stück"}, "nur ganze Zahlen"),
    ({"key": "fleet.bus.vehicles", "value": 500, "unit": "Stück"}, "außerhalb"),
    ({"key": "zeppelin", "value": 1, "unit": "Stück"}, "Unbekannter Wert"),
    ({"key": "pv_capacity_kwp", "value": 1, "unit": "kWp", "source_date": "gestern"},
     "kein Datum"),
])
def test_validation_messages_are_german(client, entry, message):
    pid = project(client)["id"]
    response = _put(client, pid, [entry])
    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert response.json()["detail"].startswith("invalid_assets: ")


def test_contradicting_fleet_rejected(client):
    pid = project(client)["id"]
    response = _put(client, pid, [{"key": "fleet.gpu.vehicles", "value": 2, "unit": "Stück"}])
    assert response.status_code == 422 and "mehr Ladepunkte" in response.json()["detail"]


def test_status_assumption_until_every_value_has_a_source(client):
    pid = project(client)["id"]
    assert client.get(f"/api/v1/projects/{pid}/assets").json()["status"] == "fehlt"
    no_source = [{**e, "source": ""} if e["key"] == "pv_capacity_kwp" else e for e in FULL]
    assert _put(client, pid, no_source).json()["status"] == "annahme"
    body = _put(client, pid, FULL).json()
    assert body["status"] == "echt"
    assert body["version"]["source_kind"] == "form" and len(body["version"]["sha256"]) == 64
    assert data_status([]) == "fehlt"


def test_roles_lab_and_unknown_cannot_write(client):
    pid = project(client)["id"]
    assert _put(client, pid, FULL, headers=LAB).status_code == 403
    assert _put(client, pid, FULL, headers={"X-Exchange-Role": "gast"}).status_code == 422
    assert _put(client, pid, FULL, headers={"X-Exchange-Role": "admin"}).status_code == 200
    imported = client.post(f"/api/v1/projects/{pid}/assets/import?filename=x.csv",
                           headers={**LAB, "Content-Type": "text/csv"},
                           content=b"key,value,unit\npv_capacity_kwp,1,kWp\n")
    assert imported.status_code == 403
    audit = client.get(f"/api/v1/projects/{pid}/exchange-audit").json()
    assert any(a["action"] == "exchange_assets_set" for a in audit)


def test_csv_and_json_import_keep_original(client):
    pid = project(client)["id"]
    csv_text = ("# BEISPIEL\nkey;value;unit;source;source_date\n"
                "grid_import_limit_kw;3,5;MW;Vertrag;2026-01-01\n"
                "fleet.bus.vehicles;20;Stück;Liste;\n")
    response = client.post(f"/api/v1/projects/{pid}/assets/import?filename=flotte.csv",
                           headers={**AIRPORT, "Content-Type": "text/csv"},
                           content=csv_text.encode())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version"]["filename"] == "flotte.csv"
    assert body["version"]["source_kind"] == "csv"
    assert len(body["version"]["original_sha256"]) == 64
    grid = next(e for e in body["entries"] if e["key"] == "grid_import_limit_kw")
    assert grid["value"] == pytest.approx(3500) and grid["original_unit"] == "MW"
    bad = client.post(f"/api/v1/projects/{pid}/assets/import?filename=f.csv",
                      headers={**AIRPORT, "Content-Type": "text/csv"},
                      content=b"name,wert\nx,1\n")
    assert bad.status_code == 422 and "Kopfzeile" in bad.json()["detail"]
    missing_unit = client.post(f"/api/v1/projects/{pid}/assets/import?filename=f.csv",
                               headers={**AIRPORT, "Content-Type": "text/csv"},
                               content=b"key,value,unit\npv_capacity_kwp,1,\n")
    assert missing_unit.status_code == 422 and "Einheit" in missing_unit.json()["detail"]
    as_json = client.post(f"/api/v1/projects/{pid}/assets/import?filename=f.json",
                          headers={**AIRPORT, "Content-Type": "application/json"},
                          json={"entries": FULL})
    assert as_json.status_code == 201 and as_json.json()["status"] == "echt"
    broken = client.post(f"/api/v1/projects/{pid}/assets/import?filename=f.json",
                         headers={**AIRPORT, "Content-Type": "application/json"},
                         content=b"{nope")
    assert broken.status_code == 422 and "JSON nicht lesbar" in broken.json()["detail"]
    too_big = client.post(f"/api/v1/projects/{pid}/assets/import?filename=f.csv",
                          headers={**AIRPORT, "Content-Type": "text/csv"},
                          content=b"#" * (300 * 1024))
    assert too_big.status_code == 413


def test_apply_assets_overrides_config_fields():
    entries = normalize([AssetEntry(key=e["key"], value=e["value"], unit=e["unit"],
                                    source=e["source"]) for e in FULL]
                        + [AssetEntry(key="battery_capacity_kwh", value=2, unit="MWh")])
    config = apply_assets(CoupledConfig(), entries)
    assert config.power.grid_import_limit_kw == pytest.approx(4200)
    assert config.power.pv_capacity_kwp == pytest.approx(6500)
    assert config.power.battery_capacity_kwh == pytest.approx(2000)
    assert config.power.battery_power_kw == pytest.approx(1000)
    bus = next(f for f in config.fleets if f.kind == "bus")
    assert (bus.vehicles, bus.chargers) == (24, 10)


def test_project_values_feed_the_variant_base(client, tmp_path):
    plan = FlightPlanStore(tmp_path).save(schedule())
    pid = project(client)["id"]
    assert client.post(f"/api/v1/projects/{pid}/links", headers=AIRPORT, json={
        "kind": "flight_plan_snapshot", "ref_id": plan.snapshot_id}).status_code == 201
    before = client.get(f"/api/v1/projects/{pid}/variants").json()["base"]
    assert before["grid_import_limit_kw"] == 3500
    assert before["project_assets"]["applied"] is False
    assert _put(client, pid, FULL).status_code == 200
    base = client.get(f"/api/v1/projects/{pid}/variants").json()["base"]
    assert base["grid_import_limit_kw"] == pytest.approx(4200)
    assert base["pv_capacity_kwp"] == pytest.approx(6500)
    assert base["project_assets"]["applied"] is True
    assert base["project_assets"]["status"] == "echt"
    bus = next(k for k in base["fleet"]["by_kind"] if k["kind"] == "bus")
    assert (bus["vehicles"], bus["chargers"]) == (24, 10)
    # Variante baut auf den Projektwerten auf: +2 Busse = 26.
    created = client.post(f"/api/v1/projects/{pid}/variants", headers=AIRPORT, json={
        "name": "Mehr Busse", "changes": {"extra_vehicles": {"bus": 2}}})
    assert created.status_code == 201, created.text
    assert created.json()["varied_parameters"]["fleets.bus.vehicles"] == 26


def test_changed_storage_changes_next_run_and_situation(client, tmp_path):
    """Projektwert Speicher fliesst in den naechsten Lauf (Basis) und damit ins Lagebild."""
    from test_variants import _wait

    plan = FlightPlanStore(tmp_path).save(schedule())
    pid = project(client)["id"]
    client.post(f"/api/v1/projects/{pid}/links", headers=AIRPORT, json={
        "kind": "flight_plan_snapshot", "ref_id": plan.snapshot_id})
    client.post(f"/api/v1/projects/{pid}/variants", headers=AIRPORT, json={
        "name": "Fristpriorität", "changes": {"charging_policy": "mission_priority"}})

    def base_after_run(storage_kwh):
        assert _put(client, pid, [{"key": "battery_capacity_kwh", "value": storage_kwh,
                                   "unit": "kWh"}]).status_code == 200
        started = client.post(f"/api/v1/projects/{pid}/variants/run", headers=AIRPORT, json={})
        assert started.status_code == 202, started.text
        run = _wait(client, pid)["latest_run"]
        assert run["project_assets"]["applied"] is True
        return next(e for e in run["entries"] if e["key"] == "base")

    first = base_after_run(0)
    second = base_after_run(2000)
    assert first["world_hash"] != second["world_hash"]
    assert first["status"] == second["status"] == "completed"
    situation = client.get(f"/api/v1/projects/{pid}/situation").json()
    assert situation["available"] is True and situation["run_id"] == second["run_id"]
    assets = client.get(f"/api/v1/projects/{pid}/assets").json()
    assert any(f["key"] == "battery_capacity_kwh" and f["default"] == 0 for f in assets["fields"])


def test_example_files_parse_and_stay_assumptions():
    from pathlib import Path

    from app.exchange.assets import parse_csv, parse_json

    root = Path(__file__).resolve().parents[2] / "public" / "beispiele"
    for entries in (parse_csv((root / "flotte-anlagen-BEISPIEL.csv").read_text()),
                    parse_json((root / "flotte-anlagen-BEISPIEL.json").read_text())):
        normalized = normalize(entries)
        assert data_status(normalized) == "annahme"
        apply_assets(CoupledConfig(), normalized)
