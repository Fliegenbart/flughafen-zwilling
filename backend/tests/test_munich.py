import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.munich.models import ChargingSession, MunichAssumptions
from app.munich.simulator import generate_sessions, simulate


def test_same_world_is_reproducible_and_does_not_depend_on_rule():
    config = MunichAssumptions()
    baseline = simulate(config, 42, "uncontrolled")
    priority = simulate(config, 42, "bus_priority")
    assert baseline.world_hash == priority.world_hash
    assert baseline.sessions == priority.sessions
    assert simulate(config, 42, "uncontrolled") == baseline
    assert simulate(config, 43, "uncontrolled").world_hash != baseline.world_hash


@pytest.mark.parametrize("policy", ["uncontrolled", "bus_priority"])
@pytest.mark.parametrize("battery", [0, 2000])
def test_balance_capacity_and_storage_bounds(policy, battery):
    config = MunichAssumptions(battery_capacity_kwh=battery)
    result = simulate(config, 17, policy)
    assert result.kpis.balance_error_max_kw < 1e-7
    assert result.kpis.grid_peak_kw <= config.grid_import_limit_kw + 1e-7
    for row in result.series:
        assert row["parking_kw"] <= config.parking_transformer_kva * config.power_factor + 1e-7
        assert row["bus_kw"] <= config.bus_transformer_kva * config.power_factor + 1e-7
        assert row["battery_charge_kw"] * row["battery_discharge_kw"] == 0
        assert 0 <= row["battery_soc_pct"] <= 100
        if battery:
            assert row["battery_soc_pct"] >= config.battery_reserve_pct - 1e-7
        assert row["grid_export_kw"] <= config.grid_export_limit_kw + 1e-7
        assert abs(row["pv_kw"] + row["chp_kw"] + row["grid_import_kw"]
                   + row["battery_discharge_kw"] - row["background_served_kw"]
                   - row["parking_kw"] - row["bus_kw"] - row["battery_charge_kw"]
                   - row["grid_export_kw"] - row["curtailed_kw"]) < 1e-7
    kpis = result.kpis
    assert kpis.charging_delivered_kwh + kpis.charging_loss_kwh == pytest.approx(
        sum(r["parking_kw"] + r["bus_kw"] for r in result.series) / 12
    )
    assert kpis.charging_requested_kwh == pytest.approx(
        kpis.charging_delivered_kwh + kpis.charging_unmet_kwh
    )
    assert kpis.pv_used_kwh + kpis.pv_export_kwh + kpis.pv_curtailed_kwh == pytest.approx(
        kpis.pv_generated_kwh
    )
    assert kpis.battery_final_kwh - kpis.battery_initial_kwh == pytest.approx(
        kpis.battery_charge_kwh - kpis.battery_discharge_kwh - kpis.battery_loss_kwh
    )


def test_priority_can_improve_bus_deadlines_but_can_trade_off_parking():
    config = MunichAssumptions(
        background_load_kw=100, chp_output_kw=0, grid_import_limit_kw=50,
        pv_peak_factor=0, parking_sessions=0, bus_sessions=0,
    )
    # Additional grid headroom is zero: both rules must expose unmet background.
    no_supply = simulate(config, 1, "bus_priority")
    assert no_supply.kpis.background_unserved_kwh > 0
    config = config.model_copy(update={"background_load_kw": 0})
    sessions = [
        ChargingSession(id="bus", sector="bus", arrival_min=0, deadline_min=60,
                        battery_capacity_kwh=100, initial_energy_kwh=10,
                        required_energy_kwh=40, charger_kw=50),
        ChargingSession(id="car", sector="parking", arrival_min=0, deadline_min=120,
                        battery_capacity_kwh=100, initial_energy_kwh=10,
                        required_energy_kwh=40, charger_kw=50),
    ]
    base = simulate(config, 1, "uncontrolled", sessions=sessions)
    priority = simulate(config, 1, "bus_priority", sessions=sessions)
    assert base.kpis.bus_ready_count == 0
    assert priority.kpis.bus_ready_count == 1
    assert priority.world_hash == base.world_hash
    assert all(s.delivered_kwh <= s.required_energy_kwh + 1e-7 for s in priority.evidence)
    assert all(s.final_energy_kwh <= s.battery_capacity_kwh + 1e-7 for s in priority.evidence)


