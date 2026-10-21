import pytest
from test_coupled_simulator import simple_world
from test_demo_materialization import _completed
from test_variants import client  # noqa: F401

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.munich.coupled_models import CYCLIC_ENGINE_VERSION, ELECTRIFICATION_ENGINE_VERSION
from app.munich.coupled_simulator import simulate_coupled
from app.munich.coupled_world import build_world


@pytest.mark.parametrize("share", [0, 1, 33, 50, 99, 100])
def test_share_replaces_vehicles_without_changing_fleet_or_demand(share):
    plan0, config0, _, world0, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0), "direct")
    plan, config, _, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=share), "direct")
    assert plan.content_sha256 == plan0.content_sha256
    assert plan.rows == plan0.rows
    total = sum(f.vehicles for f in config.fleets)
    assert total == 226
    assert sum(f.electric_vehicles for f in config.fleets) == (total * share + 50) // 100
    assert [f.vehicles for f in config.fleets] == [f.vehicles for f in config0.fleets]
    assert [f.chargers for f in config.fleets] == [f.chargers for f in config0.fleets]
    assert world.missions == world0.missions
    assert world.parking_jobs == world0.parking_jobs


def test_non_electric_vehicle_completes_same_mission_without_charging():
    plan, original = simple_world(grid=0)
    spec = original.config.fleets[0]
    spec.electric_vehicles = 0
    diesel = simulate_coupled(build_world(plan, original.config, 42,
                              ELECTRIFICATION_ENGINE_VERSION), plan, "uncontrolled")
    spec.electric_vehicles = 1
    electric = simulate_coupled(build_world(plan, original.config, 42,
                                ELECTRIFICATION_ENGINE_VERSION), plan, "uncontrolled")
    assert diesel.kpis.missions_completed == 1
    assert electric.kpis.missions_completed == 0
    assert diesel.kpis.fleet_consumed_kwh == diesel.kpis.fleet_charged_kwh == 0
    assert diesel.kpis.fleet_energy_balance_error_kwh == 0
    assert all(v["charging_kw"] == 0 and v["soc_pct"] is None for v in diesel.vehicles)


def test_old_engine_cannot_silently_use_mixed_fleet():
    plan, world = simple_world()
    world.config.fleets[0].electric_vehicles = 0
    with pytest.raises(ValueError, match="Elektrifizierungs-Engine"):
        build_world(plan, world.config, 42)


def test_comparison_is_reproducible_and_freezes_three_fair_variants(client):  # noqa: F811
    payload = {"electric_share_pct": 70, "grid_import_limit_kw": 2200, "storage_kwh": 2000}
    response = client.post("/api/v1/demo/electrification", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    second = client.post("/api/v1/demo/electrification", json=payload).json()
    data.pop("compute_ms")
    second.pop("compute_ms")
    assert data == second
    assert data["comparison_contract"]["total_vehicles"] == 226
    assert data["comparison_contract"]["electric_vehicles"] == 158
    assert data["comparison_contract"]["non_electric_vehicles"] == 68
    direct, managed, storage = data["variants"]
    assert direct["world_hash"] == managed["world_hash"]
    assert direct["metadata"]["config"]["fleets"] == storage["metadata"]["config"]["fleets"]
    assert [v["policy"] for v in data["variants"]] == [
        "uncontrolled", "lookahead", "lookahead"]
    assert [v["power"]["battery_capacity_kwh"] for v in data["variants"]] == [0, 0, 2000]
    for variant in data["variants"]:
        assert variant["coupled_kpis"]["fleet_energy_balance_error_kwh"] < 1e-6
        assert variant["coupled_kpis"]["storage_energy_balance_error_kwh"] < 1e-6
    # Ohne Steuerung bremst nichts: Bedarf ist die Spitze, mindestens so viel wie gedeckelt direkt.
    free = data["uncontrolled"]
    assert free["basis"]["policy"] == "uncontrolled"
    assert free["grid_sizing"]["required_grid_kw"] >= direct["grid_sizing"]["required_grid_kw"]
    assert client.get("/api/v1/runs").json() == []


def test_selected_variant_is_preserved_in_normal_sil_run(client):  # noqa: F811
    inputs = {"electric_share_pct": 50, "storage_kwh": 2000}
    preview = client.post("/api/v1/demo/electrification", json=inputs).json()["variants"][2]
    response = client.post("/api/v1/demo/electrification/runs", json={
        **inputs, "solution": "managed_storage"})
    assert response.status_code == 202, response.text
    record = _completed(client, response.json()["run_id"])
    assert record["request"]["adapters"] == []
    assert record["summary"]["coupled_kpis"] == preview["coupled_kpis"]
    assert record["summary"]["energy_world_hash"] == preview["world_hash"]
    assert record["model_pack_snapshot"]["calibration_meta"]["engine_version"] == (
        CYCLIC_ENGINE_VERSION)


@pytest.mark.parametrize("payload", [
    {"electric_share_pct": -1}, {"electric_share_pct": 101}, {"electric_share_pct": 2.5},
    {"electric_share_pct": True}, {"extra_vehicles": {"bus": 1}}, {"storage_kwh": 6001},
])
def test_electrification_rejects_invalid_or_fleet_expansion_inputs(client, payload):  # noqa: F811
    assert client.post("/api/v1/demo/electrification", json=payload).status_code == 422
