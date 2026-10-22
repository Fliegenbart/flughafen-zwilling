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
    inputs = dict(electric_share_pct=100, grid_import_limit_kw=625, storage_kwh=2000)
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


def test_car_park_follows_departures_by_user_group():
    _, _, _, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=0, grid_import_limit_kw=800, parking_sessions=90), "managed")
    first_day = [j for j in world.parking_jobs if j.id.endswith("day-1")]
    groups = {g: sum(j.group == g for j in first_day) for g in ("traveler", "day", "dc")}
    assert groups == {"traveler": 60, "day": 30, "dc": 0}
    # Beispielflughafen: Abflugwellen ab 6, 12, 18 Uhr; Reisende kommen 2-3 h vorher.
    hours = {(j.release_min % 1440) // 60 for j in first_day if j.group == "traveler"}
    assert hours <= {3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19}
    assert all(j.deadline_min - j.release_min in (720, 1440) for j in first_day
               if j.group == "traveler")


def test_fast_chargers_are_served_first_and_never_shifted():
    from app.munich.coupled_models import ParkingGroup
    request = ElectrificationRequest(electric_share_pct=0, grid_import_limit_kw=400,
                                     parking_sessions=40)
    plan, config, policy, _, _ = prepare_electrification(request, "direct")
    config.power.parking_groups = [
        ParkingGroup(group="dc", sessions=10, charger_kw=75),
        ParkingGroup(group="traveler", sessions=30, charger_kw=11)]
    from app.munich.coupled_models import CYCLIC_ENGINE_VERSION
    from app.munich.coupled_world import build_world
    world = build_world(plan, config, 42, CYCLIC_ENGINE_VERSION)
    result = simulate_coupled(world, plan, "uncontrolled", capture_traces=False)
    fast = [p for p in result.parking if p["group"] == "dc" and "deadline_after_horizon" not in p]
    assert fast and all(p["deadline_met"] for p in fast)
    # Am Anschluss gedrosselt wird nur das uebrige Parkhaus, nie der Schnelllader.
    from app.munich.coupled_power import ChargeRequest, PowerBalance
    world.config.power.grid_import_limit_kw = 80
    world.config.power.background_load_kw = 0
    world.config.power.pv_capacity_kwp = 0
    balance = PowerBalance(world)
    requests = [ChargeRequest("fast", "fast", 75, 10)] + [
        ChargeRequest(f"ac{i}", "parking", 11, 600) for i in range(3)]
    allocation, _ = balance.step(world.start_min, requests, "lookahead")
    assert allocation["fast"] == pytest.approx(75)
    assert sum(allocation[f"ac{i}"] for i in range(3)) == pytest.approx(80 * 0.98 - 75)


def test_steered_car_park_fills_free_power_and_keeps_every_deadline():
    inputs = dict(electric_share_pct=0, grid_import_limit_kw=425, storage_kwh=0, pv_kwp=0,
                  parking_sessions=200)
    _, steered = run("managed", **inputs)
    _, capped = run("direct", **inputs)
    assert connection_checks(steered)["feasible"]
    assert "parking_deadlines" in connection_checks(capped)["reasons"]
    assert max(r["grid_import_kw"] for r in steered.series) <= 425 + 1e-6


def test_deadlines_after_the_horizon_are_not_checked():
    world, result = run("direct", electric_share_pct=0, grid_import_limit_kw=8000,
                        parking_sessions=40)
    late = [p for p in result.parking if p.get("deadline_after_horizon")]
    assert late and all(p["deadline_min"] > world.end_min for p in late)
    assert all(p["unmet_kwh"] == 0 for p in late)
    assert result.energy.charging_unmet_kwh < 1e-9


def test_several_vehicles_per_flight_and_widebody_values():
    from app.munich.coupled_models import CYCLIC_ENGINE_VERSION
    from app.munich.coupled_world import build_world
    plan, config, _, _, _ = prepare_electrification(ElectrificationRequest(), "direct")
    bus = next(f for f in config.fleets if f.kind == "bus")
    bus.units_per_flight, bus.wide_units_per_flight = 2, 3
    bus.wide_mission_energy_kwh = 9.5
    config.widebody_share_pct = 20
    world = build_world(plan, config, 42, CYCLIC_ENGINE_VERSION)
    buses = [m for m in world.missions if m.kind == "bus" and m.service_day == 0]
    by_flight = {}
    for m in buses:
        by_flight.setdefault(m.source_entry_id, []).append(m)
    sizes = {len(v) for v in by_flight.values()}
    assert sizes == {2, 3}
    assert len({m.mission_id for m in world.missions}) == len(world.missions)
    wide = [v for v in by_flight.values() if len(v) == 3]
    assert all(m.aircraft == "wide" and m.energy_kwh == 9.5 for v in wide for m in v)
    share = len(wide) / len(by_flight)
    assert 0.1 < share < 0.3


def test_measured_day_counts_the_fleet_balance_and_the_storage():
    from types import SimpleNamespace
    result = SimpleNamespace(
        kpis=SimpleNamespace(mission_count=1, missions_on_time=1, background_unserved_kwh=0,
                             fleet_energy_balance_error_kwh=0,
                             storage_energy_balance_error_kwh=0),
        energy=SimpleNamespace(charging_unmet_kwh=0, battery_initial_kwh=0, battery_final_kwh=0,
                               battery_cycle_start_kwh=100, battery_cycle_end_kwh=99.995,
                               battery_cycle_absorbable_kwh=0, vehicle_recharge_deficit_kwh=0),
        terminal_vehicles=[dict(electric=True, initial_kwh=255, final_kwh=200,
                                cycle_start_kwh=255.0, cycle_end_kwh=250.0)])
    # Einzelne Fahrzeuge duerfen schwanken; es zaehlt die Flottenbilanz aus dem Simulator.
    assert connection_checks(result)["feasible"]
    result.energy.vehicle_recharge_deficit_kwh = 5.0
    result.energy.battery_cycle_end_kwh = 99.5
    assert connection_checks(result)["reasons"] == ["vehicle_recharge", "storage_recharge"]


def test_night_traffic_airport_is_feasible_with_ample_power():
    from app.munich.coupled_models import trusted_scale
    with trusted_scale():
        plan, _, policy, world, _ = prepare_electrification(ElectrificationRequest(
            airport="CGN", electric_share_pct=50, grid_import_limit_kw=8000, storage_kwh=0,
            pv_kwp=0, parking_sessions=0), "managed")
        result = simulate_coupled(world, plan, policy, capture_traces=False)
    assert connection_checks(result)["feasible"]


def test_finished_comparisons_survive_a_restart(monkeypatch, tmp_path):
    monkeypatch.setattr(electrification, "_RESULT_DIR", str(tmp_path))
    monkeypatch.setattr(electrification, "_RESULTS", type(electrification._RESULTS)())
    request = ElectrificationRequest(electric_share_pct=50, grid_import_limit_kw=1500,
                                     storage_kwh=2000, pv_kwp=500, parking_sessions=40)
    first = electrification.compare_electrification(request)
    electrification._RESULTS.clear()  # wie nach einem Neustart
    again = electrification.compare_electrification(request)
    assert again["compute_ms"] == 0 and len(list(tmp_path.iterdir())) == 1
    assert again["variants"][1]["metrics"] == first["variants"][1]["metrics"]
