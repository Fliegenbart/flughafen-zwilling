"""Deterministic mission/fleet/power coupling with explicitly hypothetical service windows."""
from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass, field

from .coupled_models import (
    CYCLIC_ENGINE_VERSION,
    GRID_SIZING_ENGINE_VERSION,
    PLANNING_ENGINE_VERSIONS,
    CoupledKpis,
    CoupledPolicy,
    CoupledWorld,
    FleetSpec,
    TaskReadiness,
)
from .coupled_power import DT_H, ChargeRequest, PowerBalance
from .coupled_world import steady_cycle, verify_world
from .flightplan import FlightPlanSnapshot
from .models import EnergyKpiSummary

EPS = 1e-8
# Werte unterhalb dieser Schwelle sind Rundungsrauschen und werden als 0 ausgewiesen.
KPI_EPS = 1e-9


def clean(value: float) -> float:
    return 0.0 if abs(value) < KPI_EPS else value


def share(part: float, total: float) -> float | None:
    return part / total * 100 if total else None


@dataclass(eq=True)
class CoupledResult:
    world_hash: str
    kpis: CoupledKpis
    energy: EnergyKpiSummary
    missions: list[dict]
    departures: list[dict]
    vehicles: list[dict]
    series: list[dict[str, float]]
    parking: list[dict]
    terminal_vehicles: list[dict] = field(default_factory=list)
    planning_meta: dict | None = None


@dataclass
class Vehicle:
    id: str
    spec: FleetSpec
    energy: float
    idle_since: int
    electric: bool = True
    mission: int | None = None
    busy_until: int = 0
    consumed: float = 0.0

    @property
    def reserve(self) -> float:
        return self.spec.battery_capacity_kwh * self.spec.reserve_soc_pct / 100

    @property
    def target(self) -> float:
        return self.spec.battery_capacity_kwh * self.spec.charge_target_soc_pct / 100


# Parkvorgaenge planen ihre Frist mit diesem Puffer (Minuten) und laden ab dann voll.
PARKING_GUARD_MIN = 30


def _steered_parking(minute: int, world: CoupledWorld, remaining: list[float],
                     apron: list[ChargeRequest], supply: PowerBalance) -> list[ChargeRequest]:
    """Gesteuertes Parkhaus (Engine v4 mit Lademanagement): Schnelllader laden sofort voll. Jeder
    andere Vorgang laedt mindestens die gleichmaessige Rate, mit der er seine Frist (minus Puffer)
    noch schafft; darueber fuellt er die freie Leistung nach Vorfeld, Schnellladern und Speicher,
    frueheste Frist zuerst."""
    efficiency = world.config.power.charging_efficiency
    active = sorted((job.deadline_min, i) for i, job in enumerate(world.parking_jobs)
                    if job.release_min <= minute < job.deadline_min and remaining[i] > EPS)
    if not active:
        return []
    out = [ChargeRequest(world.parking_jobs[i].id, "fast",
                         min(world.parking_jobs[i].charger_kw, remaining[i] / DT_H / efficiency),
                         deadline)
           for deadline, i in active if world.parking_jobs[i].group == "dc"]
    active = [(deadline, i) for deadline, i in active if world.parking_jobs[i].group != "dc"]
    room = supply.parking_room(minute, math.fsum(r.kw for r in apron + out))
    plan = {}
    for deadline, i in active:
        job = world.parking_jobs[i]
        cap = min(job.charger_kw, remaining[i] / DT_H / efficiency)
        left = deadline - minute - PARKING_GUARD_MIN
        forced = cap if left <= 1 else min(cap, remaining[i] / efficiency / (left * DT_H))
        plan[i] = [forced, cap]
        room -= forced
    for deadline, i in active:
        forced, cap = plan[i]
        extra = min(cap - forced, max(0.0, room))
        room -= extra
        if forced + extra > EPS:
            out.append(ChargeRequest(world.parking_jobs[i].id, "parking", forced + extra, deadline))
    return out


