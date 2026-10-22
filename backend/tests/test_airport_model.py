"""Echte Flughaefen im Elektrifizierungsmodell: Flugplan aus dem Steckbrief, Grenzen, Tabelle."""
import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError
from test_variants import client  # noqa: F401

from app.exchange import airport_model, airport_spec, electrification, electrification_atlas
from app.munich.coupled_models import CoupledConfig, FleetSpec, trusted_scale

FIXTURE = Path(__file__).parent / "fixtures" / "airport_TST.json"


def _clear():
    airport_spec.load_spec.cache_clear()
    airport_model.airport_day.cache_clear()
    electrification_atlas.load_atlas.cache_clear()
    electrification._resource_baseline_feasible.cache_clear()
    electrification._size_solutions.cache_clear()
    electrification.uncontrolled_need.cache_clear()


@pytest.fixture
def tst(tmp_path, monkeypatch):
    specs, atlas = tmp_path / "airports", tmp_path / "atlas"
    specs.mkdir()
    atlas.mkdir()
    shutil.copy(FIXTURE, specs / "TST.json")
    monkeypatch.setattr(airport_spec, "AIRPORTS_DIR", specs)
    monkeypatch.setattr(electrification_atlas, "ATLAS_DIR", atlas)
    _clear()
    yield airport_spec.load_spec("TST")
    _clear()


def test_plan_follows_the_hourly_profile_and_curfew(tst):
    plan = airport_model.airport_day("TST")
    assert plan.departure_entry_count == round(tst.departures_per_day)
    assert plan.arrival_entry_count == round(tst.departures_per_day)
    by_hour = [0] * 24
    for row in plan.rows:
        if row.direction == "departure":
            by_hour[int(row.scheduled_local[11:13])] += 1
    for hour, weight in enumerate(tst.departures_by_hour):
        if weight == 0:
            assert by_hour[hour] == 0, hour
    assert by_hour.index(max(by_hour)) == tst.departures_by_hour.index(max(tst.departures_by_hour))


def test_large_models_only_inside_the_trusted_scope():
    big = {"kind": "bus", "vehicles": 400, "chargers": 10}
    with pytest.raises(ValidationError):
        FleetSpec(**big)
    with trusted_scale():
        assert CoupledConfig(fleets=[FleetSpec(**big)]).fleets[0].vehicles == 400
    with pytest.raises(ValidationError):  # danach gelten wieder die oeffentlichen Grenzen
        CoupledConfig.model_validate({"fleets": [big]})


def test_requests_stay_inside_the_model(tst):
    top = airport_model.grid_raster(tst)[1]
    electrification.ElectrificationRequest(airport="TST", grid_import_limit_kw=top)
    with pytest.raises(ValidationError):
        electrification.ElectrificationRequest(airport="TST", grid_import_limit_kw=top + 1)
    with pytest.raises(ValidationError):
        electrification.ElectrificationRequest(airport="XYZ")
    with pytest.raises(ValidationError):  # Beispiel behaelt seine Grenzen
        electrification.ElectrificationRequest(grid_import_limit_kw=9000)
    with pytest.raises(ValidationError):  # Laeufe nur fuer das Beispiel
        electrification.ElectrificationRunRequest(airport="TST", solution="managed")


def test_uncontrolled_need_of_an_airport_uses_its_raster(tst):
    need = electrification.uncontrolled_need(30, 0, 0, "TST")["grid_sizing"]
    step = airport_model.grid_raster(tst)[0]
    assert need["status"] == "feasible"
    assert need["required_grid_kw"] % step == 0
    assert 0 <= need["required_grid_kw"] - need["peak_kw"] < step


def test_atlas_of_an_airport_is_checked_against_its_spec(tst, tmp_path):
    axes = electrification_atlas.axes_for("TST")
    assert axes["pv_kwp"] == [0] and axes["parking_sessions"] == [0, 150]
    step, top = electrification_atlas.raster_for("TST")
    payload = {"engine_version": "airport_electrification_v4",
               "reference_id": electrification_atlas.reference_id_for("TST"),
               "grid_step_kw": step, "grid_max_kw": top, "axes": axes,
               "entries": {"30|0|0|0": [["feasible", 600], ["feasible", 450], ["feasible", 450]]},
               "peaks": {"30|0|0": ["feasible", 1650]}}
    path = electrification_atlas.path_for("TST")
    path.write_text(json.dumps(payload))
    _clear()
    sizes = electrification_atlas.atlas_sizes(30, 0, 0, 0, "TST")
    assert sizes["managed"]["required_grid_kw"] == 450 and sizes["managed"]["step_kw"] == step
    # Andere Flotte im Steckbrief: alte Tabelle passt nicht mehr und wird verworfen.
    spec = json.loads((airport_spec.AIRPORTS_DIR / "TST.json").read_text())
    spec["fleet"]["vehicles"]["bus"] += 1
    (airport_spec.AIRPORTS_DIR / "TST.json").write_text(json.dumps(spec))
    _clear()
    assert electrification_atlas.load_atlas("TST") is None


def test_public_requests_only_hit_the_table(client, tst):  # noqa: F811
    body = {"airport": "TST", "electric_share_pct": 30, "grid_import_limit_kw": 600,
            "storage_kwh": 0, "pv_kwp": 0, "parking_sessions": 0}
    # Ohne Tabelle rechnet die oeffentliche Seite nicht live (das wuerde die Demo sperren).
    assert client.post("/api/v1/demo/electrification", json=body).status_code == 422
    axes = electrification_atlas.axes_for("TST")
    step, top = electrification_atlas.raster_for("TST")
    entries = {f"{s}|{st}|0|{pk}": [["feasible", 600]] * 3
               for s in axes["electric_share_pct"] for st in axes["storage_kwh"]
               for pk in axes["parking_sessions"]}
    electrification_atlas.path_for("TST").write_text(json.dumps({
        "engine_version": "airport_electrification_v4",
        "reference_id": electrification_atlas.reference_id_for("TST"),
        "grid_step_kw": step, "grid_max_kw": top, "axes": axes, "entries": entries,
        "peaks": {f"{s}|0|{pk}": ["feasible", 900] for s in axes["electric_share_pct"]
                  for pk in axes["parking_sessions"]}}))
    _clear()
    off_axis = {**body, "storage_kwh": 1234}
    assert client.post("/api/v1/demo/electrification", json=off_axis).status_code == 422
    assert client.post("/api/v1/demo/electrification",
                       json={**body, "pv_kwp": 500}).status_code == 422
    assert [a["id"] for a in client.get("/api/v1/demo/airports").json()] == ["TST"]


def test_airport_list_only_offers_computed_airports(client, tst):  # noqa: F811
    assert client.get("/api/v1/demo/airports").json() == []
    assert client.get("/api/v1/demo/electrification/atlas?airport=XYZ").status_code == 404
    assert client.get("/api/v1/demo/electrification/atlas?airport=TST").json() == {
        "available": False}
