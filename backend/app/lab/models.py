from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CaseId = Literal["setpoint-step", "flex-reduction", "power-cap", "telemetry-loss"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Bench(Model):
    name: str = Field(default="Referenz-Pruefstand", min_length=1, max_length=100)
    min_power_kw: float = Field(default=0, ge=-10000, le=0)
    max_power_kw: float = Field(default=120, gt=0, le=10000)
    grid_limit_kw: float = Field(default=80, gt=0, le=10000)
    ramp_kw_per_s: float = Field(default=20, gt=0, le=10000)
    response_delay_s: int = Field(default=1, ge=0, le=120)
    noise_kw: float = Field(default=0.15, ge=0, le=5)


class Criteria(Model):
    tolerance_kw: float = Field(default=2, ge=0, le=100)
    tracking_mae_max_kw: float = Field(default=3, ge=0, le=100)
    response_max_s: float = Field(default=10, gt=0, le=300)
    settling_s: float = Field(default=3, gt=0, le=60)
    grace_s: float = Field(default=10, ge=0, le=300)
    limit_violation_budget_s: float = Field(default=1, ge=0, le=300)
    # Untergrenze: unter 90 % Abdeckung ist keine belastbare Aussage moeglich.
    min_coverage_pct: float = Field(default=98, ge=90, le=100)
    expected_interval_s: float = Field(default=1, gt=0, le=1000)
    max_gap_s: float = Field(default=3, gt=0, le=300)

    @model_validator(mode="after")
    def check_intervals(self):
        if self.max_gap_s < self.expected_interval_s:
            raise ValueError("max_gap_s muss >= expected_interval_s sein")
        if self.max_gap_s > 10 * self.expected_interval_s:
            raise ValueError("max_gap_s darf hoechstens das 10-fache von expected_interval_s sein")
        return self


class Sample(Model):
    ts_s: float = Field(ge=0)
    power_kw: float | None
    setpoint_kw: float
    limit_kw: float = Field(gt=0)


class RunRequest(Model):
    case_id: CaseId = "setpoint-step"
    label: str = Field(default="", max_length=120)
    bench: Bench = Field(default_factory=Bench)
    criteria: Criteria = Field(default_factory=Criteria)
    duration_s: int = Field(default=180, ge=60, le=1800)
    seed: int = Field(default=42, ge=0, le=2147483647)
    playback_speed: float = Field(default=20, ge=1, le=100)

    @model_validator(mode="after")
    def sufficient_fault_window(self):
        if self.case_id == "telemetry-loss" and self.duration_s < 90:
            raise ValueError("Telemetrieausfall benoetigt mindestens 90 s Modellzeit")
        return self


class ImportRequest(Model):
    case_id: CaseId = "setpoint-step"
    label: str = Field(default="", max_length=120)
    bench: Bench = Field(default_factory=Bench)
    criteria: Criteria = Field(default_factory=Criteria)
    filename: str = Field(min_length=1, max_length=200)
    csv_text: str = Field(min_length=1, max_length=5_000_000)


class Metrics(Model):
    peak_power_kw: float
    energy_import_kwh: float
    energy_export_kwh: float
    tracking_mae_kw: float | None
    response_time_s: float | None
    limit_violation_s: float
    observed_duration_s: float


class Quality(Model):
    coverage_pct: float
    sampling_coverage_pct: float | None = None
    missing_samples: int
    sample_count: int
    max_gap_s: float
    reasons: list[str] = Field(default_factory=list)


class Check(Model):
    id: str
    name: str
    state: Literal["pass", "fail", "inconclusive", "not_applicable"]
    actual: float | None
    threshold: float | None
    unit: str
    detail: str


class Analysis(Model):
    verdict: Literal["pass", "fail", "inconclusive"]
    metrics: Metrics
    quality: Quality
    checks: list[Check]


class RunRecord(Model):
    schema_version: str = "flexlab_v1"
    run_id: str
    state: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    source: Literal["simulation", "csv_import"]
    case_id: CaseId
    label: str
    bench: Bench
    criteria: Criteria
    created_ts: str
    start_ts: str | None = None
    end_ts: str | None = None
    progress: float = 0
    error: str | None = None
    request: RunRequest | None = None
    filename: str | None = None
    source_sha256: str | None = None
    comparison_key: str | None = None
    analysis: Analysis | None = None
    recovery_count: int = 0
    last_recovered_ts: str | None = None
    build_commit: str = "unknown"
    build_source_sha256: str = "unknown"
    artifacts: list[str] = Field(default_factory=list)
    provenance: str = "Keine Live-Anbindung; keine unabhaengige Hardwarekalibrierung."
