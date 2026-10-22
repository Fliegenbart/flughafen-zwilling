"""Keep the energy envelope identical without rescanning deadline prefix arrays."""
import random

from app.exchange.electrification import ElectrificationRequest, prepare_electrification
from app.munich.charging_plan import PLAN_MARGIN, EnergyEnvelopePlan
from app.munich.coupled_models import PREDICTIVE_ENGINE_VERSION
from app.munich.coupled_simulator import Vehicle
from app.munich.coupled_power import DT_H
from app.munich.coupled_world import build_world


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
    # Eingefrorene v3-Laeufe muessen genau wie frueher rechnen.
    plan_snapshot, config, _, v4_world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=100, grid_import_limit_kw=1100), 'managed')
    world = build_world(plan_snapshot, config, v4_world.seed, PREDICTIVE_ENGINE_VERSION)
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


def test_v4_plans_from_the_measured_charge_not_from_nominal_consumption():
    """Gleicher Ladestand, gleiche offene Einsaetze: gleiche Anfrage, egal wie viel ein Fahrzeug
    bisher tatsaechlich verbraucht hat (v3 rechnete mit dem nominal verbrauchten Anteil)."""
    _, _, _, world, _ = prepare_electrification(ElectrificationRequest(
        electric_share_pct=100, grid_import_limit_kw=1100), 'managed')
    plan = EnergyEnvelopePlan(world)
    spec = next(f for f in world.config.fleets if f.kind == 'gpu')
    identity = f'{spec.kind}-001'
    steps = plan.steps[identity]
    due, count = steps[1][0], steps[1][1]
    minute = due - 30
    a = Vehicle(identity, spec, 40.0, world.start_min, consumed=0.0)
    b = Vehicle(identity, spec, 40.0, world.start_min, consumed=37.0)
    assert plan.request(minute, a, 1) == plan.request(minute, b, 1)
    # Bedarf fuer den naechsten Einsatz: Einsatzenergie mit Planreserve plus Reserve minus Stand.
    cumulative = plan.cumulative[identity]
    reserve = spec.battery_capacity_kwh * spec.reserve_soc_pct / 100
    needs = list(plan._needs(minute, a, 1))
    assert needs[0][1] == (cumulative[count] - cumulative[1]) * PLAN_MARGIN + reserve - 40.0
    # Erledigte Einsaetze zaehlen nicht mehr, der Zielstand am Ende des Messtags schon.
    assert all(n[0] >= steps[1][0] for n in needs)
