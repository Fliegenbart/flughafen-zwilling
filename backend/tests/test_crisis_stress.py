"""Krisenfaelle als Energie-Stresstest fuer Varianten (backend/app/exchange/crisis.py)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from test_coupled_world import schedule
from test_variants import AIRPORT, _project_with_plan, _variant, _wait, client  # noqa: F401

from app.exchange import library
from app.exchange.crisis import CRISIS_STRESS, crisis_config
from app.exchange.variants import VariantChanges, apply_changes, mission_signature
from app.munich.coupled_models import CoupledConfig
from app.munich.coupled_world import build_world

FRONTEND_CASES = Path(__file__).resolve().parents[2] / "src" / "aec" / "scenarios.ts"


def test_every_library_case_has_an_energy_stress():
    assert set(CRISIS_STRESS) == set(library.TEXTS)


def test_assumption_texts_match_frontend():
    source = FRONTEND_CASES.read_text(encoding="utf-8")
    shown = re.findall(r'energyStress:\s*"([^"]+)"', source)
    assert sorted(shown) == sorted(c.assumption for c in CRISIS_STRESS.values())


@pytest.mark.parametrize("scenario_id", sorted(CRISIS_STRESS))
def test_crisis_world_is_valid_and_keeps_demand(scenario_id):
    plan = schedule()
    base = build_world(plan, CoupledConfig(), 42)
    stressed = crisis_config(base.config, scenario_id, base.day_minutes)
    world = build_world(plan, stressed, 42)
    assert mission_signature(world) == mission_signature(base)
    assert world.world_hash != base.world_hash
    for event in stressed.stress_events:
        assert 0 <= event.start_min < event.end_min <= base.day_minutes


def test_enteisung_maps_cold_to_pv_battery_and_grid():
    base = CoupledConfig()
    stressed = crisis_config(base, "airport_case_07_enteisungsfenster_v1", 1440)
    assert stressed.power.pv_capacity_kwp == pytest.approx(base.power.pv_capacity_kwp * 0.3)
    for before, after in zip(base.fleets, stressed.fleets):
        assert after.battery_capacity_kwh == pytest.approx(before.battery_capacity_kwh * 0.8)
    (cut,) = stressed.stress_events
    assert (cut.start_min, cut.end_min) == (300, 540)
    assert cut.grid_import_limit_kw == pytest.approx(base.power.grid_import_limit_kw * 0.85)


def test_charger_outage_never_exceeds_what_a_variant_left():
    base = CoupledConfig()
    chargers = {f.kind: f.chargers for f in base.fleets}
    # Variante schaltet fast alle Gepaeckschlepper-Ladepunkte ganztags ab.
    config, _, _ = apply_changes(base, "uncontrolled", VariantChanges(
        chargers_offline={"baggage_tractor": chargers["baggage_tractor"] - 1}), 1440)
    stressed = crisis_config(config, "airport_case_04_gepaeckstau_v1", 1440)
    crisis = [e for e in stressed.stress_events
              if e.fleet_kind == "baggage_tractor" and e.end_min == 14 * 60]
    assert [e.offline_chargers for e in crisis] == [1]
    build_world(schedule(), stressed, 42)  # validiert Summe <= Ladepunkte


def test_windows_are_clipped_on_short_days():
    stressed = crisis_config(CoupledConfig(), "airport_case_05_personalengpass_v1", 1380)
    assert {e.end_min for e in stressed.stress_events} == {1380}


def test_api_runs_variants_under_crisis(client, tmp_path):  # noqa: F811
    pid, _ = _project_with_plan(client, tmp_path)
    _variant(client, pid, "+5 Schlepper", extra_vehicles={"pushback_tug": 5})
    bad = client.post(f"/api/v1/projects/{pid}/variants/run", headers=AIRPORT,
                      json={"crisis": "airport_case_09_gibtsnicht_v1"})
    assert bad.status_code == 422
    started = client.post(f"/api/v1/projects/{pid}/variants/run", headers=AIRPORT,
                          json={"crisis": "airport_case_07_enteisungsfenster_v1"})
    assert started.status_code == 202, started.text
    run = _wait(client, pid)["latest_run"]
    assert run["stress"] is True and run["stress_kind"] == "crisis"
    assert run["crisis"]["name"] == "Enteisung"
    assert run["crisis"]["assumption"].startswith("Kälte")
    assert run["progress"]["total"] == 4  # Basis + Variante, je normal und unter Krise
    for entry in run["entries"]:
        assert entry["stress"] is not None and entry["stress"]["status"] == "completed"