def simulate_coupled(
    world: CoupledWorld, plan: FlightPlanSnapshot, policy: CoupledPolicy,
    *, capture_traces: bool = True,
) -> CoupledResult:
    if policy not in {"uncontrolled", "mission_priority", "lookahead"}:
        raise ValueError("Nicht unterstuetzte Regel")
    if policy == 'lookahead' and world.engine_version not in PLANNING_ENGINE_VERSIONS:
        raise ValueError('Vorausschauende Ladeplanung benoetigt Engine v3 oder v4')
    if world.engine_version in PLANNING_ENGINE_VERSIONS and policy == 'mission_priority':
        raise ValueError('Engine v3/v4 nutzt uncontrolled oder lookahead, '
                         'nicht die alte Prioritaet')
    verify_world(world, plan)
    world = CoupledWorld.model_validate(world.model_dump())
    source = {entry.entry_id: entry for entry in plan.rows}
    vehicles = [Vehicle(
        id=f"{spec.kind}-{i + 1:03d}", spec=spec,
        energy=(spec.battery_capacity_kwh * spec.initial_soc_pct / 100
                if spec.electric_vehicles is None or i < spec.electric_vehicles else 0),
        electric=spec.electric_vehicles is None or i < spec.electric_vehicles,
        idle_since=world.start_min, busy_until=world.start_min,
    ) for spec in world.config.fleets for i in range(spec.vehicles)]
    fleets = {spec.kind: [v for v in vehicles if v.spec.kind == spec.kind]
              for spec in world.config.fleets}
    roster, planning_meta, controller = {}, None, None
    next_duty = {v.id: 0 for v in vehicles}
    vehicle_duties = {v.id: [] for v in vehicles}
    if world.engine_version in PLANNING_ENGINE_VERSIONS:
        from .charging_plan import EnergyEnvelopePlan, duty_roster, planning_metadata
        roster = {d.mission_id: d for d in duty_roster(world)}
        for i, m in enumerate(world.missions):
            assigned = roster[m.mission_id].vehicle_id
            if assigned is not None:
                vehicle_duties[assigned].append(i)
        planning_meta = planning_metadata(world, policy)
        if policy == 'lookahead':
            controller = EnergyEnvelopePlan(world)
    evidence = [{
        **m.model_dump(), "flight_number": source[m.source_entry_id].flight_number,
        **({"service_day": m.service_day} if world.config.repeat_days > 1 else {}),
        "remote_airport_iata": source[m.source_entry_id].counterpart_iata,
        "source_pages": source[m.source_entry_id].source_pages,
        "source_plan_sha256": plan.content_sha256, "vehicle_id": None,
        "actual_start_min": None, "actual_complete_min": None,
        "return_complete_min": None, "energy_wait_min": 0, "resource_wait_min": 0,
        "consumed_kwh": 0.0,
    } for m in world.missions]
    if roster:
        for row in evidence:
            row['planned_vehicle_id'] = roster[row['mission_id']].vehicle_id
            row['planned_start_min'] = roster[row['mission_id']].start_min
    remaining = [job.energy_kwh for job in world.parking_jobs]
    ready: dict[int, int] = {}
    supply = PowerBalance(world)
    series, traces = [], []
    pending: set[int] = set()
    unassigned: dict[str, set[int]] = {
        kind: {i for i, m in enumerate(world.missions) if m.kind == kind} for kind in fleets
    }
    # Sortierte offene Fristen je Klasse fuer die Ladefrist je Fahrzeug.
    open_deadlines: dict[str, list[tuple[int, int]]] = {
        kind: sorted((world.missions[i].deadline_min, i) for i in indices)
        for kind, indices in unassigned.items()
    }
    release_idx = 0
    consumed, charged, violations, transformer_loss = 0.0, 0.0, 0, 0.0
    electric_fleet = [v for v in vehicles if v.electric]
    initial = math.fsum(v.energy for v in electric_fleet)
    efficiency = world.config.power.charging_efficiency
    # v4: Staende zu Beginn und Ende des Messtags (eingeschwungener Betrieb, steady_cycle).
    cyclic = world.engine_version == CYCLIC_ENGINE_VERSION
    cycle_start, cycle_end = steady_cycle(world)
    cycle_energy: dict[str, float] = {}
    cycle_final: dict[str, float] = {}
    if cyclic:
        supply.cycle = (cycle_start, cycle_end)
    for minute in range(world.start_min, world.end_min):
        if cyclic and minute == cycle_start:
            cycle_energy = {v.id: v.energy for v in electric_fleet}
            supply.kpis.battery_cycle_start_kwh = supply.cycle_min_kwh = supply.stored
            if controller:
                controller.cycle_target = dict(cycle_energy)
        if cyclic and minute == cycle_end:
            cycle_final = {v.id: v.energy for v in electric_fleet}
            supply.kpis.battery_cycle_end_kwh = supply.stored
        for v in vehicles:
            if v.mission is not None:
                row = evidence[v.mission]
                complete = row["actual_start_min"] + row["duration_min"]
                if complete <= minute:
                    row["actual_complete_min"] = complete
                if v.busy_until <= minute:
                    v.mission = None
                    v.idle_since = minute
        while (release_idx < len(world.missions)
               and world.missions[release_idx].release_min <= minute):
            pending.add(release_idx)
            release_idx += 1
        idle_by_kind = {kind: [v for v in fleet if v.mission is None]
                        for kind, fleet in fleets.items()}
        # Both policies use this same non-preemptive EDF service dispatcher.
        for i in sorted(pending, key=lambda i: (
            world.missions[i].deadline_min, world.missions[i].release_min,
            world.missions[i].mission_id,
        )):
            mission, row = world.missions[i], evidence[i]
            idle = idle_by_kind[mission.kind]
            if roster:
                assigned = roster[mission.mission_id].vehicle_id
                idle = [v for v in idle if v.id == assigned and
                        vehicle_duties[v.id][next_duty[v.id]] == i]
            capable = [v for v in idle if not v.electric
                       or v.energy + EPS >= mission.energy_kwh + v.reserve]
            if not capable:
                row["resource_wait_min" if not idle else "energy_wait_min"] += 1
                continue
            # The mixed-fleet reference must not turn "50% electric vehicles" into
            # electric-first dispatch. Older engines retain their original rule.
            v = min(capable, key=(lambda v: (v.idle_since, v.id))
                    if world.engine_version == GRID_SIZING_ENGINE_VERSION
                    else (lambda v: (-v.energy, v.id)))
            idle_by_kind[mission.kind].remove(v)
            if roster:
                next_duty[v.id] += 1
            v.mission = i
            v.busy_until = minute + mission.duration_min + mission.return_min
            row.update(vehicle_id=v.id, actual_start_min=minute,
                       return_complete_min=v.busy_until)
            if v.spec.electric_vehicles is not None:
                row["electric_vehicle"] = v.electric
            pending.remove(i)
            unassigned[mission.kind].remove(i)
            queue = open_deadlines[mission.kind]
            queue.pop(bisect_left(queue, (mission.deadline_min, i)))
        requests: list[ChargeRequest] = []
        for spec in world.config.fleets:
            offline = sum(e.offline_chargers for e in world.config.stress_events
                          if e.fleet_kind == spec.kind and e.start_min <= minute < e.end_min)
            eligible = [v for v in fleets[spec.kind]
                        if v.electric and v.mission is None and v.energy < v.target - EPS]
            planned = ({v.id: controller.request(minute, v, next_duty[v.id]) for v in eligible}
                       if controller else {})
            if controller:
                eligible.sort(key=lambda v: (-planned[v.id][0], planned[v.id][1], v.id))
                eligible = [v for v in eligible if planned[v.id][2] > EPS]
            elif policy == "mission_priority":
                eligible.sort(key=lambda v: (
                    v.energy + EPS >= spec.mission_energy_kwh + v.reserve,
                    max(0, spec.mission_energy_kwh + v.reserve - v.energy), v.id,
                ))
            else:
                eligible.sort(key=lambda v: (v.idle_since, v.id))
            # Ladefrist je Fahrzeug: das k-te Fahrzeug der Regelreihenfolge erhaelt die k-te
            # naechste noch erreichbare offene Frist seiner Klasse (Start jetzt + Servicezeit
            # <= Frist). Vergangene/unerreichbare Fristen werden nie verwendet.
            queue = open_deadlines[spec.kind]
            first = bisect_left(queue, (minute + spec.service_duration_min, -1))
            for rank, v in enumerate(eligible[:spec.chargers - offline]):
                position = first + rank
                deadline = queue[position][0] if position < len(queue) else world.end_min
                requested_kw = spec.charger_kw
                if controller:
                    _, deadline, requested_kw = planned[v.id]
                requests.append(ChargeRequest(
                    v.id, "apron", min(requested_kw, (v.target - v.energy) / DT_H / efficiency),
                    deadline,
                ))
        if cyclic and controller:
            requests.extend(_steered_parking(minute, world, remaining, requests, supply))
        else:
            for i, job in enumerate(world.parking_jobs):
                if job.release_min <= minute < job.deadline_min and remaining[i] > EPS:
                    requests.append(ChargeRequest(
                        job.id, "fast" if job.group == "dc" else "parking",
                        min(job.charger_kw, remaining[i] / DT_H / efficiency), job.deadline_min,
                    ))
        allocation, row = supply.step(minute, requests, policy)
        # Angefragte Ladeleistung (Fahrzeugseite) fuer "fehlende kW"; reine Zusatzspalte.
        row["charging_requested_kw"] = math.fsum(r.kw for r in requests)
        transformer_loss += row["transformer_loss_kw"] * DT_H
        for i, job in enumerate(world.parking_jobs):
            remaining[i] = max(0, remaining[i] - allocation.get(job.id, 0) * DT_H * efficiency)
            if remaining[i] < EPS and i not in ready:
                ready[i] = minute + 1
        for v in vehicles:
            delivered = allocation.get(v.id, 0) * DT_H * efficiency
            v.energy += delivered
            charged += delivered
            state, mission_id = "charging" if delivered > EPS else "idle", None
            if v.mission is not None:
                m = world.missions[v.mission]
                cost = m.energy_kwh / (m.duration_min + m.return_min)
                if not v.electric:
                    cost = 0.0
                v.energy -= cost
                v.consumed += cost
                consumed += cost
                evidence[v.mission]["consumed_kwh"] += cost
                state = "working" if minute < evidence[v.mission]["actual_start_min"] + (
                    m.duration_min
                ) else "returning"
                mission_id = m.mission_id
            if v.electric and (v.energy < v.reserve - EPS
                               or v.energy > v.spec.battery_capacity_kwh + EPS):
                violations += 1
                raise RuntimeError("Fahrzeug-SOC/Reserve verletzt")
            if capture_traces and ((minute + 1 - world.start_min) % 5 == 0
                                   or minute + 1 == world.end_min):
                traces.append({
                    "minute": minute + 1, "vehicle_id": v.id, "kind": v.spec.kind,
                    "energy_kwh": v.energy if v.electric else None,
                    "soc_pct": v.energy / v.spec.battery_capacity_kwh * 100 if v.electric else None,
                    "state": state, "mission_id": mission_id,
                    "charging_kw": allocation.get(v.id, 0),
                    **({"electric_vehicle": v.electric}
                       if v.spec.electric_vehicles is not None else {}),
                })
        row.update({
            "mission_queue": float(len(pending)),
            "fleet_soc_avg_pct": (sum(v.energy / v.spec.battery_capacity_kwh * 100
                                      for v in electric_fleet) / len(electric_fleet)
                                  if electric_fleet else 0),
            "fleet_soc_min_pct": min((v.energy / v.spec.battery_capacity_kwh * 100
                                      for v in electric_fleet), default=0),
            "fleet_busy_count": float(sum(v.mission is not None for v in vehicles)),
            "fleet_charging_count": float(sum(allocation.get(v.id, 0) > EPS for v in vehicles)),
        })
        series.append(row)
    for row in evidence:
        if row["actual_start_min"] is not None:
            completion = row["actual_start_min"] + row["duration_min"]
            if completion <= world.end_min:
                row["actual_complete_min"] = completion
        row["deadline_met"] = (row["actual_complete_min"] is not None
                               and row["actual_complete_min"] <= row["deadline_min"])
        row["delay_min"] = max(0, (row["actual_complete_min"]
                                   if row["actual_complete_min"] is not None else world.end_min)
                               - row["deadline_min"])
        row["delay_is_lower_bound"] = row["actual_complete_min"] is None
        row["wait_cause"] = ("energy_and_resource" if row["energy_wait_min"]
                             and row["resource_wait_min"] else "energy" if row["energy_wait_min"]
                             else "resource" if row["resource_wait_min"] else "none")
    departures = []
    by_entry: dict[tuple[str, int], list[dict]] = {}
    for row in evidence:
        by_entry.setdefault((row["source_entry_id"], row.get("service_day", 0)), []).append(row)
    for entry, day in ((entry, day) for day in range(world.config.repeat_days)
                       for entry in plan.rows):
        if entry.direction != "departure":
            continue
        tasks = by_entry.get((entry.entry_id, day), [])
        if not tasks:
            continue
        departures.append({
            "source_entry_id": entry.entry_id, "flight_number": entry.flight_number,
            "published_min": tasks[0]["published_min"], "mission_count": len(tasks),
            "ready_on_time": all(m["deadline_met"] for m in tasks),
            "service_window_violation_lower_bound_min": max(m["delay_min"] for m in tasks),
            "delay_is_lower_bound": any(m["delay_is_lower_bound"] for m in tasks),
            "mission_ids": [m["mission_id"] for m in tasks],
            "source_plan_sha256": plan.content_sha256,
            **({"service_day": day} if world.config.repeat_days > 1 else {}),
        })
    completed = [row for row in evidence if row["actual_complete_min"] is not None]
    on_time = sum(row["deadline_met"] for row in evidence)
    final = math.fsum(v.energy for v in electric_fleet)
    # Unabhaengige Flottenbilanz: Ladeenergie aus der Versorgungsseite, Verbrauch aus der
    # Auftragsformel (Anteil der gefahrenen Minuten), Endstand aus den Fahrzeugzustaenden.
    consumed_by_formula = math.fsum(
        world.missions[i].energy_kwh * min(
            world.missions[i].duration_min + world.missions[i].return_min,
            world.end_min - row["actual_start_min"],
        ) / (world.missions[i].duration_min + world.missions[i].return_min)
        for i, row in enumerate(evidence) if row["actual_start_min"] is not None
        and row.get("electric_vehicle", True)
    )
    fleet_balance_error = abs(initial + supply.fleet_delivered_kwh() - consumed_by_formula - final)
    storage_error = supply.storage_closure_error_kwh()
    readiness = []
    for spec in world.config.fleets:
        for direction in ("arrival", "departure"):
            rows = [r for r in evidence if r["kind"] == spec.kind and r["direction"] == direction]
            if not rows:
                continue
            energy_wait = sum(r["energy_wait_min"] for r in rows)
            resource_wait = sum(r["resource_wait_min"] for r in rows)
            readiness.append(TaskReadiness(
                kind=spec.kind, direction=direction, mission_count=len(rows),
                missions_on_time=sum(r["deadline_met"] for r in rows),
                missions_uncompleted=sum(r["actual_complete_min"] is None for r in rows),
                on_time_pct=share(sum(r["deadline_met"] for r in rows), len(rows)),
                energy_wait_min=energy_wait, resource_wait_min=resource_wait,
                energy_wait_share_pct=share(energy_wait, energy_wait + resource_wait),
            ))
    energy_wait_total = sum(row["energy_wait_min"] for row in evidence)
    resource_wait_total = sum(row["resource_wait_min"] for row in evidence)
    bottleneck = ("energy_and_resource" if energy_wait_total and resource_wait_total
                  else "energy" if energy_wait_total
                  else "resource" if resource_wait_total else "none")
    unserved_kwh = clean(math.fsum(supply.unserved_kwh_terms))
    warnings = []
    if supply.unserved_minutes:
        warnings.append(
            f"Grundlast in {len(supply.unserved_minutes)} Modellminuten nicht versorgt "
            f"({unserved_kwh:.1f} kWh, erste Minute {supply.unserved_minutes[0]}). Ursache: "
            "Netzimportgrenze + PV + BHKW + Speicher liegen unter der angenommenen Grundlast; "
            "Ladeleistung ist in diesen Minuten 0. Modellkriterium nicht erfuellt.",
        )
    if bottleneck == "resource" and on_time < len(evidence):
        warnings.append(
            "Engpass Fahrzeugverfuegbarkeit, nicht Energie: keine Energie-Warteminuten. "
            "Eine andere Laderegel kann die Bereitschaft in dieser Welt nicht messbar aendern.",
        )
    if fleet_balance_error > 1e-6 or storage_error > 1e-6:
        warnings.append("Unabhaengige Energiebilanz (Flotte/Speicher) weicht ab; Modellfehler.")
    kpis = CoupledKpis(
        published_entry_count=len(plan.rows), mission_count=len(evidence),
        missions_completed=len(completed), missions_on_time=on_time,
        missions_uncompleted=len(evidence) - len(completed),
        mission_on_time_pct=on_time / len(evidence) * 100,
        completed_mission_delay_avg_min=sum(row["delay_min"] for row in completed) / len(completed)
        if completed else None,
        modeled_departure_count=len(departures),
        departures_ready_on_time=sum(d["ready_on_time"] for d in departures),
        departure_readiness_pct=sum(d["ready_on_time"] for d in departures) / len(departures) * 100
        if departures else None,
        departure_deadline_violation_lower_bound_avg_min=sum(
            d["service_window_violation_lower_bound_min"] for d in departures
        ) / len(departures) if departures else None,
        departures_uncompleted=sum(d["delay_is_lower_bound"] for d in departures),
        energy_wait_total_min=energy_wait_total,
        resource_wait_total_min=resource_wait_total,
        fleet_initial_kwh=initial, fleet_final_kwh=final, fleet_charged_kwh=charged,
        fleet_consumed_kwh=consumed, fleet_energy_balance_error_kwh=clean(fleet_balance_error),
        fleet_reserve_violations=violations, transformer_loss_kwh=transformer_loss,
        model_horizon_hours=(world.end_min - world.start_min) / 60,
        storage_energy_balance_error_kwh=clean(storage_error),
        background_unserved_kwh=unserved_kwh,
        background_unserved_minutes=len(supply.unserved_minutes),
        readiness_by_task=readiness,
        energy_wait_share_pct=share(energy_wait_total, energy_wait_total + resource_wait_total),
        bottleneck=bottleneck, model_warnings=warnings,
    )
    # v4: Fristen nach dem Horizontende sind nicht pruefbar (der Vorgang laedt bis zum Ende).
    checked = [not cyclic or job.deadline_min <= world.end_min for job in world.parking_jobs]
    parking = [{**job.model_dump(), "delivered_kwh": job.energy_kwh - remaining[i],
                "unmet_kwh": remaining[i] if checked[i] else 0.0, "ready_at_min": ready.get(i),
                "deadline_met": i in ready,
                **({} if checked[i] else {"deadline_after_horizon": True})}
               for i, job in enumerate(world.parking_jobs)]
    energy = supply.kpis
    if cyclic:
        if cycle_end == world.end_min:
            cycle_final = {v.id: v.energy for v in electric_fleet}
            energy.battery_cycle_end_kwh = energy.battery_final_kwh
        # Rundungsreste unter 0,01 kWh je Fahrzeug zaehlen nicht (grid_sizing.CYCLE_TOLERANCE_KWH).
        energy.vehicle_recharge_deficit_kwh = clean(math.fsum(
            gap for v in electric_fleet if (gap := cycle_energy[v.id] - cycle_final[v.id]) > 0.01))
        # Ein Speicher, der am Messtag voll wurde, pendelt sich unter dem Anfangsstand ein, wenn
        # er den Fehlbetrag bei vollem Speicher noch haette aufnehmen koennen (gleicher Verlauf,
        # nur tiefer, bis er wieder voll ist) und dabei die Reserve nicht erreicht.
        energy.battery_cycle_absorbable_kwh = clean(max(0.0, min(
            supply.cycle_full_slack_kwh, supply.cycle_min_kwh - supply.reserve)))
        energy.storage_recharge_deficit_kwh = clean(max(
            0, energy.battery_cycle_start_kwh - energy.battery_cycle_end_kwh
            - energy.battery_cycle_absorbable_kwh))
    elif world.engine_version in (GRID_SIZING_ENGINE_VERSION, *PLANNING_ENGINE_VERSIONS):
        energy.vehicle_recharge_deficit_kwh = clean(math.fsum(max(
            0, v.spec.battery_capacity_kwh * v.spec.initial_soc_pct / 100 - v.energy)
            for v in electric_fleet))
        energy.storage_recharge_deficit_kwh = clean(max(
            0, energy.battery_initial_kwh - energy.battery_final_kwh))
    # These legacy charging-demand fields refer only to the fixed parking jobs.
    # Fleet demand is endogenous and reported separately in coupled_kpis.
    energy.charging_requested_kwh = sum(job.energy_kwh for job in world.parking_jobs)
    energy.charging_delivered_kwh = sum(row["delivered_kwh"] for row in parking)
    energy.charging_unmet_kwh = clean(sum(r for r, c in zip(remaining, checked) if c))
    energy.parking_session_count = len(parking)
    energy.parking_ready_count = len(ready)
    energy.background_unserved_kwh = clean(energy.background_unserved_kwh)
    return CoupledResult(
        world.world_hash, kpis, energy, evidence, departures, traces, series, parking,
        [{"vehicle_id": v.id, "kind": v.spec.kind, "electric": v.electric,
          "initial_kwh": (v.spec.battery_capacity_kwh * v.spec.initial_soc_pct / 100
                          if v.electric else 0), "final_kwh": v.energy,
          **({"cycle_start_kwh": cycle_energy.get(v.id, 0.0),
              "cycle_end_kwh": cycle_final.get(v.id, 0.0)} if cyclic else {})}
         for v in vehicles], planning_meta,
    )
