from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass

from .models import ChargingEvidence, ChargingSession, EnergyKpiSummary, MunichAssumptions, Policy

STEP_MIN = 5
HOURS_PER_STEP = STEP_MIN / 60
PARKING_PV_KWP = 3000
CAMPUS_PV_KWP = 7000  # P43/P44 is a subset, not another 3 MWp on top.


@dataclass(eq=True)
class EnergyResult:
    world_hash: str
    sessions: list[ChargingSession]
    evidence: list[ChargingEvidence]
    series: list[dict[str, float]]
    kpis: EnergyKpiSummary


def generate_sessions(config: MunichAssumptions, seed: int) -> list[ChargingSession]:
    rng = random.Random(seed)
    sessions = []
    for i in range(config.bus_sessions):
        sessions.append(ChargingSession(
            id=f"BUS-{i + 1:03d}", sector="bus", arrival_min=rng.choice([0, 30, 60]),
            deadline_min=rng.choice([300, 330, 360]), battery_capacity_kwh=300,
            initial_energy_kwh=90, required_energy_kwh=rng.randint(90, 130),
            charger_kw=config.bus_charger_kw,
        ))
    for i in range(config.parking_sessions):
        sessions.append(ChargingSession(
            id=f"P44-{i + 1:03d}", sector="parking", arrival_min=rng.choice([0, 30, 60, 90]),
            deadline_min=rng.choice([540, 600, 720, 840]), battery_capacity_kwh=80,
            initial_energy_kwh=20, required_energy_kwh=rng.randint(20, 45),
            charger_kw=config.parking_charger_kw,
        ))
    return sessions


def _allocate(
    requests: dict[int, float], sessions: list[ChargingSession], config: MunichAssumptions,
    available_kw: float, policy: Policy,
) -> dict[int, float]:
    limits = {
        "bus": config.bus_transformer_kva * config.power_factor,
        "parking": config.parking_transformer_kva * config.power_factor,
    }
    if policy == "bus_priority":
        allocations = {}
        for i in sorted(requests, key=lambda i: (
            sessions[i].sector != "bus", sessions[i].deadline_min, sessions[i].id,
        )):
            sector = sessions[i].sector
            power = min(requests[i], limits[sector], available_kw)
            allocations[i] = power
            limits[sector] -= power
            available_kw -= power
        return allocations
    # Baseline requests charge immediately. Both policies enforce the same physical limits.
    scaled = dict(requests)
    for sector, limit in limits.items():
        total = math.fsum(v for i, v in requests.items() if sessions[i].sector == sector)
        scale = min(1, limit / total) if total else 1
        for i in scaled:
            if sessions[i].sector == sector:
                scaled[i] *= scale
    total = math.fsum(scaled.values())
    scale = min(1, available_kw / total) if total else 1
    return {i: value * scale for i, value in scaled.items()}