def test_no_initial_battery_energy_is_credited_as_solar():
    config = MunichAssumptions(pv_peak_factor=0, battery_capacity_kwh=2000)
    result = simulate(config, 42, "bus_priority")
    assert result.kpis.pv_generated_kwh == 0
    assert result.kpis.pv_used_kwh == 0
    assert result.kpis.battery_discharge_kwh > 0


def test_storage_charges_and_discharges_with_both_losses_accounted():
    config = MunichAssumptions(background_load_kw=20000, grid_import_limit_kw=1000,
                              pv_peak_factor=0.9, battery_capacity_kwh=2000)
    result = simulate(config, 42, "bus_priority")
    k = result.kpis
    assert k.battery_charge_kwh > 0 and k.battery_discharge_kwh > 0
    assert k.battery_loss_kwh == pytest.approx(
        k.battery_charge_kwh * (1 - config.battery_efficiency)
        + k.battery_discharge_kwh * (1 / config.battery_efficiency - 1)
    )
    assert k.battery_final_kwh - k.battery_initial_kwh == pytest.approx(
        k.battery_charge_kwh - k.battery_discharge_kwh - k.battery_loss_kwh
    )
    assert all(config.battery_reserve_pct <= row["battery_soc_pct"] <= 100
               for row in result.series)
    assert all(row["battery_charge_kw"] * row["battery_discharge_kw"] == 0
               for row in result.series)
    assert k.balance_error_max_kw < 1e-7


def test_no_contention_means_no_claimed_improvement():
    config = MunichAssumptions(grid_import_limit_kw=100000,
                              bus_transformer_kva=20000, parking_transformer_kva=20000)
    assert simulate(config, 42, "uncontrolled").kpis == simulate(config, 42, "bus_priority").kpis


def test_unabsorbed_chp_is_exposed_not_silently_dispatched_away():
    config = MunichAssumptions(chp_output_kw=30000, background_load_kw=0,
                              grid_export_limit_kw=0, parking_sessions=0, bus_sessions=0)
    result = simulate(config, 2, "bus_priority")
    assert result.kpis.chp_unabsorbed_kwh == pytest.approx(30000 * 24)
    assert result.kpis.pv_used_kwh == 0
    assert result.kpis.pv_curtailed_kwh == pytest.approx(result.kpis.pv_generated_kwh)


def test_ids_cannot_inject_spreadsheet_formulas_and_windows_cannot_exceed_horizon():
    with pytest.raises(ValidationError):
        ChargingSession(id="=SUM(1,2)", sector="bus", arrival_min=0, deadline_min=60,
                        battery_capacity_kwh=100, initial_energy_kwh=20,
                        required_energy_kwh=20, charger_kw=50)
    with pytest.raises(ValidationError):
        ChargingSession(id="bus", sector="bus", arrival_min=60, deadline_min=30,
                        battery_capacity_kwh=100, initial_energy_kwh=20,
                        required_energy_kwh=20, charger_kw=50)


def test_generated_sessions_use_reported_counts_but_not_invented_total_power():
    sessions = generate_sessions(MunichAssumptions(parking_sessions=275, bus_sessions=50), 4)
    assert len(sessions) == 325
    assert all(s.deadline_min <= 1440 for s in sessions)


@pytest.mark.parametrize("override", [
    {"parking_sessions": 276}, {"bus_sessions": 51}, {"power_factor": 0},
    {"pv_peak_factor": 1.01}, {"grid_import_limit_kw": -1},
    {"battery_capacity_kwh": float("nan")}, {"grid_import_limit_kw": float("inf")},
    {"battery_efficiency": 1e-320}, {"charging_efficiency": 1e-320},
    {"unknown": 1},
])
def test_invalid_assumptions_are_rejected(override):
    with pytest.raises(ValidationError):
        MunichAssumptions(**override)


def test_fact_dossier_keeps_unknowns_null_and_targets_out_of_current_assets():
    path = Path(__file__).resolve().parents[2] / "data/references/munich_public_facts_v1.json"
    dossier = json.loads(path.read_text())
    assert all(row["value"] is None for row in dossier["unresolved_inputs"])
    assert next(f for f in dossier["facts"] if f["id"] == "pv_target_2030")["status"] == "target"
    assert next(f for f in dossier["facts"] if f["id"] == "existing_energy_twin")["value"] is True
