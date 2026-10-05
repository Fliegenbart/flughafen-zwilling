"""Deterministic mission/fleet/power coupling with explicitly hypothetical service windows."""
from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass

from .coupled_models import (
    CoupledKpis,
    CoupledPolicy,
    CoupledWorld,
    FleetSpec,
    TaskReadiness,
)
from .coupled_power import DT_H, ChargeRequest, PowerBalance
from .coupled_world import verify_world
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


@dataclass
class Vehicle:
    id: str
    spec: FleetSpec
    energy: float
    idle_since: int
    mission: int | None = None
    busy_until: int = 0

    @property
    def reserve(self) -> float:
        return self.spec.battery_capacity_kwh * self.spec.reserve_soc_pct / 100

    @property
    def target(self) -> float:
        return self.spec.battery_capacity_kwh * self.spec.charge_target_soc_pct / 100


def simulate_coupled(
    world: CoupledWorld, plan: FlightPlanSnapshot, policy: CoupledPolicy,
) -> CoupledResult:
    if policy not in {"uncontrolled", "mission_priority"}:
        raise ValueError("Nicht unterstuetzte Regel")
    verify_world(world, plan)
    world = CoupledWorld.model_validate(world.model_dump())
    source = {entry.entry_id: entry for entry in plan.rows}
    vehicles = [Vehicle(
        id=f"{spec.kind}-{i + 1:03d}", spec=spec,
        energy=spec.battery_capacity_kwh * spec.initial_soc_pct / 100,
        idle_since=world.start_min, busy_until=world.start_min,
    ) for spec in world.config.fleets for i in range(spec.vehicles)]
    fleets = {spec.kind: [v for v in vehicles if v.spec.kind == spec.kind]
              for spec in world.config.fleets}
    evidence = [{
        **m.model_dump(), "flight_number": source[m.source_entry_id].flight_number,
        "remote_airport_iata": source[m.source_entry_id].counterpart_iata,
        "source_pages": source[m.source_entry_id].source_pages,
        "source_plan_sha256": plan.content_sha256, "vehicle_id": None,
        "actual_start_min": None, "actual_complete_min": None,
        "return_complete_min": None, "energy_wait_min": 0, "resource_wait_min": 0,
        "consumed_kwh": 0.0,
    } for m in world.missions]
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
    initial = math.fsum(v.energy for v in vehicles)
    efficiency = world.config.power.charging_efficiency
    for minute in range(world.start_min, world.end_min):
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
        # Both policies use this same non-preemptive EDF service dispatcher.
        for i in sorted(pending, key=lambda i: (
            world.missions[i].deadline_min, world.missions[i].release_min,
            world.missions[i].mission_id,
        )):
            mission, row = world.missions[i], evidence[i]
            idle = [v for v in fleets[mission.kind] if v.mission is None]
            capable = [v for v in idle if v.energy + EPS >= mission.energy_kwh + v.reserve]
            if not capable:
                row["resource_wait_min" if not idle else "energy_wait_min"] += 1
                continue
            v = min(capable, key=lambda v: (-v.energy, v.id))
            v.mission = i
            v.busy_until = minute + mission.duration_min + mission.return_min
            row.update(vehicle_id=v.id, actual_start_min=minute,
                       return_complete_min=v.busy_until)
            pending.remove(i)
            unassigned[mission.kind].remove(i)
            queue = open_deadlines[mission.kind]
            queue.pop(bisect_left(queue, (mission.deadline_min, i)))
        requests: list[ChargeRequest] = []
        for spec in world.config.fleets:
            offline = sum(e.offline_chargers for e in world.config.stress_events
                          if e.fleet_kind == spec.kind and e.start_min <= minute < e.end_min)
            eligible = [v for v in fleets[spec.kind]
                        if v.mission is None and v.energy < v.target - EPS]
            if policy == "mission_priority":
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
                requests.append(ChargeRequest(
                    v.id, "apron", min(spec.charger_kw, (v.target - v.energy) / DT_H / efficiency),
                    deadline,
                ))
        for i, job in enumerate(world.parking_jobs):
            if job.release_min <= minute < job.deadline_min and remaining[i] > EPS:
                requests.append(ChargeRequest(
                    job.id, "parking", min(job.charger_kw, remaining[i] / DT_H / efficiency),
                    job.deadline_min,
                ))
        allocation, row = supply.step(minute, requests, policy)
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
                v.energy -= cost
                consumed += cost
                evidence[v.mission]["consumed_kwh"] += cost
                state = "working" if minute < evidence[v.mission]["actual_start_min"] + (
                    m.duration_min
                ) else "returning"
                mission_id = m.mission_id
            if v.energy < v.reserve - EPS or v.energy > v.spec.battery_capacity_kwh + EPS:
                violations += 1
                raise RuntimeError("Fahrzeug-SOC/Reserve verletzt")
            if (minute + 1 - world.start_min) % 5 == 0 or minute + 1 == world.end_min:
                traces.append({
                    "minute": minute + 1, "vehicle_id": v.id, "kind": v.spec.kind,
                    "energy_kwh": v.energy, "soc_pct": v.energy / v.spec.battery_capacity_kwh * 100,
                    "state": state, "mission_id": mission_id,
                    "charging_kw": allocation.get(v.id, 0),
                })
        row.update({
            "mission_queue": float(len(pending)),
            "fleet_soc_avg_pct": sum(v.energy / v.spec.battery_capacity_kwh * 100
                                     for v in vehicles) / len(vehicles) if vehicles else 0,
            "fleet_soc_min_pct": min((v.energy / v.spec.battery_capacity_kwh * 100
                                      for v in vehicles), default=0),
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
    by_entry: dict[str, list[dict]] = {}
    for row in evidence:
        by_entry.setdefault(row["source_entry_id"], []).append(row)
    for entry in plan.rows:
        if entry.direction != "departure":
            continue
        tasks = by_entry.get(entry.entry_id, [])
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
        })
    completed = [row for row in evidence if row["actual_complete_min"] is not None]
    on_time = sum(row["deadline_met"] for row in evidence)
    final = math.fsum(v.energy for v in vehicles)
    # Unabhaengige Flottenbilanz: Ladeenergie aus der Versorgungsseite, Verbrauch aus der
    # Auftragsformel (Anteil der gefahrenen Minuten), Endstand aus den Fahrzeugzustaenden.
    consumed_by_formula = math.fsum(
        world.missions[i].energy_kwh * min(
            world.missions[i].duration_min + world.missions[i].return_min,
            world.end_min - row["actual_start_min"],
        ) / (world.missions[i].duration_min + world.missions[i].return_min)
        for i, row in enumerate(evidence) if row["actual_start_min"] is not None
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
    parking = [{**job.model_dump(), "delivered_kwh": job.energy_kwh - remaining[i],
                "unmet_kwh": remaining[i], "ready_at_min": ready.get(i), "deadline_met": i in ready}
               for i, job in enumerate(world.parking_jobs)]
    energy = supply.kpis
    # These legacy charging-demand fields refer only to the fixed parking jobs.
    # Fleet demand is endogenous and reported separately in coupled_kpis.
    energy.charging_requested_kwh = sum(job.energy_kwh for job in world.parking_jobs)
    energy.charging_delivered_kwh = sum(row["delivered_kwh"] for row in parking)
    energy.charging_unmet_kwh = sum(remaining)
    energy.parking_session_count = len(parking)
    energy.parking_ready_count = len(ready)
    energy.background_unserved_kwh = clean(energy.background_unserved_kwh)
    return CoupledResult(
        world.world_hash, kpis, energy, evidence, departures, traces, series, parking,
    )