def simulate(
    config: MunichAssumptions, seed: int, policy: Policy,
    *, sessions: list[ChargingSession] | None = None,
) -> EnergyResult:
    if policy not in {"uncontrolled", "bus_priority"}:
        raise ValueError("unsupported charging policy")
    # Revalidate copied/deserialized assumptions; no silent clamping of invalid parameters.
    config = MunichAssumptions.model_validate(config.model_dump())
    sessions = generate_sessions(config, seed) if sessions is None else sessions
    sessions = [ChargingSession.model_validate(s.model_dump()) for s in sessions]
    if len({s.id for s in sessions}) != len(sessions) or len(sessions) > 325:
        raise ValueError("duplicate session IDs or too many sessions")
    world = {"engine": "munich_energy_v1", "seed": seed,
             "assumptions": config.model_dump(), "sessions": [s.model_dump() for s in sessions]}
    world_hash = hashlib.sha256(json.dumps(world, sort_keys=True).encode()).hexdigest()
    remaining = [s.required_energy_kwh for s in sessions]
    ready_at: dict[int, int] = {}
    capacity = config.battery_capacity_kwh
    stored = capacity * config.battery_initial_soc_pct / 100
    reserve = capacity * config.battery_reserve_pct / 100
    kpis = EnergyKpiSummary(battery_initial_kwh=stored)
    series = []
    for minute in range(0, 1440, STEP_MIN):
        background = config.background_load_kw * (
            0.92 + 0.08 * math.sin(2 * math.pi * (minute - 360) / 1440)
        )
        sun = max(0, math.sin(math.pi * (minute - 360) / 720)) if 360 < minute < 1080 else 0
        pv = CAMPUS_PV_KWP * config.pv_peak_factor * sun
        chp = config.chp_output_kw  # Exogenous dispatch; no thermal replacement claim.
        requests = {
            i: min(s.charger_kw, remaining[i] / HOURS_PER_STEP / config.charging_efficiency)
            for i, s in enumerate(sessions)
            if s.arrival_min <= minute < s.deadline_min and remaining[i] > 1e-9
        }
        discharge_available = min(
            config.battery_power_kw,
            max(0, stored - reserve) * config.battery_efficiency / HOURS_PER_STEP,
        )
        supply_limit = pv + chp + config.grid_import_limit_kw + discharge_available
        background_served = min(background, supply_limit)
        allocation = _allocate(requests, sessions, config,
                               max(0, supply_limit - background_served), policy)
        # fsum ist exakt gerundet und damit unabhaengig von der Reihenfolge der Zuteilung:
        # gleiche Leistungen ergeben unabhaengig von der Regel bitgleiche KPIs.
        parking = math.fsum(v for i, v in allocation.items() if sessions[i].sector == "parking")
        buses = math.fsum(v for i, v in allocation.items() if sessions[i].sector == "bus")
        demand = background_served + parking + buses
        deficit = max(0, demand - pv - chp)
        grid_import = min(config.grid_import_limit_kw, deficit)
        discharge = min(discharge_available, max(0, deficit - grid_import))
        surplus = max(0, pv + chp - demand)
        charge = min(config.battery_power_kw, surplus,
                     max(0, capacity - stored) / HOURS_PER_STEP / config.battery_efficiency)
        # Deterministic dispatch: grid up to the cap, battery only bridges the remaining deficit.
        # Battery charges only from generation surplus, never simultaneous with discharge.
        stored += (charge * config.battery_efficiency
                   - discharge / config.battery_efficiency) * HOURS_PER_STEP
        stored = max(reserve, min(capacity, stored))  # Only floating-point roundoff at bounds.
        exported = min(config.grid_export_limit_kw, max(0, surplus - charge))
        curtailed = max(0, surplus - charge - exported)
        balance_error = abs(pv + chp + grid_import + discharge
                            - demand - charge - exported - curtailed)
        # Exogenous CHP has priority in this accounting convention. PV can be curtailed;
        # remaining CHP surplus is explicitly infeasible, not a thermal dispatch recommendation.
        # Initial battery energy has unknown provenance and is never credited as solar.
        pv_used = min(pv, max(0, demand + charge - chp))
        pv_surplus = max(0, pv - pv_used)
        pv_curtailed = min(pv_surplus, curtailed)
        pv_export = pv_surplus - pv_curtailed
        for i, power in allocation.items():
            delivered = power * HOURS_PER_STEP * config.charging_efficiency
            remaining[i] = max(0, remaining[i] - delivered)
            if remaining[i] < 1e-7 and i not in ready_at:
                ready_at[i] = minute + STEP_MIN
        kpis.grid_peak_kw = max(kpis.grid_peak_kw, grid_import)
        kpis.balance_error_max_kw = max(kpis.balance_error_max_kw, balance_error)
        kpis.grid_import_kwh += grid_import * HOURS_PER_STEP
        kpis.grid_export_kwh += exported * HOURS_PER_STEP
        kpis.background_unserved_kwh += (background - background_served) * HOURS_PER_STEP
        kpis.pv_generated_kwh += pv * HOURS_PER_STEP
        kpis.pv_used_kwh += pv_used * HOURS_PER_STEP
        kpis.pv_export_kwh += pv_export * HOURS_PER_STEP
        kpis.pv_curtailed_kwh += pv_curtailed * HOURS_PER_STEP
        kpis.chp_generated_kwh += chp * HOURS_PER_STEP
        kpis.chp_unabsorbed_kwh += (curtailed - pv_curtailed) * HOURS_PER_STEP
        kpis.charging_loss_kwh += (parking + buses) * HOURS_PER_STEP * (
            1 - config.charging_efficiency
        )
        kpis.battery_charge_kwh += charge * HOURS_PER_STEP
        kpis.battery_discharge_kwh += discharge * HOURS_PER_STEP
        kpis.battery_loss_kwh += (
            charge * (1 - config.battery_efficiency)
            + discharge * (1 / config.battery_efficiency - 1)
        ) * HOURS_PER_STEP
        series.append({
            "minute": float(minute + STEP_MIN),
            "grid_import_kw": grid_import, "grid_export_kw": exported,
            "pv_kw": pv, "parking_pv_kw": pv * PARKING_PV_KWP / CAMPUS_PV_KWP,
            "chp_kw": chp, "background_served_kw": background_served,
            "background_unserved_kw": background - background_served,
            "parking_kw": parking, "bus_kw": buses, "battery_charge_kw": charge,
            "battery_discharge_kw": discharge,
            "battery_soc_pct": stored / capacity * 100 if capacity else 0,
            "curtailed_kw": curtailed,
        })
    evidence = [ChargingEvidence(
        **s.model_dump(), delivered_kwh=s.required_energy_kwh - remaining[i],
        unmet_kwh=remaining[i],
        final_energy_kwh=s.initial_energy_kwh + s.required_energy_kwh - remaining[i],
        ready_at_min=ready_at.get(i), deadline_met=i in ready_at,
    ) for i, s in enumerate(sessions)]
    kpis.charging_requested_kwh = sum(s.required_energy_kwh for s in sessions)
    kpis.charging_delivered_kwh = sum(s.delivered_kwh for s in evidence)
    kpis.charging_unmet_kwh = sum(s.unmet_kwh for s in evidence)
    kpis.bus_session_count = sum(s.sector == "bus" for s in evidence)
    kpis.bus_ready_count = sum(s.sector == "bus" and s.deadline_met for s in evidence)
    kpis.parking_session_count = sum(s.sector == "parking" for s in evidence)
    kpis.parking_ready_count = sum(s.sector == "parking" and s.deadline_met for s in evidence)
    kpis.battery_final_kwh = stored
    return EnergyResult(world_hash, sessions, evidence, series, kpis)
