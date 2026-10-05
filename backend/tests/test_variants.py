"""Varianten je Projekt: Validierung, gleiche Welt, Deltas, Epsilon, Speicher, Fahrzeuge, Rollen."""
from __future__ import annotations

import math
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.exchange.variants import (
    EPS_ON_TIME_PCT,
    VariantChanges,
    apply_changes,
    build_answer,
    mission_signature,
)
from app.main import create_app
from app.munich.coupled_models import CoupledConfig, FleetSpec, PowerConfig
from app.munich.coupled_simulator import simulate_coupled
from app.munich.coupled_world import build_world
from app.munich.flightplan_store import FlightPlanStore
from test_coupled_world import bus, schedule
from test_pilot_evidence import project

AIRPORT = {"X-Exchange-Role": "airport"}
LAB = {"X-Exchange-Role": "lab"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "false")
    with TestClient(create_app(data_dir=tmp_path)) as test_client:
        yield test_client


def _project_with_plan(client, tmp_path):
    plan = FlightPlanStore(tmp_path).save(schedule())
    pid = project(client)["id"]
    linked = client.post(f"/api/v1/projects/{pid}/links", headers=AIRPORT, json={
        "kind": "flight_plan_snapshot", "ref_id": plan.snapshot_id})
    assert linked.status_code == 201, linked.text
    return pid, plan


def _variant(client, pid, name, headers=AIRPORT, **changes):
    return client.post(f"/api/v1/projects/{pid}/variants", headers=headers,
                       json={"name": name, "changes": changes})


# ---- Validierung --------------------------------------------------------------

def test_changes_validation_rejects_empty_and_implausible_storage():
    with pytest.raises(ValidationError, match="keinen Parameter"):
        VariantChanges()
    with pytest.raises(ValidationError, match="ohne Speicherkapazitaet"):
        VariantChanges(storage_kw=500)
    with pytest.raises(ValidationError, match="0,1C bis 4C"):
        VariantChanges(storage_kwh=100, storage_kw=1000)
    with pytest.raises(ValidationError):
        VariantChanges(extra_vehicles={"pushback_tug": 0})
    with pytest.raises(ValidationError):
        VariantChanges(extra_vehicles={"zeppelin": 2})
    with pytest.raises(ValidationError):
        VariantChanges(grid_import_limit_kw=-1)
    assert VariantChanges(charging_policy="mission_priority").charging_policy == "mission_priority"


def test_api_validation_base_required_and_domain_limits(client, tmp_path):
    pid = project(client)["id"]
    assert _variant(client, pid, "Anschluss +1 MW",
                    grid_import_limit_kw=4500).status_code == 409  # keine Basis
    pid, _ = _project_with_plan(client, tmp_path)
    too_many = _variant(client, pid, "Viel", extra_vehicles={
        "bus": 100, "gpu": 100, "baggage_tractor": 100})
    assert too_many.status_code == 422 and "300" in too_many.text
    offline = _variant(client, pid, "Aus", chargers_offline={"bus": 9})
    assert offline.status_code == 422
    same = _variant(client, pid, "Gleich", charging_policy="uncontrolled")
    assert same.status_code == 422 and "nichts" in same.text
    ok = _variant(client, pid, "Anschluss +1 MW", grid_import_limit_kw=4500)
    assert ok.status_code == 201, ok.text
    assert ok.json()["varied_parameters"] == {"power.grid_import_limit_kw": 4500}
    assert _variant(client, pid, "anschluss +1 mw", pv_factor=2).status_code == 409


