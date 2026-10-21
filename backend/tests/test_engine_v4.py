"""Engine v4: Speicher nie schlechter, eingeschwungener Messtag, gesteuertes Parkhaus."""
import pytest

from app.exchange import electrification
from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.exchange.electrification_atlas import atlas_sizes
from app.exchange.grid_sizing import connection_checks
from app.munich import coupled_power
from app.munich.coupled_simulator import simulate_coupled
from app.munich.coupled_world import steady_cycle


def run(solution="managed_storage", storage_on=True, **inputs):
    request = ElectrificationRequest(**inputs)
    plan, _, policy, world, _ = prepare_electrification(request, solution, storage_on)
    return world, simulate_coupled(world, plan, policy, capture_traces=False)


def test_storage_recharges_from_the_whole_free_connection():
    _, config, _, _, _ = prepare_electrification(ElectrificationRequest(
        grid_import_limit_kw=900, storage_kwh=2000), "managed_storage")
    assert config.power.battery_grid_charge_below_kw == 900
    assert config.power.battery_power_kw == 1000


def test_switched_off_storage_computes_exactly_like_no_storage():
    inputs = dict(electric_share_pct=50, grid_import_limit_kw=725, storage_kwh=2000)
    _, off = run(storage_on=False, **inputs)
    _, none = run("managed", **inputs)
    assert [r["grid_import_kw"] for r in off.series] == [r["grid_import_kw"] for r in none.series]
    assert off.kpis == none.kpis
    assert off.energy.battery_discharge_kwh == off.energy.battery_charge_kwh == 0


def test_storage_step_never_needs_more_than_without_storage(monkeypatch):
    managed = {"status": "feasible", "required_grid_kw": 700, "step_kw": 25, "max_kw": 8000,
               "evaluations": []}
    limits = []

    def sizing(solution, *args, max_kw=None, **kwargs):
        limits.append(max_kw)
        return {**managed, "status": "not_found", "required_grid_kw": None}

    monkeypatch.setattr(electrification, "size_solution", sizing)
    answer = electrification.size_with_storage(managed, 50, 2000)
    # Gesucht wird nur bis zum Bedarf ohne Speicher; dann bleibt der Speicher aus.
    assert limits == [700]
    assert answer["required_grid_kw"] == 700 and answer["storage_mode"] == "off"


def test_atlas_carries_switched_off_storage(monkeypatch):
    table = {"entries": {"50|2000|500|40": [["feasible", 800], ["feasible", 700],
                                            ["feasible", 700, "off"]]}}
    monkeypatch.setattr("app.exchange.electrification_atlas.load_atlas", lambda airport=None: table)
    sizes = atlas_sizes(50, 2000, 500, 40)
    assert sizes["managed_storage"]["storage_mode"] == "off"
    assert sizes["managed"].get("storage_mode") is None


def test_measured_day_is_the_middle_day_and_checks_its_own_start():
    world, result = run("managed", electric_share_pct=50, grid_import_limit_kw=800)
    assert steady_cycle(world) == (1440, 2880)
    vehicles = [v for v in result.terminal_vehicles if v["electric"]]
    assert all({"cycle_start_kwh", "cycle_end_kwh"} <= set(v) for v in vehicles)
    assert connection_checks(result)["feasible"]
    assert all(v["cycle_end_kwh"] >= v["cycle_start_kwh"] - 1e-5 for v in vehicles)


def test_absorbed_storage_shortfall_is_a_real_steady_state(monkeypatch):
    """Was als ausgleichbar gilt, muss sich bestaetigen: startet der Speicher den Messtag auf
    seinem Endstand, kommt er genau dorthin zurueck."""
    inputs = dict(electric_share_pct=50, grid_import_limit_kw=650, storage_kwh=2000)
    world, result = run(**inputs)
    e = result.energy
    assert connection_checks(result)["feasible"]
    assert e.battery_cycle_end_kwh < e.battery_cycle_start_kwh
    assert e.battery_cycle_start_kwh - e.battery_cycle_end_kwh <= e.battery_cycle_absorbable_kwh
    steady = e.battery_cycle_end_kwh
    step = coupled_power.PowerBalance.step

    def start_at_steady(self, minute, requests, policy):
        if self.cycle and minute == self.cycle[0]:
            self.stored = steady
        return step(self, minute, requests, policy)

    monkeypatch.setattr(coupled_power.PowerBalance, "step", start_at_steady)
    _, again = run(**inputs)
    assert again.energy.battery_cycle_end_kwh == pytest.approx(steady, abs=1e-3)
    assert again.kpis.missions_on_time == again.kpis.mission_count


def test_comparison_reports_whether_the_storage_runs(monkeypatch):
    monkeypatch.setattr(electrification, "_RESULTS", type(electrification._RESULTS)())
    sizes = {"direct": {"status": "feasible", "required_grid_kw": 800},
             "managed": {"status": "feasible", "required_grid_kw": 700},
             "managed_storage": {"status": "feasible", "required_grid_kw": 700,
                                 "storage_mode": "off"}}
    monkeypatch.setattr(electrification, "_size_solutions", lambda *args: sizes)
    monkeypatch.setattr(electrification, "uncontrolled_need", lambda *args: {})
    data = electrification.compare_electrification(ElectrificationRequest(
        electric_share_pct=50, grid_import_limit_kw=700, storage_kwh=2000))
    storage = data["variants"][2]
    assert storage["storage_mode"] == "off"
    assert storage["metrics"]["peak_grid_kw"] == data["variants"][1]["metrics"]["peak_grid_kw"]
