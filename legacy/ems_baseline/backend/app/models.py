from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class RunState(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class TimelineEvent(BaseModel):
    at_ms: int = Field(ge=0)
    action: Literal["set", "toggle", "inject"] = "set"
    target: str = Field(min_length=1)
    value: float | int | str | bool | None = None


class Disturbance(BaseModel):
    name: str = Field(min_length=1)
    target: Literal[
        "grid_outage",
        "load_step_kw",
        "frequency_noise",
        "diesel_derate_pct",
        "voltage_sag_pct",
    ]
    start_ms: int = Field(ge=0)
    duration_ms: int = Field(gt=0)
    magnitude: float


class ExpectedAssertion(BaseModel):
    name: str = Field(min_length=1)
    metric: str = Field(min_length=1)
    op: Literal["<", "<=", ">", ">=", "==", "!="]
    threshold: float


class ScenarioDefinition(BaseModel):
    id: str = Field(min_length=3)
    version: str = Field(min_length=1)
    description: str = ""
    duration_ms: int = Field(default=60_000, gt=0)
    tick_ms: int = Field(default=40, gt=0)
    timeline_events: list[TimelineEvent] = Field(default_factory=list)
    disturbances: list[Disturbance] = Field(default_factory=list)
    expected_assertions: list[ExpectedAssertion] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def sort_events(self) -> "ScenarioDefinition":
        self.timeline_events = sorted(self.timeline_events, key=lambda e: e.at_ms)
        return self


class AssetDefinition(BaseModel):
    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    name: str = Field(min_length=1)
    limits: dict[str, float] = Field(default_factory=dict)


class ModelPack(BaseModel):
    id: str = Field(min_length=3)
    site_profile: str = Field(min_length=1)
    assets: list[AssetDefinition] = Field(default_factory=list)
    parameter_set: dict[str, float | int | bool | str] = Field(default_factory=dict)
    calibration_meta: dict[str, Any] = Field(default_factory=dict)


class AdapterConfig(BaseModel):
    name: Literal["opcua", "modbus", "mqtt"]
    enabled: bool = True
    endpoint: str = ""
    profile: str | None = None
    transport: Literal["auto", "sim", "live"] = "auto"
    timeout_ms: int = Field(default=2000, ge=100, le=60_000)
    mapping: dict[str, str] = Field(default_factory=dict)
    watchdog_enabled: bool = False
    watchdog_signal: str = ""
    watchdog_interval_ms: int = Field(default=500, ge=100, le=10_000)
    watchdog_timeout_ms: int = Field(default=1000, ge=200, le=20_000)


class MappingProfileAdapter(BaseModel):
    endpoint: str = ""
    mapping: dict[str, str] = Field(default_factory=dict)


class MappingProfile(BaseModel):
    id: str = Field(min_length=3)
    name: str = Field(min_length=1)
    description: str = ""
    adapters: dict[str, MappingProfileAdapter] = Field(default_factory=dict)


class AssertionSpec(BaseModel):
    metric: str = Field(min_length=1)
    op: Literal["<", "<=", ">", ">=", "==", "!="]
    threshold: float
    name: str = ""

    @model_validator(mode="after")
    def auto_name(self) -> "AssertionSpec":
        if not self.name:
            self.name = f"{self.metric} {self.op} {self.threshold}"
        return self


class RunRequest(BaseModel):
    scenario_id: str = Field(min_length=3)
    model_pack_id: str = Field(min_length=3)
    seed: int = Field(default=42)
    realtime_mode: Literal["sil", "hil_realtime"] = "sil"
    adapters: list[AdapterConfig] = Field(default_factory=list)
    assertions: list[AssertionSpec] = Field(default_factory=list)
    hardware_meta: dict[str, Any] = Field(default_factory=dict)


class TelemetrySample(BaseModel):
    ts: int = Field(ge=0, description="Simulation timestamp in ms")
    source: str
    asset_id: str
    metric: str
    value: float | int | bool
    quality: Literal["good", "degraded", "bad"] = "good"
    unit: str
    run_id: str


class AssertionResult(BaseModel):
    name: str
    metric: str
    op: str
    threshold: float
    observed: float | int | bool
    passed: bool


class RunSummary(BaseModel):
    freq_nadir_hz: float
    volt_nadir_v: float
    blackout_ms: int
    switch_time_ms: int
    final_soc_pct: float
    io_latency_p99_ms: float
    telemetry_hash: str
    tick_target_ms: int = 0
    tick_drift_avg_ms: float = 0.0
    tick_drift_max_ms: float = 0.0
    tick_drift_p99_ms: float = 0.0
    audit_fingerprint_sha256: str = ""


class SafetySummary(BaseModel):
    watchdog_config_loaded: bool = False
    watchdog_ticks_ok: int = 0
    watchdog_misses: int = 0
    watchdog_fail_safe: bool = False
    fail_reason: str = ""
    last_heartbeat_ts_ms: int = 0


class RunStatus(BaseModel):
    run_id: str
    state: RunState
    progress: float = Field(ge=0, le=100)
    start_ts: datetime | None = None
    end_ts: datetime | None = None
    pass_fail: bool | None = None
    artifacts: list[str] = Field(default_factory=list)
    scenario_id: str
    model_pack_id: str
    seed: int
    realtime_mode: str
    error: str | None = None


class RunRecord(BaseModel):
    status: RunStatus
    request: RunRequest
    summary: RunSummary | None = None
    assertion_results: list[AssertionResult] = Field(default_factory=list)
    build_meta: dict[str, Any] = Field(default_factory=dict)
    hardware_meta: dict[str, Any] = Field(default_factory=dict)
    watchdog_summary: SafetySummary = Field(default_factory=SafetySummary)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "twin-core-service"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReadyResponse(BaseModel):
    status: Literal["ready"] = "ready"
    service: str = "twin-core-service"
    data_dir: str
    profile_count: int = Field(ge=0)
    checks: dict[str, bool] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SafetyResponse(BaseModel):
    run_id: str
    state: RunState
    watchdog_summary: SafetySummary
    tick: dict[str, float]
    audit: dict[str, Any]


class ListResponse(BaseModel):
    items: list[Any]
