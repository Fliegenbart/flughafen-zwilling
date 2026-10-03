from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Policy = Literal["uncontrolled", "bus_priority"]


class MunichAssumptions(BaseModel):
    """All operational values are hypothetical, not FMG asset specifications."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    grid_import_limit_kw: float = Field(default=3500, ge=0, le=100000)
    grid_export_limit_kw: float = Field(default=2000, ge=0, le=100000)
    background_load_kw: float = Field(default=22000, ge=0, le=100000)
    chp_output_kw: float = Field(default=18000, ge=0, le=100000)
    parking_transformer_kva: float = Field(default=2500, gt=0, le=20000)
    bus_transformer_kva: float = Field(default=4500, gt=0, le=20000)
    power_factor: float = Field(default=0.95, ge=0.01, le=1)
    pv_peak_factor: float = Field(default=0.55, ge=0, le=1)
    parking_sessions: int = Field(default=200, ge=0, le=275)
    bus_sessions: int = Field(default=50, ge=0, le=50)
    parking_charger_kw: float = Field(default=11, gt=0, le=150)
    bus_charger_kw: float = Field(default=80, gt=0, le=500)
    charging_efficiency: float = Field(default=0.92, ge=0.01, le=1)
    battery_capacity_kwh: float = Field(default=0, ge=0, le=50000)
    battery_power_kw: float = Field(default=1000, ge=0, le=20000)
    battery_initial_soc_pct: float = Field(default=50, ge=0, le=100)
    battery_reserve_pct: float = Field(default=10, ge=0, le=100)
    battery_efficiency: float = Field(default=0.95, ge=0.01, le=1)

    @model_validator(mode="after")
    def valid_reserve(self) -> MunichAssumptions:
        if self.battery_initial_soc_pct < self.battery_reserve_pct:
            raise ValueError("initial SOC must be at least the reserve")
        return self


class MunichCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed: int = Field(default=42, ge=0, le=2147483647)
    assumptions: MunichAssumptions = Field(default_factory=MunichAssumptions)


class ChargingSession(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$")
    sector: Literal["bus", "parking"]
    arrival_min: int = Field(ge=0, lt=1440, multiple_of=5)
    deadline_min: int = Field(gt=0, le=1440, multiple_of=5)
    battery_capacity_kwh: float = Field(gt=0, le=1000)
    initial_energy_kwh: float = Field(ge=0)
    required_energy_kwh: float = Field(gt=0)
    charger_kw: float = Field(gt=0, le=500)

    @model_validator(mode="after")
    def validate_window_and_energy(self) -> ChargingSession:
        if self.arrival_min >= self.deadline_min:
            raise ValueError("arrival must precede deadline")
        if self.initial_energy_kwh + self.required_energy_kwh > self.battery_capacity_kwh:
            raise ValueError("required energy exceeds battery headroom")
        return self


class ChargingEvidence(ChargingSession):
    delivered_kwh: float
    unmet_kwh: float
    final_energy_kwh: float
    ready_at_min: int | None = None
    deadline_met: bool


class EnergyKpiSummary(BaseModel):
    evidence_level: Literal["synthetic_uncalibrated"] = "synthetic_uncalibrated"
    model_hours: float = 24
    grid_peak_kw: float = 0
    grid_import_kwh: float = 0
    grid_export_kwh: float = 0
    background_unserved_kwh: float = 0
    charging_requested_kwh: float = 0
    charging_delivered_kwh: float = 0
    charging_unmet_kwh: float = 0
    charging_loss_kwh: float = 0
    bus_ready_count: int = 0
    bus_session_count: int = 0
    parking_ready_count: int = 0
    parking_session_count: int = 0
    pv_generated_kwh: float = 0
    pv_used_kwh: float = 0
    pv_export_kwh: float = 0
    pv_curtailed_kwh: float = 0
    chp_generated_kwh: float = 0
    chp_unabsorbed_kwh: float = 0
    battery_initial_kwh: float = 0
    battery_final_kwh: float = 0
    battery_charge_kwh: float = 0
    battery_discharge_kwh: float = 0
    battery_loss_kwh: float = 0
    balance_error_max_kw: float = 0
