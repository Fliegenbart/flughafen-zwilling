"""Explicit modelling assumptions, never an inferred FMG fleet or aircraft rotation."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ENGINE_VERSION = "airport_coupled_v1"
FleetKind = Literal["bus", "baggage_tractor", "pushback_tug", "gpu"]
CoupledPolicy = Literal["uncontrolled", "mission_priority"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class FleetSpec(StrictModel):
    kind: FleetKind
    vehicles: int = Field(default=20, ge=0, le=200)
    chargers: int = Field(default=8, ge=0, le=200)
    battery_capacity_kwh: float = Field(default=300, gt=0, le=1000)
    initial_soc_pct: float = Field(default=50, ge=0, le=100)
    reserve_soc_pct: float = Field(default=10, ge=0, lt=100)
    charge_target_soc_pct: float = Field(default=85, gt=0, le=100)
    charger_kw: float = Field(default=80, gt=0, le=500)
    mission_energy_kwh: float = Field(default=8, gt=0, le=500)
    service_duration_min: int = Field(default=15, ge=1, le=120)
    return_min: int = Field(default=10, ge=0, le=120)
    departure_lead_min: int = Field(default=45, ge=1, le=180)
    departure_buffer_min: int = Field(default=10, ge=0, le=60)
    arrival_allowance_min: int = Field(default=30, ge=1, le=180)
    coverage_pct: float = Field(default=35, ge=0, le=100)

    @model_validator(mode="after")
    def validate_physics(self) -> FleetSpec:
        if self.chargers > self.vehicles or (self.kind == "bus" and self.chargers > 50):
            raise ValueError("Ladepunkte passen nicht zur modellierten Flotte/Referenzgrenze")
        if self.charge_target_soc_pct <= self.reserve_soc_pct:
            raise ValueError("Ladeziel muss oberhalb der Reserve liegen")
        if self.initial_soc_pct < self.reserve_soc_pct:
            raise ValueError("Flotten-Start-SOC liegt unter der Reserve")
        if self.mission_energy_kwh > self.battery_capacity_kwh * (
            self.charge_target_soc_pct - self.reserve_soc_pct
        ) / 100:
            raise ValueError("Mission benoetigt mehr Energie als oberhalb der Reserve ladbar")
        if self.departure_lead_min - self.departure_buffer_min < self.service_duration_min:
            raise ValueError("Abflug-Servicefenster ist kuerzer als der angenommene Einsatz")
        if self.arrival_allowance_min < self.service_duration_min:
            raise ValueError("Ankunfts-Servicefenster ist kuerzer als der angenommene Einsatz")
        return self


def default_fleets() -> list[FleetSpec]:
    return [
        FleetSpec(kind="bus"),
        FleetSpec(kind="baggage_tractor", vehicles=35, chargers=12,
                  battery_capacity_kwh=80, charger_kw=22, mission_energy_kwh=4,
                  service_duration_min=20, return_min=5, departure_lead_min=60,
                  departure_buffer_min=15, coverage_pct=100),
        FleetSpec(kind="pushback_tug", vehicles=10, chargers=4,
                  battery_capacity_kwh=150, charger_kw=80, mission_energy_kwh=6,
                  service_duration_min=10, return_min=10, departure_lead_min=20,
                  departure_buffer_min=0, coverage_pct=100),
        FleetSpec(kind="gpu", vehicles=35, chargers=10, battery_capacity_kwh=150,
                  charger_kw=50, mission_energy_kwh=20, service_duration_min=30,
                  return_min=5, departure_lead_min=60, departure_buffer_min=15,
                  coverage_pct=100),
    ]


class PowerConfig(StrictModel):
    grid_import_limit_kw: float = Field(default=3500, ge=0, le=100000)
    grid_export_limit_kw: float = Field(default=2000, ge=0, le=100000)
    background_load_kw: float = Field(default=22000, ge=0, le=100000)
    chp_output_kw: float = Field(default=18000, ge=0, le=100000)
    pv_capacity_kwp: float = Field(default=7000, ge=0, le=100000)
    pv_peak_factor: float = Field(default=0.55, ge=0, le=1)
    apron_transformer_kva: float = Field(default=4500, gt=0, le=20000)
    parking_transformer_kva: float = Field(default=2500, gt=0, le=20000)
    power_factor: float = Field(default=0.95, ge=0.01, le=1)
    transformer_efficiency: float = Field(default=0.98, ge=0.5, le=1)
    charging_efficiency: float = Field(default=0.92, ge=0.01, le=1)
    battery_capacity_kwh: float = Field(default=0, ge=0, le=50000)
    battery_power_kw: float = Field(default=1000, ge=0, le=20000)
    battery_initial_soc_pct: float = Field(default=50, ge=0, le=100)
    battery_reserve_pct: float = Field(default=10, ge=0, le=100)
    battery_efficiency: float = Field(default=0.95, ge=0.01, le=1)
    parking_sessions: int = Field(default=200, ge=0, le=275)
    parking_charger_kw: float = Field(default=11, gt=0, le=150)

    @model_validator(mode="after")
    def valid_storage(self) -> PowerConfig:
        if self.battery_initial_soc_pct < self.battery_reserve_pct:
            raise ValueError("Speicher-Start-SOC liegt unter der Reserve")
        return self


class StressEvent(StrictModel):
    start_min: int = Field(ge=0, le=1500)
    end_min: int = Field(gt=0, le=1500)
    grid_import_limit_kw: float | None = Field(default=None, ge=0, le=100000)
    fleet_kind: FleetKind | None = None
    offline_chargers: int = Field(default=0, ge=0, le=200)

    @model_validator(mode="after")
    def valid_effect(self) -> StressEvent:
        if self.start_min >= self.end_min:
            raise ValueError("Stoerungsbeginn muss vor dem Ende liegen")
        if self.grid_import_limit_kw is None and not self.offline_chargers:
            raise ValueError("Stoerung hat keine Wirkung")
        if bool(self.offline_chargers) != bool(self.fleet_kind):
            raise ValueError("Ladepunktausfall benoetigt Fahrzeugklasse und Anzahl")
        return self


class CoupledConfig(StrictModel):
    power: PowerConfig = Field(default_factory=PowerConfig)
    fleets: list[FleetSpec] = Field(default_factory=default_fleets, min_length=1, max_length=4)
    warmup_min: int = Field(default=120, ge=0, le=240)
    drain_min: int = Field(default=240, ge=0, le=480)
    shared_group_policy: Literal["reject_unresolved", "independent_entries_assumption"] = (
        "reject_unresolved"
    )
    stress_events: list[StressEvent] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_fleets(self) -> CoupledConfig:
        if len({f.kind for f in self.fleets}) != len(self.fleets):
            raise ValueError("Fahrzeugklasse mehrfach definiert")
        if sum(f.vehicles for f in self.fleets) > 300:
            raise ValueError("Maximal 300 modellierte Fahrzeuge")
        return self


class CoupledRequest(StrictModel):
    flight_plan_snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    seed: int = Field(default=42, ge=0, le=2147483647)
    config: CoupledConfig = Field(default_factory=CoupledConfig)


class Mission(StrictModel):
    mission_id: str = Field(pattern=r"^[a-z_]+-[a-f0-9]{16}$")
    source_entry_id: str = Field(pattern=r"^[a-f0-9]{16}$")
    kind: FleetKind
    direction: Literal["arrival", "departure"]
    published_min: int
    release_min: int
    deadline_min: int
    duration_min: int = Field(gt=0)
    return_min: int = Field(ge=0)
    energy_kwh: float = Field(gt=0)


class ParkingJob(StrictModel):
    id: str
    release_min: int
    deadline_min: int
    energy_kwh: float = Field(gt=0)
    charger_kw: float = Field(gt=0)


class CoupledWorld(StrictModel):
    engine_version: Literal[ENGINE_VERSION] = ENGINE_VERSION
    seed: int
    source_plan_sha256: str
    config: CoupledConfig
    day_start_utc: str
    day_minutes: int
    start_min: int
    end_min: int
    missions: list[Mission] = Field(min_length=1, max_length=10000)
    parking_jobs: list[ParkingJob] = Field(max_length=275)
    warnings: list[str]
    world_hash: str


class CoupledKpis(StrictModel):
    evidence_level: Literal["schedule_driven_assumptions_uncalibrated"] = (
        "schedule_driven_assumptions_uncalibrated"
    )
    published_entry_count: int = 0
    mission_count: int = 0
    missions_completed: int = 0
    missions_on_time: int = 0
    missions_uncompleted: int = 0
    mission_on_time_pct: float = 0
    completed_mission_delay_avg_min: float | None = None
    modeled_departure_count: int = 0
    departures_ready_on_time: int = 0
    departure_readiness_pct: float | None = None
    departure_deadline_violation_lower_bound_avg_min: float | None = None
    departures_uncompleted: int = 0
    energy_wait_total_min: int = 0
    resource_wait_total_min: int = 0
    fleet_initial_kwh: float = 0
    fleet_final_kwh: float = 0
    fleet_charged_kwh: float = 0
    fleet_consumed_kwh: float = 0
    fleet_energy_balance_error_kwh: float = 0
    fleet_reserve_violations: int = 0
    transformer_loss_kwh: float = 0
    model_horizon_hours: float = 0
