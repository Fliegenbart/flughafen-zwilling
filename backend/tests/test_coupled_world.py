import sys
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.munich.flightplan import parse_pages
from app.munich.coupled_models import CoupledConfig, FleetSpec, PowerConfig, StressEvent
from app.munich.coupled_world import build_world, verify_world

HEADER = """Flugplan Muenchen
L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename
Datenstand: 02.10.2026
Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag
"""


def schedule(*rows, day=date(2026, 10, 3)):
    return parse_pages([HEADER + "\n".join(rows or [
        "L XY 101 - 23:10 06:25 1234567 AAA 03.10.26 27.03.27 2 Test Air",
        "S XY 102 07:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
    ])], day, "a" * 64)


def bus(**changes):
    return FleetSpec(kind="bus", **changes)


def test_missions_use_exact_muc_times_and_explicit_windows_not_remote_clocks():
    config = CoupledConfig(fleets=[bus(coverage_pct=100)], power=PowerConfig(parking_sessions=0))
    world = build_world(schedule(), config, 42)
    assert world == build_world(schedule(), config, 42)
    assert world.world_hash != build_world(schedule(), config, 43).world_hash
    assert len(world.missions) == 2
    arrival, departure = world.missions
    assert arrival.source_entry_id == schedule().rows[0].entry_id
    assert arrival.published_min == 385
    assert arrival.release_min == 385
    assert departure.published_min == 430
    assert departure.release_min == 430 - config.fleets[0].departure_lead_min
    assert departure.deadline_min == 430 - config.fleets[0].departure_buffer_min
    assert world.day_minutes == 1440
    verify_world(world, schedule())


def test_shared_groups_require_explicit_independent_entry_assumption():
    plan = schedule(
        "S XY 102 07:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        "S ZZ 202 07:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Other Air",
    )
    with pytest.raises(ValueError, match="Mehrfach"):
        build_world(plan, CoupledConfig(), 42)
    config = CoupledConfig(shared_group_policy="independent_entries_assumption",
                           fleets=[bus(coverage_pct=100)])
    world = build_world(plan, config, 42)
    assert len(world.missions) == 2
    assert any("Mehrfach" in warning for warning in world.warnings)


def test_different_fleets_have_deterministic_coverage_and_pushback_is_departure_only():
    world = build_world(schedule(), CoupledConfig(fleets=[
        bus(coverage_pct=100), FleetSpec(kind="pushback_tug", coverage_pct=100),
    ]), 42)
    assert sum(m.kind == "pushback_tug" for m in world.missions) == 1
    assert len(world.missions) == 3
    assert world.missions == build_world(schedule(), world.config, 42).missions


def test_world_detects_mission_mutation_and_does_not_guess_missing_fleet_capacity():
    plan = schedule()
    world = build_world(plan, CoupledConfig(fleets=[bus(coverage_pct=100)]), 42)
    world.missions[0].energy_kwh += 1
    with pytest.raises(ValueError, match="Hash"):
        verify_world(world, plan)
    zero_fleet = build_world(plan, CoupledConfig(fleets=[bus(vehicles=0, chargers=0,
                                                          coverage_pct=100)]), 42)
    assert len(zero_fleet.missions) == 2, "Unserviceable demand must not disappear"


@pytest.mark.parametrize("changes", [
    {"initial_soc_pct": float("nan")}, {"mission_energy_kwh": float("inf")},
    {"reserve_soc_pct": 90, "charge_target_soc_pct": 80},
    {"battery_capacity_kwh": 10, "mission_energy_kwh": 11},
    {"departure_lead_min": 5, "departure_buffer_min": 10},
    {"chargers": 51}, {"unknown": 1},
])
def test_invalid_fleet_assumptions_are_rejected(changes):
    with pytest.raises(ValidationError):
        bus(**changes)


def test_stress_configuration_and_horizon_must_match_the_frozen_world():
    with pytest.raises(ValidationError):
        StressEvent(start_min=100, end_min=50, grid_import_limit_kw=0)
    with pytest.raises(ValidationError):
        CoupledConfig(fleets=[bus(), bus()])
    with pytest.raises(ValueError, match="Ladepunkte"):
        build_world(schedule(), CoupledConfig(fleets=[bus(chargers=1)], stress_events=[
            StressEvent(start_min=300, end_min=350, fleet_kind="bus", offline_chargers=2),
        ]), 42)
    with pytest.raises(ValueError, match="Horizont"):
        build_world(schedule(
            "S XY 102 00:10 09:10 1234567 BBB 03.10.26 27.03.27 1 Test Air",
        ), CoupledConfig(warmup_min=0, fleets=[bus(coverage_pct=100)]), 42)


@pytest.mark.parametrize("day,minutes", [(date(2026, 10, 25), 1500),
                                        (date(2027, 3, 28), 1380)])
def test_utc_day_length_not_a_silent_24_hour_reset(day, minutes):
    plan = schedule("S XY 102 07:10 09:10 1234567 BBB 03.10.26 28.03.27 1 Test Air", day=day)
    world = build_world(plan, CoupledConfig(fleets=[bus(coverage_pct=100)]), 42)
    assert world.day_minutes == minutes
    assert world.end_min == minutes + world.config.drain_min
    assert world.start_min == -world.config.warmup_min