def test_roles_lab_reads_but_cannot_write(client, tmp_path):
    pid, _ = _project_with_plan(client, tmp_path)
    assert _variant(client, pid, "PV", headers=LAB, pv_factor=1.5).status_code == 403
    created = _variant(client, pid, "PV", pv_factor=1.5).json()
    assert client.post(f"/api/v1/projects/{pid}/variants/run", headers=LAB,
                       json={}).status_code == 403
    assert client.delete(f"/api/v1/projects/{pid}/variants/{created['id']}",
                         headers=LAB).status_code == 403
    listing = client.get(f"/api/v1/projects/{pid}/variants", headers=LAB).json()
    assert [v["name"] for v in listing["variants"]] == ["PV"]
    assert listing["latest_run"] is None
    assert listing["base"]["source"] == "flight_plan_default_assumptions"
    assert listing["base"]["fleet"]["total_vehicles"] == 100
    assert client.delete(f"/api/v1/projects/{pid}/variants/{created['id']}",
                         headers=AIRPORT).status_code == 204
    assert client.get(f"/api/v1/projects/{pid}/variants").json()["variants"] == []


# ---- Ende-zu-Ende: gleiche Welt, Deltas, Evidenz -----------------------------

def _wait(client, pid, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        data = client.get(f"/api/v1/projects/{pid}/variants").json()
        run = data["latest_run"]
        if run and run["progress"]["done"] == run["progress"]["total"]:
            return data
        time.sleep(0.1)
    raise AssertionError("Variantenlauf nicht fertig")


def test_run_uses_same_world_and_reports_deltas(client, tmp_path):
    pid, plan = _project_with_plan(client, tmp_path)
    assert client.post(f"/api/v1/projects/{pid}/variants/run", json={}).status_code == 409
    _variant(client, pid, "+5 Schlepper", extra_vehicles={"pushback_tug": 5})
    _variant(client, pid, "Laderegel Fristpriorität", charging_policy="mission_priority")
    started = client.post(f"/api/v1/projects/{pid}/variants/run", headers=AIRPORT, json={})
    assert started.status_code == 202, started.text
    data = _wait(client, pid)
    run = data["latest_run"]
    assert run["status"] == "completed", run
    assert run["source_plan_sha256"] == plan.content_sha256 and run["seed"] == 42
    entries = {e["name"]: e for e in run["entries"]}
    assert set(entries) == {"Basis", "+5 Schlepper", "Laderegel Fristpriorität"}
    # Gleiche Nachfragewelt: identische Missionssignatur, Basis-Welt-Hash reproduzierbar.
    base_world = build_world(plan, CoupledConfig(), 42)
    assert entries["Basis"]["world_hash"] == base_world.world_hash
    assert run["mission_signature"] == mission_signature(base_world)
    assert entries["Laderegel Fristpriorität"]["world_hash"] == base_world.world_hash
    assert entries["+5 Schlepper"]["world_hash"] != base_world.world_hash
    assert entries["+5 Schlepper"]["fleet"]["total_vehicles"] == 105
    for entry in run["entries"]:
        assert entry["criteria"]["same_demand_world"] is True
        assert entry["criteria"]["integrity_verified"] is True
        assert entry["evidence_level"] == (
            "model_checked" if all(entry["criteria"].values()) else "synthetic")
        kpis = entry["kpis"]
        assert kpis["departures_total"] == 1 and kpis["missing_kw_peak"] is not None
        assert kpis["bottleneck"] in {"none", "energy", "resource", "energy_and_resource"}
    base = entries["Basis"]["kpis"]
    for entry in run["entries"]:
        if entry["name"] == "Basis":
            assert entry["delta_to_base"] is None
            continue
        for field, value in entry["delta_to_base"].items():
            assert value == pytest.approx(entry["kpis"][field] - base[field], abs=1e-3)
    assert run["answer"]["status"] in {"winner", "tie", "grid_only", "no_measurable_difference"}
    assert run["answer"]["headline"]
    # Lagebild/Uebersicht liefern die Flottengroesse.
    overview = client.get(f"/api/v1/projects/{pid}/overview").json()
    assert overview["fleet"]["total_vehicles"] == 100
    assert {k["kind"] for k in overview["fleet"]["by_kind"]} == {
        "bus", "baggage_tractor", "pushback_tug", "gpu"}


def test_situation_reports_fleet_without_run(client, tmp_path):
    pid = project(client)["id"]
    situation = client.get(f"/api/v1/projects/{pid}/situation").json()
    assert situation["fleet"]["total_vehicles"] is None
    assert client.get(f"/api/v1/projects/{pid}/overview").json()["fleet"]["source"] is None


# ---- Antwortsatz und Epsilon --------------------------------------------------

def _entry(key, name, pct, minutes):
    return {"key": key, "name": name, "kpis": {"on_time_pct": pct, "minutes_at_limit": minutes}}


def test_answer_winner_tie_and_no_measurable_difference():
    base = _entry("base", "Basis", 80.0, 100)
    winner = build_answer([base, _entry("a", "Speicher", 90.0, 60),
                           _entry("b", "PV", 80.0 + EPS_ON_TIME_PCT / 2, 100)], True)
    assert winner["status"] == "winner" and winner["best_variant_id"] == "a"
    assert "„Speicher“ hilft am meisten" in winner["headline"]
    assert winner["no_effect"] == ["b"]
    assert "kein messbarer Unterschied" in winner["details"][0]
    tie = build_answer([base, _entry("a", "A", 90.0, 60), _entry("b", "B", 90.2, 60.5)], True)
    assert tie["status"] == "tie" and tie["best_variant_id"] is None
    assert set(tie["tied"]) == {"a", "b"}
    none = build_answer([base, _entry("a", "A", 80.3, 99.5)], True)
    assert none["status"] == "no_measurable_difference" and none["best_variant_id"] is None
    minutes = build_answer([base, _entry("a", "A", 80.0, 40)], True)
    assert minutes["status"] == "grid_only" and minutes["grid_best_id"] == "a"
    assert minutes["headline"] == ("Keine Variante verbessert die Pünktlichkeit; Netz entlastet "
                                   "am stärksten: „A“ (−60 Minuten am Limit).")
    worse = build_answer([base, _entry("a", "A", 70.0, 100)], True)
    assert worse["worse"] == ["a"] and worse["status"] == "no_measurable_difference"
    assert build_answer([base], False)["status"] == "pending"


def test_answer_separates_punctuality_and_grid_with_tradeoff():
    base = _entry("base", "Basis", 80.0, 100)
    answer = build_answer([base, _entry("a", "Schlepper", 85.0, 130),
                           _entry("b", "Speicher", 80.2, 40)], True)
    assert answer["status"] == "winner" and answer["punctuality_best_id"] == "a"
    assert answer["grid_best_id"] == "b" and answer["tradeoffs"] == ["a"]
    assert "Pünktlichkeit: „Schlepper“ hilft am meisten" in answer["headline"]
    assert "Zielkonflikt: belastet das Netz stärker (+30 Minuten am Limit)" in answer["headline"]
    assert answer["details"][0] == "Netz entlastet am stärksten: „Speicher“ (−60 Minuten am Limit)."
    # Genau an der Schwelle 0,5 Pp. zaehlt als messbar
    edge = build_answer([base, _entry("a", "A", 80.0 + EPS_ON_TIME_PCT, 100)], True)
    assert edge["status"] == "winner"


# ---- Modell: Speicher und Fahrzeuge -------------------------------------------

def test_storage_variant_keeps_old_hashes_and_closes_energy_balance():
    assert "battery_grid_charge_below_kw" not in PowerConfig().model_dump(mode="json")
    plan = schedule("S XY 102 08:30 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air")
    fleet = bus(coverage_pct=100, vehicles=4, chargers=4, charger_kw=80, initial_soc_pct=20,
                mission_energy_kwh=40)
    power = dict(grid_import_limit_kw=1000, background_load_kw=600, chp_output_kw=0,
                 pv_capacity_kwp=0, parking_sessions=0)
    plain = build_world(plan, CoupledConfig(fleets=[fleet], power=PowerConfig(**power)), 7)
    config, _, varied = apply_changes(plain.config, "mission_priority",
                                      VariantChanges(storage_kwh=2000, storage_kw=500),
                                      plain.day_minutes)
    assert varied["power.battery_grid_charge_below_kw"] == 800
    stored = build_world(plan, config, 7)
    assert mission_signature(stored) == mission_signature(plain)
    result = simulate_coupled(stored, plan, "mission_priority")
    energy = result.energy
    assert energy.battery_charge_kwh > 0  # Netzladung unterhalb der Schwelle
    assert result.kpis.storage_energy_balance_error_kwh <= 1e-6
    expected = (energy.battery_initial_kwh + energy.battery_charge_kwh * 0.95
                - energy.battery_discharge_kwh / 0.95)
    assert math.isclose(energy.battery_final_kwh, expected, abs_tol=1e-6)
    for row in result.series:
        assert 10 - 1e-6 <= row["battery_soc_pct"] <= 100 + 1e-6
        assert row["battery_charge_kw"] <= 500 + 1e-9 and row["battery_discharge_kw"] <= 500 + 1e-9
        assert not (row["battery_charge_kw"] > 1e-9 and row["battery_discharge_kw"] > 1e-9)
        assert row["grid_import_kw"] <= row["effective_grid_cap_kw"] + 1e-6
        if row["battery_charge_kw"] > 1e-9:
            assert row["grid_import_kw"] <= 800 + 1e-6
        assert row["balance_error_kw"] < 1e-6
    assert math.isclose(energy.grid_peak_kw, max(r["grid_import_kw"] for r in result.series))


def test_storage_shaves_peak_when_grid_is_the_limit():
    rows = [f"S XY {100 + i} {8 + i // 6:02d}:{(i % 6) * 10:02d} 09:10 1234567 BBB "
            "03.10.26 27.03.27 1 Test Air" for i in range(12)]
    plan = schedule(*rows)
    fleet = bus(coverage_pct=100, vehicles=12, chargers=12, charger_kw=150,
                battery_capacity_kwh=300, initial_soc_pct=15, mission_energy_kwh=40)
    base = CoupledConfig(fleets=[fleet], power=PowerConfig(
        grid_import_limit_kw=460, background_load_kw=500, chp_output_kw=0, pv_capacity_kwp=0,
        parking_sessions=0))
    world = build_world(plan, base, 3)
    config, _, _ = apply_changes(base, "mission_priority",
                                 VariantChanges(storage_kwh=2000), world.day_minutes)
    without = simulate_coupled(world, plan, "mission_priority")
    with_storage = simulate_coupled(build_world(plan, config, 3), plan, "mission_priority")
    assert with_storage.energy.battery_discharge_kwh > 0
    assert with_storage.kpis.energy_wait_total_min < without.kpis.energy_wait_total_min
    assert with_storage.kpis.departure_readiness_pct > without.kpis.departure_readiness_pct


def test_additional_vehicles_change_resource_bottleneck():
    rows = [f"S XY {100 + i} 08:{i * 2:02d} 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air"
            for i in range(10)]
    plan = schedule(*rows)
    tugs = FleetSpec(kind="pushback_tug", vehicles=2, chargers=2, battery_capacity_kwh=150,
                     charger_kw=80, mission_energy_kwh=6, service_duration_min=10,
                     return_min=10, departure_lead_min=20, departure_buffer_min=0,
                     coverage_pct=100)
    base = CoupledConfig(fleets=[tugs], power=PowerConfig(parking_sessions=0))
    world = build_world(plan, base, 5)
    config, _, varied = apply_changes(base, "mission_priority",
                                      VariantChanges(extra_vehicles={"pushback_tug": 5}),
                                      world.day_minutes)
    assert varied == {"fleets.pushback_tug.vehicles": 7}
    more = build_world(plan, config, 5)
    assert mission_signature(more) == mission_signature(world)
    few = simulate_coupled(world, plan, "mission_priority").kpis
    many = simulate_coupled(more, plan, "mission_priority").kpis
    assert few.resource_wait_total_min > 0
    assert many.resource_wait_total_min < few.resource_wait_total_min
    assert many.departure_readiness_pct > few.departure_readiness_pct
