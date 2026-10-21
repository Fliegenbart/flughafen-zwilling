"""Finite grid scan. A successful tested step is not a continuous global optimum."""
from datetime import datetime, timedelta
from math import ceil
from typing import Callable
from zoneinfo import ZoneInfo

from ..munich.coupled_models import PREDICTIVE_ENGINE_VERSION, CoupledWorld
from ..munich.coupled_power import base_power
from ..munich.coupled_simulator import CoupledResult

GRID_STEP_KW = 25
GRID_MAX_KW = 8000
ENERGY_TOLERANCE_KWH = 1e-5


def minimum_energy_bound(world: CoupledWorld) -> float:
    """Necessary average import, ignoring peaks/losses in storage and partial EV fleets.

    End-SOC gates rule out borrowing initial battery energy. Legacy models count
    only fully electric classes. v3 counts exact fixed electric duties, including
    mixed classes; unlike legacy dispatch it cannot substitute diesel vehicles.
    Surplus generation is optimistically all usable, so this can only be a lower bound.
    """
    p = world.config.power
    origin = datetime.fromisoformat(world.day_start_utc)
    zone = ZoneInfo('Europe/Berlin')
    net_kwh = 0.0
    for minute in range(world.start_min, world.end_min):
        clock = (origin + timedelta(minutes=minute)).astimezone(zone)
        background, pv, chp = base_power(clock.hour * 60 + clock.minute, p)
        net_kwh += (background - pv - chp) / 60
    electric_kinds = {f.kind for f in world.config.fleets
                      if f.electric_vehicles == f.vehicles and f.vehicles > 0}
    battery_energy = sum(m.energy_kwh for m in world.missions if m.kind in electric_kinds)
    if world.engine_version == PREDICTIVE_ENGINE_VERSION:
        from ..munich.charging_plan import duty_roster
        electric_ids = {f'{f.kind}-{i + 1:03d}' for f in world.config.fleets
                        for i in range(f.vehicles if f.electric_vehicles is None
                                       else f.electric_vehicles)}
        battery_energy = sum(d.energy_kwh for d in duty_roster(world)
                             if d.vehicle_id in electric_ids)
    battery_energy += sum(job.energy_kwh for job in world.parking_jobs)
    net_kwh += battery_energy / p.charging_efficiency / p.transformer_efficiency
    return max(0, net_kwh / ((world.end_min - world.start_min) / 60))


def connection_checks(result: CoupledResult) -> dict:
    k, e = result.kpis, result.energy
    reasons = []
    if k.missions_on_time != k.mission_count or not k.mission_count:
        reasons.append("service_deadlines")
    if e.charging_unmet_kwh > ENERGY_TOLERANCE_KWH:
        reasons.append("parking_deadlines")
    if k.background_unserved_kwh > ENERGY_TOLERANCE_KWH:
        reasons.append("background_supply")
    if sum(max(0, v['initial_kwh'] - v['final_kwh'])
           for v in result.terminal_vehicles if v['electric']) > ENERGY_TOLERANCE_KWH:
        reasons.append("vehicle_recharge")
    if e.battery_final_kwh + ENERGY_TOLERANCE_KWH < e.battery_initial_kwh:
        reasons.append("storage_recharge")
    if max(k.fleet_energy_balance_error_kwh, k.storage_energy_balance_error_kwh) > 1e-6:
        reasons.append("energy_balance")
    return {"feasible": not reasons, "reasons": reasons}


def search_connection(evaluate: Callable[[int], CoupledResult], *,
                      step_kw: int = GRID_STEP_KW, max_kw: int = GRID_MAX_KW,
                      lower_bound_kw: float = 0) -> dict:
    if step_kw <= 0 or max_kw < 0 or max_kw % step_kw:
        raise ValueError("Invalid connection scan bounds")
    evaluations = []
    required = None
    for kw in range(ceil(lower_bound_kw / step_kw) * step_kw, max_kw + 1, step_kw):
        result = evaluate(kw)
        checks = connection_checks(result)
        evaluations.append({"grid_kw": kw, "checks": checks, "world_hash": result.world_hash,
                            "missions_on_time": result.kpis.missions_on_time,
                            "mission_count": result.kpis.mission_count})
        if checks['feasible']:
            required = kw
            break
    return {"status": "feasible" if required is not None else "not_found",
            "required_grid_kw": required, "step_kw": step_kw, "max_kw": max_kw,
            "energy_lower_bound_kw": lower_bound_kw,
            "evaluations": evaluations}
