"""Keep the energy envelope identical without rescanning deadline prefix arrays."""
import random

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.munich.charging_plan import EnergyEnvelopePlan
from app.munich.coupled_simulator import Vehicle
from app.munich.coupled_power import DT_H


def test_request_reads_only_current_and_next_forecast_prefix():
    _, _, _, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=100, grid_import_limit_kw=1100), 'managed')
    plan = EnergyEnvelopePlan(world)
    spec = world.config.fleets[0]
    vehicle = Vehicle(f'{spec.kind}-001', spec, 0, world.start_min)

    class CountedPrefix:
        def __init__(self, values):
            self.values, self.reads = values, 0

        def __len__(self):
            return len(self.values)

        def __getitem__(self, index):
            self.reads += 1
            return self.values[index]

    counted = CountedPrefix(plan.opportunities[vehicle.id])
    plan.opportunities[vehicle.id] = counted
    urgency, _, kw = plan.request(world.start_min, vehicle)
    assert urgency > 0 and kw > 0
    assert counted.reads <= 2


def test_precomputed_envelopes_equal_original_arithmetic_at_deadlines():
    _, _, _, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=100, grid_import_limit_kw=1100), 'managed')
    plan = EnergyEnvelopePlan(world)
    rng = random.Random(42)

    def original(minute, vehicle):
        offset = minute - plan.start
        prefix = plan.opportunities[vehicle.id]
        urgency, deadline = 0.0, plan.end
        milestones = plan.milestones[vehicle.id]
        for i, (due, consumed, reserve) in enumerate(milestones):
            if i < len(milestones) - 1 and consumed <= vehicle.consumed + 1e-8:
                continue
            need = consumed + reserve - vehicle.energy - vehicle.consumed
            if need <= 1e-8:
                continue
            remaining = prefix[min(len(prefix) - 1, max(offset, due - plan.start))] - prefix[offset]
            ratio = need / remaining if remaining > 1e-9 else 1e6
            if ratio > urgency:
                urgency, deadline = ratio, due
        share = plan.port_share[vehicle.spec.kind][offset]
        forecast_kw = (prefix[offset + 1] - prefix[offset]) / plan.efficiency / DT_H
        kw = (vehicle.spec.charger_kw if urgency >= 1 and forecast_kw <= 1e-9
              else urgency * forecast_kw / max(share, 1e-9))
        return urgency, deadline, min(vehicle.spec.charger_kw, max(0, kw))

    for spec in world.config.fleets:
        vehicle = Vehicle(f'{spec.kind}-001', spec, 0, world.start_min)
        milestones = plan.milestones[vehicle.id]
        for due, consumed, _ in milestones:
            for minute in (world.start_min, due - 1, due, due + 1, world.end_min - 1):
                if not world.start_min <= minute < world.end_min:
                    continue
                for spent in (0, consumed - 1e-7, consumed, milestones[-1][1]):
                    vehicle.consumed = max(0, spent)
                    vehicle.energy = rng.random() * spec.battery_capacity_kwh
                    assert plan.request(minute, vehicle) == original(minute, vehicle)
