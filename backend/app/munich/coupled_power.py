"""One-minute aggregate active-power accounting, not load flow or electrical protection."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .coupled_models import CoupledPolicy, CoupledWorld, PowerConfig
from .models import EnergyKpiSummary

DT_H = 1 / 60


@dataclass
class ChargeRequest:
    id: str
    sector: str
    kw: float
    deadline: int


class PowerBalance:
    def __init__(self, world: CoupledWorld):
        self.config: PowerConfig = world.config.power
        self.events = world.config.stress_events
        origin = datetime.fromisoformat(world.day_start_utc)
        zone = ZoneInfo("Europe/Berlin")
        self.clock = {
            minute: (origin + timedelta(minutes=minute)).astimezone(zone)
            for minute in range(world.start_min, world.end_min)
        }
        self.stored = self.config.battery_capacity_kwh * self.config.battery_initial_soc_pct / 100
        self.reserve = self.config.battery_capacity_kwh * self.config.battery_reserve_pct / 100
        self.kpis = EnergyKpiSummary(
            model_hours=(world.end_min - world.start_min) / 60, battery_initial_kwh=self.stored,
        )
        # Getrennt gefuehrte Groessen fuer unabhaengige Bilanzpruefungen (fsum je Reihe).
        self.apron_delivered_terms: list[float] = []
        self.storage_in_terms: list[float] = []
        self.storage_out_terms: list[float] = []
        self.unserved_minutes: list[int] = []
        self.unserved_kwh_terms: list[float] = []

    def step(
        self, minute: int, requests: list[ChargeRequest], policy: CoupledPolicy,
    ) -> tuple[dict[str, float], dict[str, float]]:
        p = self.config
        clock_min = self.clock[minute].hour * 60 + self.clock[minute].minute
        background = p.background_load_kw * (
            0.92 + 0.08 * math.sin(2 * math.pi * (clock_min - 360) / 1440)
        )
        sun = max(0, math.sin(math.pi * (clock_min - 360) / 720)) if 360 < clock_min < 1080 else 0
        pv, chp = p.pv_capacity_kwp * p.pv_peak_factor * sun, p.chp_output_kw
        grid_cap = min([p.grid_import_limit_kw] + [
            e.grid_import_limit_kw for e in self.events
            if e.start_min <= minute < e.end_min and e.grid_import_limit_kw is not None
        ])
        discharge_available = min(
            p.battery_power_kw, max(0, self.stored - self.reserve) * p.battery_efficiency / DT_H,
        )
        supply = pv + chp + grid_cap + discharge_available
        served = min(background, supply)
        available = max(0, supply - served)
        limits = {
            "apron": p.apron_transformer_kva * p.power_factor,
            "parking": p.parking_transformer_kva * p.power_factor,
        }
        allocations: dict[str, float] = {}
        if policy == "mission_priority":
            for r in sorted(requests, key=lambda r: (r.deadline, r.sector != "apron", r.id)):
                power = min(r.kw, min(limits[r.sector], available) * p.transformer_efficiency)
                allocations[r.id] = power
                upstream = power / p.transformer_efficiency
                limits[r.sector] -= upstream
                available -= upstream
        else:
            totals = {s: math.fsum(r.kw for r in requests if r.sector == s) for s in limits}
            for r in requests:
                factor = (min(1, limits[r.sector] * p.transformer_efficiency / totals[r.sector])
                          if totals[r.sector] else 1)
                allocations[r.id] = r.kw * factor
            upstream = math.fsum(allocations.values()) / p.transformer_efficiency
            scale = min(1, available / upstream) if upstream else 1
            allocations = {key: value * scale for key, value in allocations.items()}
        # fsum: exakt gerundet, unabhaengig von der Zuteilungsreihenfolge der Regel.
        apron = math.fsum(allocations[r.id] for r in requests if r.sector == "apron")
        parking = math.fsum(allocations[r.id] for r in requests if r.sector == "parking")
        apron_up, parking_up = apron / p.transformer_efficiency, parking / p.transformer_efficiency
        loss = apron_up + parking_up - apron - parking
        demand = served + apron_up + parking_up
        deficit = max(0, demand - pv - chp)
        imported = min(grid_cap, deficit)
        discharge = min(discharge_available, max(0, deficit - imported))
        surplus = max(0, pv + chp - demand)
        room_kw = max(0, p.battery_capacity_kwh - self.stored) / DT_H / p.battery_efficiency
        charge_surplus = min(p.battery_power_kw, surplus, room_kw)
        # Peak-Shaving-Regel (optional): Netzladung nur unterhalb der Schwelle und der
        # wirksamen Grenze; Entladung erfolgt ohnehin erst oberhalb der wirksamen Grenze,
        # daher laden und entladen nie in derselben Minute.
        grid_charge = 0.0
        threshold = p.battery_grid_charge_below_kw
        if threshold is not None and discharge <= 0:
            grid_charge = max(0.0, min(
                p.battery_power_kw - charge_surplus, room_kw - charge_surplus,
                min(threshold, grid_cap) - imported,
            ))
            imported += grid_charge
        charge = charge_surplus + grid_charge
        self.storage_in_terms.append(charge * p.battery_efficiency * DT_H)
        self.storage_out_terms.append(discharge / p.battery_efficiency * DT_H)
        self.stored += (charge * p.battery_efficiency - discharge / p.battery_efficiency) * DT_H
        if self.stored < self.reserve - 1e-7 or self.stored > p.battery_capacity_kwh + 1e-7:
            raise RuntimeError("Speicher-Energiegrenze verletzt")
        self.stored = min(p.battery_capacity_kwh, max(self.reserve, self.stored))
        exported = min(p.grid_export_limit_kw, max(0, surplus - charge_surplus))
        curtailed = max(0, surplus - charge_surplus - exported)
        # Buchfuehrungscheck: curtailed ist hier Rest derselben Gleichung, daher per
        # Konstruktion ~0. Unabhaengige Pruefungen: storage_closure_error, Flottenbilanz.
        error = abs(pv + chp + imported + discharge - demand - charge - exported - curtailed)
        unserved = background - served
        if unserved > 1e-9:
            self.unserved_minutes.append(minute)
            self.unserved_kwh_terms.append(unserved * DT_H)
        self.apron_delivered_terms.append(apron * DT_H * p.charging_efficiency)
        pv_used = min(pv, max(0, demand + charge_surplus - chp))
        pv_surplus = max(0, pv - pv_used)
        pv_curtailed = min(pv_surplus, curtailed)
        k = self.kpis
        k.grid_peak_kw = max(k.grid_peak_kw, imported)
        k.balance_error_max_kw = max(k.balance_error_max_kw, error)
        for attr, kw in {
            "grid_import_kwh": imported, "grid_export_kwh": exported,
            "background_unserved_kwh": background - served,
            "pv_generated_kwh": pv, "pv_used_kwh": pv_used,
            "pv_export_kwh": pv_surplus - pv_curtailed, "pv_curtailed_kwh": pv_curtailed,
            "chp_generated_kwh": chp, "chp_unabsorbed_kwh": curtailed - pv_curtailed,
            "battery_charge_kwh": charge, "battery_discharge_kwh": discharge,
            "battery_loss_kwh": (charge * (1 - p.battery_efficiency)
                                 + discharge * (1 / p.battery_efficiency - 1)),
            "charging_loss_kwh": (apron + parking) * (1 - p.charging_efficiency),
        }.items():
            setattr(k, attr, getattr(k, attr) + kw * DT_H)
        k.battery_final_kwh = self.stored
        return allocations, {
            "minute": float(minute + 1), "grid_import_kw": imported,
            "grid_export_kw": exported, "effective_grid_cap_kw": grid_cap,
            "pv_kw": pv, "chp_kw": chp, "background_served_kw": served,
            "background_unserved_kw": background - served, "ground_charging_kw": apron,
            "parking_kw": parking, "apron_upstream_kw": apron_up,
            "parking_upstream_kw": parking_up, "transformer_loss_kw": loss,
            "battery_charge_kw": charge, "battery_discharge_kw": discharge,
            "battery_soc_pct": self.stored / p.battery_capacity_kwh * 100
            if p.battery_capacity_kwh else 0, "curtailed_kw": curtailed,
            "balance_error_kw": error,
        }

    def fleet_delivered_kwh(self) -> float:
        """Flottenladeenergie aus der Versorgungsseite (nicht aus den Fahrzeugzustaenden)."""
        return math.fsum(self.apron_delivered_terms)

    def storage_closure_error_kwh(self) -> float:
        """Speicher: Endstand gegen Anfang + Zufluss - Abfluss aus getrennten Reihen."""
        expected = (self.kpis.battery_initial_kwh + math.fsum(self.storage_in_terms)
                    - math.fsum(self.storage_out_terms))
        return abs(self.stored - expected)
