"""Known-duty energy-envelope planning, not an optimal or measured airport controller.

An invariant duty roster prevents diesel substitution from becoming a charging benefit.
The controller spreads required energy over forecast idle/charging opportunities before
each duty and the terminal SOC deadline. The minute simulator, not this forecast, decides
feasibility and enforces actual plugs, power, reserves and service deadlines.
"""
from __future__ import annotations

from array import array
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from math import ceil
from zoneinfo import ZoneInfo

from .coupled_models import CoupledWorld
from .coupled_power import DT_H, base_power
from .coupled_world import canonical_hash


@dataclass(frozen=True)
class Duty:
    mission_id: str
    vehicle_id: str | None
    start_min: int
    duration_min: int
    return_min: int
    deadline_min: int
    energy_kwh: float


@lru_cache(maxsize=16)
def _roster(fleets: tuple, missions: tuple, start_min: int) -> tuple[Duty, ...]:
    available = {kind: {f'{kind}-{i + 1:03d}': start_min for i in range(count)}
                 for kind, count in fleets}
    result = []
    for identity, kind, release, deadline, duration, returning, energy in missions:
        fleet = available[kind]
        vehicle = min(fleet, key=lambda key: (fleet[key], key)) if fleet else None
        start = max(release, fleet[vehicle]) if vehicle else release
        result.append(Duty(identity, vehicle, start, duration, returning, deadline, energy))
        if vehicle:
            fleet[vehicle] = start + duration + returning
    return tuple(result)


def duty_roster(world: CoupledWorld) -> tuple[Duty, ...]:
    return _roster(tuple((f.kind, f.vehicles) for f in world.config.fleets), tuple(
        (m.mission_id, m.kind, m.release_min, m.deadline_min, m.duration_min,
         m.return_min, m.energy_kwh) for m in world.missions), world.start_min)


def duty_hash(world: CoupledWorld) -> str:
    return canonical_hash({'duties': [asdict(d) for d in duty_roster(world)]})


