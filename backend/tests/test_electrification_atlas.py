"""Vorab gerechnete Anschlussstufen: gleiche Zahlen wie die Live-Suche, schnell im Vergleich."""
import json

import pytest
from test_variants import client  # noqa: F401

from app.exchange import electrification_atlas as atlas_module
from app.exchange.electrification import (
    ElectrificationRequest,
    _size_solutions,
    prepare_electrification,
    size_solution,
    uncontrolled_need,
)
from app.exchange.electrification_atlas import AXES, atlas_key, load_atlas, peak_key
from app.exchange.electrification_reference import REFERENCE_ID, STORAGE_RULE
from app.exchange.grid_sizing import GRID_STEP_KW
from app.munich.coupled_models import PREDICTIVE_ENGINE_VERSION


def test_photovoltaics_and_parking_are_levers_of_the_reference():
    _, base, _, world0, _ = prepare_electrification(ElectrificationRequest(), "direct")
    _, more, _, world, _ = prepare_electrification(ElectrificationRequest(
        pv_kwp=2000, parking_sessions=100), "direct")
    assert base.power.pv_capacity_kwp == 500 and base.power.parking_sessions == 40
    assert more.power.pv_capacity_kwp == 2000 and more.power.parking_sessions == 100
    assert len(world.parking_jobs) > len(world0.parking_jobs)
    assert world.missions == world0.missions  # Vorfeld bleibt gleich


def test_uncontrolled_charging_needs_the_full_peak():
    need = uncontrolled_need(0, 500, 40)
    sizing = need["grid_sizing"]
    assert sizing["status"] == "feasible"
    assert sizing["required_grid_kw"] % GRID_STEP_KW == 0
    assert 0 <= sizing["required_grid_kw"] - sizing["peak_kw"] < GRID_STEP_KW
    assert max(need["basis"]["grid_import_kw"]) == pytest.approx(sizing["peak_kw"], abs=0.1)
    assert all(d["delayed"] == 0 for d in need["basis"]["departures"])
    # Die Variante "direct" darf am Anschluss abregeln und braucht deshalb nie mehr.
    assert sizing["required_grid_kw"] >= size_solution("direct", 0, 0, 500, 40)["required_grid_kw"]


@pytest.fixture
def atlas():
    data = load_atlas()
    if data is None:
        pytest.skip("Atlas fehlt oder passt nicht zum Modell "
                    "(scripts/make_electrification_atlas.py)")
    return data


def test_atlas_covers_every_lever_position(atlas):
    count = 1
    for values in AXES.values():
        count *= len(values)
    assert len(atlas["entries"]) == count
    assert len(atlas["peaks"]) == count // len(AXES["storage_kwh"])
    for key, entry in atlas["entries"].items():
        assert len(entry) == 3
        for status, required in entry:
            assert status in {"feasible", "not_found", "resource_infeasible"}
            assert (required is None) == (status != "feasible")
        # Die Geschichte der Kundenseite: Lademanagement braucht nie mehr als ohne Steuerung.
        share, _, pv, parking = key.split("|")
        _, uncontrolled = atlas["peaks"][peak_key(int(share), int(pv), int(parking))]
        if uncontrolled is not None and entry[1][1] is not None:
            assert entry[1][1] <= uncontrolled, key
        # Speicherregel: im Zweifel bleibt der Speicher aus, braucht also nie mehr Anschluss.
        if entry[1][1] is not None:
            assert entry[2][1] is not None and entry[2][1] <= entry[1][1], key


def test_atlas_matches_the_live_search(atlas):
    # Guenstige Stellungen live nachrechnen; die Suche ist dieselbe wie im Skript.
    stored = atlas["entries"][atlas_key(0, 0, 500, 40)]
    assert [stored[0][1], stored[1][1]] == [
        size_solution("direct", 0, 0, 500, 40)["required_grid_kw"],
        size_solution("managed", 0, 0, 500, 40)["required_grid_kw"],
    ]
    assert stored[2] == stored[1]  # ohne Speicher gleich vorausschauend
    peak = atlas["peaks"][peak_key(0, 500, 40)]
    assert peak == ["feasible", uncontrolled_need(0, 500, 40)["grid_sizing"]["required_grid_kw"]]


def test_comparison_answers_from_the_atlas_on_the_grid(atlas):
    sizes = _size_solutions(50, 2000.0, 500, 40)
    assert all(v["source"] == "atlas" for v in sizes.values())
    entry = atlas["entries"][atlas_key(50, 2000, 500, 40)]
    assert [v["required_grid_kw"] for v in sizes.values()] == [e[1] for e in entry]


@pytest.mark.parametrize("stale_fields", [
    {"engine_version": "alt", "reference_id": "x"},
    # Gleiche Engine und Referenz, aber mit der alten Speicherregel (80-%-Netzladung) gerechnet.
    {"engine_version": PREDICTIVE_ENGINE_VERSION, "reference_id": REFERENCE_ID},
    {"engine_version": PREDICTIVE_ENGINE_VERSION, "reference_id": REFERENCE_ID,
     "storage_rule": "grid_recharge_below_80pct"},
])
def test_atlas_is_ignored_when_it_does_not_fit_the_model(tmp_path, monkeypatch, stale_fields):
    stale = tmp_path / "atlas.json"
    stale.write_text(json.dumps({**stale_fields, "axes": AXES, "grid_step_kw": 25,
                                 "grid_max_kw": 8000, "entries": {}, "peaks": {}}))
    monkeypatch.setattr(atlas_module, "ATLAS_PATH", stale)
    atlas_module.load_atlas.cache_clear()
    try:
        assert atlas_module.load_atlas() is None
        assert atlas_module.atlas_sizes(50, 2000, 500, 40) is None
        assert atlas_module.public_atlas() == {"available": False}
    finally:
        atlas_module.load_atlas.cache_clear()


def test_atlas_for_the_current_storage_rule_is_used(tmp_path, monkeypatch):
    fitting = tmp_path / "atlas.json"
    fitting.write_text(json.dumps({
        "engine_version": PREDICTIVE_ENGINE_VERSION, "reference_id": REFERENCE_ID,
        "storage_rule": STORAGE_RULE, "axes": AXES, "grid_step_kw": 25, "grid_max_kw": 8000,
        "entries": {atlas_key(50, 2000, 500, 40): [
            ["feasible", 900], ["feasible", 825], ["feasible", 800]]}, "peaks": {}}))
    monkeypatch.setattr(atlas_module, "ATLAS_PATH", fitting)
    atlas_module.load_atlas.cache_clear()
    try:
        sizes = atlas_module.atlas_sizes(50, 2000, 500, 40)
        assert [v["required_grid_kw"] for v in sizes.values()] == [900, 825, 800]
    finally:
        atlas_module.load_atlas.cache_clear()


def test_atlas_endpoint_serves_the_browser_table(client, atlas):  # noqa: F811
    body = client.get("/api/v1/demo/electrification/atlas").json()
    assert body["available"] is True
    assert body["solutions"] == ["direct", "managed", "managed_storage"]
    assert body["entries"][atlas_key(50, 2000, 500, 40)] == [
        e[1] for e in atlas["entries"][atlas_key(50, 2000, 500, 40)]]
    assert body["peaks"][peak_key(50, 500, 40)] == atlas["peaks"][peak_key(50, 500, 40)][1]
