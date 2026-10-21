"""Speicherregel der Elektrifizierung: nie mehr Anschluss als ohne Speicher (STORAGE_RULE)."""
import pytest

from app.exchange import electrification
from app.exchange.electrification import (
    ElectrificationRequest,
    prepare_electrification,
    size_solution,
)
from app.exchange.grid_sizing import connection_checks
from app.munich.coupled_simulator import simulate_coupled


def _run(solution, *, storage_on=True, **inputs):
    plan, config, policy, world, _ = prepare_electrification(
        ElectrificationRequest(**inputs), solution, storage_on=storage_on)
    return config, simulate_coupled(world, plan, policy, capture_traces=False)


# Die drei schlechtesten Stellungen der Tabelle mit 80-%-Netzladung: Dort brauchte der
# Speicher 1.525 / 900 / 1.475 kW, ohne Speicher reichten 1.400 / 825 / 1.400 kW.
@pytest.mark.parametrize("share,storage,pv,parking", [
    (100, 6000, 0, 200), (50, 6000, 0, 100), (100, 2000, 500, 200)])
def test_storage_never_needs_more_than_without_at_former_worst_positions(
        share, storage, pv, parking):
    without = size_solution("managed", share, 0, pv, parking)
    sized = size_solution("managed_storage", share, storage, pv, parking,
                          without_storage=without)
    assert without["status"] == sized["status"] == "feasible"
    assert sized["required_grid_kw"] <= without["required_grid_kw"]
    # Der laufende Speicher besteht selbst, nicht erst der ausgeschaltete.
    assert sized["storage_mode"] == "on"
    assert sized["evaluations"][-1]["checks"]["feasible"]


def test_grid_recharge_only_uses_what_the_loads_leave():
    inputs = dict(electric_share_pct=100, grid_import_limit_kw=1400, storage_kwh=2000,
                  pv_kwp=500, parking_sessions=200)
    config, result = _run("managed_storage", **inputs)
    assert config.power.battery_grid_charge_below_kw == 1400
    charging = [r for r in result.series if r["battery_charge_kw"] > 1e-9]
    assert charging, "Speicher laedt nie nach"
    for r in result.series:
        assert r["grid_import_kw"] <= r["effective_grid_cap_kw"] + 1e-6
        assert min(r["battery_charge_kw"], r["battery_discharge_kw"]) <= 1e-9
    # Wenn der Speicher laedt, bekommt jede Last in dieser Minute, was sie angefragt hat.
    for r in charging:
        assert r["charging_requested_kw"] - r["ground_charging_kw"] - r["parking_kw"] <= 1e-6
    assert connection_checks(result)["feasible"]
    assert result.energy.battery_final_kwh >= result.energy.battery_initial_kwh


def test_switched_off_storage_is_physically_the_same_as_no_storage():
    inputs = dict(electric_share_pct=50, grid_import_limit_kw=1000, storage_kwh=2000)
    config, off = _run("managed_storage", storage_on=False, **inputs)
    _, without = _run("managed", **inputs)
    assert config.power.battery_capacity_kwh == 2000
    assert config.power.battery_power_kw == 0
    assert config.power.battery_grid_charge_below_kw is None
    assert {r["battery_soc_pct"] for r in off.series} == {50}
    assert off.energy.battery_final_kwh == off.energy.battery_initial_kwh == 1000
    for a, b in zip(off.series, without.series, strict=True):
        assert {k: v for k, v in a.items() if k != "battery_soc_pct"} == {
            k: v for k, v in b.items() if k != "battery_soc_pct"}
    assert off.kpis == without.kpis
    assert connection_checks(off) == connection_checks(without)


@pytest.fixture
def storage_never_recovers(monkeypatch):
    """Ein Speicher, der nie auf seinen Anfangsstand zurueckkommt (Stellvertreter fuer jeden
    Fall, in dem der laufende Speicher an der End-SOC-Bedingung scheitert)."""
    real = electrification.simulate_coupled

    def leaky(world, plan, policy, **kwargs):
        result = real(world, plan, policy, **kwargs)
        if world.config.power.battery_power_kw:
            result.energy.battery_final_kwh = result.energy.battery_initial_kwh - 1
        return result

    monkeypatch.setattr(electrification, "simulate_coupled", leaky)


def test_storage_that_cannot_help_stays_off_in_the_sizing(storage_never_recovers):
    without = size_solution("managed", 0, 0, 500, 40)
    sized = size_solution("managed_storage", 0, 2000, 500, 40, without_storage=without)
    assert sized["status"] == "feasible"
    assert sized["required_grid_kw"] == without["required_grid_kw"]
    assert sized["storage_mode"] == "off"
    *running, last = sized["evaluations"]
    assert last["storage_mode"] == "off" and last["checks"]["feasible"]
    assert last["grid_kw"] == without["required_grid_kw"]
    assert running and all("storage_recharge" in e["checks"]["reasons"] for e in running)
    assert [e["grid_kw"] for e in running][-1] == without["required_grid_kw"]


def test_comparison_switches_storage_off_where_it_cannot_help(storage_never_recovers,
                                                              monkeypatch):
    monkeypatch.setattr(electrification, "_size_solutions", lambda *args: {
        s: {"status": "feasible", "required_grid_kw": 0} for s in electrification.SOLUTIONS})
    data = electrification.compare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=2000, storage_kwh=2000))
    direct, managed, storage = data["variants"]
    assert [direct["storage_mode"], managed["storage_mode"]] == [None, None]
    assert managed["checks"]["feasible"]
    assert storage["storage_mode"] == "off"
    assert storage["checks"] == managed["checks"]
    assert storage["power"]["battery_capacity_kwh"] == 2000
    assert storage["metrics"]["peak_grid_kw"] == managed["metrics"]["peak_grid_kw"]
    assert data["reference"]["storage_rule"] == "grid_recharge_to_limit_or_off_v1"


def test_comparison_keeps_running_storage_that_passes(monkeypatch):
    monkeypatch.setattr(electrification, "_size_solutions", lambda *args: {
        s: {"status": "feasible", "required_grid_kw": 0} for s in electrification.SOLUTIONS})
    data = electrification.compare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=2000, storage_kwh=2000))
    storage = data["variants"][2]
    assert storage["storage_mode"] == "on" and storage["checks"]["feasible"]