class EnergyEnvelopePlan:
    """Recalculate charging need against all known future duties every minute.

    Forecast opportunities include charger sharing, grid/transformer headroom,
    background/PV and the same immediate parking load as the baseline. Storage receives
    no fictitious forecast energy credit; its actual power/energy is replayed.
    No optimizer guarantee: deterministic greedy allocation can fail.
    """

    def __init__(self, world: CoupledWorld):
        self.start, self.end = world.start_min, world.end_min
        self.efficiency = world.config.power.charging_efficiency
        self.milestones: dict[str, list[tuple[int, float, float]]] = {}
        horizon = self.end - self.start
        specs = {f'{f.kind}-{i + 1:03d}': f for f in world.config.fleets
                 for i in range(f.vehicles if f.electric_vehicles is None else f.electric_vehicles)}
        # A fractional forecast cannot finish every vehicle in the same final
        # minute when there are fewer plugs than vehicles. Reserve one complete
        # minute-discrete plug rotation before each real energy deadline.
        guard = {f.kind: ceil((f.vehicles if f.electric_vehicles is None
                               else f.electric_vehicles) / max(1, f.chargers))
                 for f in world.config.fleets}
        idle = {identity: bytearray([1]) * horizon for identity in specs}
        total = dict.fromkeys(specs, 0.0)
        for duty in duty_roster(world):
            if duty.vehicle_id not in specs:
                continue
            identity = duty.vehicle_id
            spec = specs[identity]
            total[identity] += duty.energy_kwh
            self.milestones.setdefault(identity, []).append((
                duty.start_min - guard[spec.kind], total[identity],
                spec.battery_capacity_kwh * spec.reserve_soc_pct / 100))
            a, b = max(0, duty.start_min - self.start), min(
                horizon, duty.start_min + duty.duration_min + duty.return_min - self.start)
            idle[identity][a:b] = bytes(max(0, b - a))
        for identity, spec in specs.items():
            self.milestones.setdefault(identity, []).append((
                self.end - guard[spec.kind], total[identity],
                spec.battery_capacity_kwh * spec.initial_soc_pct / 100))
        self.opportunities = {identity: array('d', [0.0]) for identity in specs}
        self.port_share = {f.kind: array('d') for f in world.config.fleets}
        by_kind = {f.kind: [key for key, spec in specs.items() if spec.kind == f.kind]
                   for f in world.config.fleets}
        p = world.config.power
        parking_profile = [0.0] * horizon
        for job in world.parking_jobs:
            remaining = job.energy_kwh
            for offset in range(max(0, job.release_min - self.start),
                                min(horizon, job.deadline_min - self.start)):
                kw = min(job.charger_kw, remaining / DT_H / p.charging_efficiency)
                parking_profile[offset] += kw
                remaining -= kw * DT_H * p.charging_efficiency
                if remaining <= 1e-9:
                    break
        origin, zone = datetime.fromisoformat(world.day_start_utc), ZoneInfo('Europe/Berlin')
        for offset in range(horizon):
            minute = self.start + offset
            clock = (origin + timedelta(minutes=minute)).astimezone(zone)
            background, pv, chp = base_power(clock.hour * 60 + clock.minute, p)
            grid = min([p.grid_import_limit_kw] + [e.grid_import_limit_kw
                for e in world.config.stress_events if e.grid_import_limit_kw is not None
                and e.start_min <= minute < e.end_min])
            headroom = min(p.apron_transformer_kva * p.power_factor * p.transformer_efficiency,
                           max(0, grid + pv + chp - background) * p.transformer_efficiency
                           - parking_profile[offset])
            potential = 0.0
            for spec in world.config.fleets:
                count = sum(idle[key][offset] for key in by_kind[spec.kind])
                offline = sum(e.offline_chargers for e in world.config.stress_events
                              if e.fleet_kind == spec.kind and e.start_min <= minute < e.end_min)
                ports = max(0, spec.chargers - offline)
                fraction = min(1, ports / count) if count else 0.0
                self.port_share[spec.kind].append(fraction)
                potential += min(count, ports) * spec.charger_kw
            scale = min(1, max(0, headroom) / potential) if potential else 0.0
            for identity, spec in specs.items():
                opportunity = (idle[identity][offset] * spec.charger_kw
                               * self.port_share[spec.kind][offset] * scale
                               * self.efficiency * DT_H)
                prefix = self.opportunities[identity]
                prefix.append(prefix[-1] + opportunity)

    def request(self, minute: int, vehicle) -> tuple[float, int, float]:
        """Return urgency, real duty deadline, requested vehicle-side kW."""
        offset = minute - self.start
        prefix = self.opportunities[vehicle.id]
        urgency, deadline = 0.0, self.end
        milestones = self.milestones[vehicle.id]
        for i, (due, consumed, reserve) in enumerate(milestones):
            if i < len(milestones) - 1 and consumed <= vehicle.consumed + 1e-8:
                continue
            need = consumed + reserve - vehicle.energy - vehicle.consumed
            if need <= 1e-8:
                continue
            remaining = prefix[min(len(prefix) - 1, max(offset, due - self.start))] - prefix[offset]
            ratio = need / remaining if remaining > 1e-9 else 1e6
            if ratio > urgency:
                urgency, deadline = ratio, due
        share = self.port_share[vehicle.spec.kind][offset]
        forecast_kw = ((prefix[offset + 1] - prefix[offset]) / self.efficiency / DT_H)
        # If delayed work invalidates the forecast idle window, request emergency
        # charging rather than deadlocking on the old planned busy interval.
        kw = (vehicle.spec.charger_kw if urgency >= 1 and forecast_kw <= 1e-9
              else urgency * forecast_kw / max(share, 1e-9))
        return urgency, deadline, min(vehicle.spec.charger_kw, max(0, kw))


def planning_metadata(world: CoupledWorld, policy: str) -> dict:
    return {'method': ('known_duty_energy_envelope_v1' if policy == 'lookahead'
                       else 'immediate_grid_limited_v1'),
            'perfect_foresight': policy == 'lookahead', 'optimality_guaranteed': False,
            'horizon_minutes': world.end_min - world.start_min,
            'duty_roster_hash': duty_hash(world), 'fixed_vehicle_assignments': True,
            'end_soc_enforced_by_replay': True}
