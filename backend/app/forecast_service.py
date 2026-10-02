from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Disturbance, ModelPack, PlaybookRequest, RunRecord, RunState, ScenarioDefinition, TimelineEvent
from .storage import FileStorage

_PARAMETER_KEYS = {
    "gates_total",
    "gates_open_pct",
    "arrivals_per_hour",
    "departures_per_hour",
    "base_turnaround_min",
    "ground_crew_teams",
    "crew_capacity_flights_per_hour",
    "baggage_capacity_flights_per_hour",
    "runway_slots_per_hour",
}


@dataclass
class ForecastResolution:
    scenario: ScenarioDefinition
    model_pack: ModelPack
    source_scenario_id: str | None
    source_model_pack_id: str | None
    source_run_id: str | None
    forecast_mode: bool
    forecast_source_kind: str
    forecast_horizon_min: int | None
    derived_scenario_id: str | None = None
    derived_model_pack_id: str | None = None


class ForecastService:
    def __init__(self, storage: FileStorage) -> None:
        self.storage = storage

    def resolve(self, job_id: str, request: PlaybookRequest) -> ForecastResolution:
        if request.source_kind == "scenario":
            assert request.scenario_id is not None
            assert request.model_pack_id is not None
            return ForecastResolution(
                scenario=self.storage.get_scenario(request.scenario_id),
                model_pack=self.storage.get_model_pack(request.model_pack_id),
                source_scenario_id=request.scenario_id,
                source_model_pack_id=request.model_pack_id,
                source_run_id=request.source_run_id,
                forecast_mode=False,
                forecast_source_kind="scenario",
                forecast_horizon_min=request.forecast_horizon_min,
            )

        if request.source_kind == "config_snapshot":
            assert request.model_pack_id is not None
            base_model_pack = self.storage.get_model_pack(request.model_pack_id)
            template_scenario = self.storage.get_scenario(request.scenario_id) if request.scenario_id else None
            horizon_min = request.forecast_horizon_min or 60
            derived_model_pack = self._build_config_snapshot_model_pack(
                job_id=job_id,
                base_model_pack=base_model_pack,
                config_snapshot=request.config_snapshot,
                horizon_min=horizon_min,
                source_scenario_id=request.scenario_id,
            )
            derived_scenario = self._build_forecast_scenario(
                job_id=job_id,
                source_kind=request.source_kind,
                horizon_min=horizon_min,
                template_scenario=template_scenario,
                current_ts_ms=0,
                extra_disturbances=[],
                metadata={
                    "source_scenario_id": request.scenario_id,
                    "source_model_pack_id": request.model_pack_id,
                },
            )
            self.storage.save_model_pack(derived_model_pack)
            self.storage.save_scenario(derived_scenario)
            return ForecastResolution(
                scenario=derived_scenario,
                model_pack=derived_model_pack,
                source_scenario_id=request.scenario_id,
                source_model_pack_id=request.model_pack_id,
                source_run_id=None,
                forecast_mode=True,
                forecast_source_kind=request.source_kind,
                forecast_horizon_min=horizon_min,
                derived_scenario_id=derived_scenario.id,
                derived_model_pack_id=derived_model_pack.id,
            )

        assert request.source_kind == "run_snapshot"
        assert request.source_run_id is not None
        source_run = self.storage.get_run_record(request.source_run_id)
        source_model_pack_id = request.model_pack_id or source_run.request.model_pack_id
        source_scenario_id = request.scenario_id or source_run.request.scenario_id
        base_model_pack = self.storage.get_model_pack(source_model_pack_id)
        template_scenario = self.storage.get_scenario(source_scenario_id) if source_scenario_id else None
        horizon_min = request.forecast_horizon_min or 60
        latest_metrics, current_ts_ms = self._read_latest_run_metrics(source_run)
        derived_model_pack = self._build_run_snapshot_model_pack(
            job_id=job_id,
            base_model_pack=base_model_pack,
            latest_metrics=latest_metrics,
            horizon_min=horizon_min,
            source_run=source_run,
        )
        derived_scenario = self._build_forecast_scenario(
            job_id=job_id,
            source_kind=request.source_kind,
            horizon_min=horizon_min,
            template_scenario=template_scenario,
            current_ts_ms=current_ts_ms,
            extra_disturbances=self._derive_run_snapshot_disturbances(latest_metrics, horizon_min),
            metadata={
                "source_scenario_id": source_scenario_id,
                "source_model_pack_id": source_model_pack_id,
                "source_run_id": request.source_run_id,
                "current_ts_ms": current_ts_ms,
            },
        )
        self.storage.save_model_pack(derived_model_pack)
        self.storage.save_scenario(derived_scenario)
        return ForecastResolution(
            scenario=derived_scenario,
            model_pack=derived_model_pack,
            source_scenario_id=source_scenario_id,
            source_model_pack_id=source_model_pack_id,
            source_run_id=request.source_run_id,
            forecast_mode=True,
            forecast_source_kind=request.source_kind,
            forecast_horizon_min=horizon_min,
            derived_scenario_id=derived_scenario.id,
            derived_model_pack_id=derived_model_pack.id,
        )

    @staticmethod
    def _forecast_duration_ms(horizon_min: int) -> int:
        return max(60_000, int(horizon_min) * 60_000)

    @staticmethod
    def _forecast_tick_ms(duration_ms: int) -> int:
        target_ticks = 1_500
        tick_ms = max(40, math.ceil(duration_ms / target_ticks / 40.0) * 40)
        return int(tick_ms)

    @staticmethod
    def _clone_future_events(template: ScenarioDefinition | None, current_ts_ms: int, duration_ms: int) -> list[TimelineEvent]:
        if template is None:
            return []
        result: list[TimelineEvent] = []
        for event in template.timeline_events:
            if event.at_ms < current_ts_ms:
                continue
            shifted_at = event.at_ms - current_ts_ms
            if shifted_at > duration_ms:
                continue
            result.append(
                TimelineEvent(
                    at_ms=max(0, shifted_at),
                    action=event.action,
                    target=event.target,
                    value=event.value,
                )
            )
        return result

    @staticmethod
    def _clone_future_disturbances(
        template: ScenarioDefinition | None, current_ts_ms: int, duration_ms: int
    ) -> list[Disturbance]:
        if template is None:
            return []
        result: list[Disturbance] = []
        for disturbance in template.disturbances:
            disturbance_end = disturbance.start_ms + disturbance.duration_ms
            if disturbance_end <= current_ts_ms:
                continue
            shifted_start = max(0, disturbance.start_ms - current_ts_ms)
            active_overlap_start = max(current_ts_ms, disturbance.start_ms)
            remaining_duration = disturbance_end - active_overlap_start
            if shifted_start > duration_ms or remaining_duration <= 0:
                continue
            clipped_duration = min(remaining_duration, duration_ms - shifted_start)
            if clipped_duration <= 0:
                continue
            result.append(
                Disturbance(
                    name=disturbance.name,
                    target=disturbance.target,
                    start_ms=int(shifted_start),
                    duration_ms=int(clipped_duration),
                    magnitude=disturbance.magnitude,
                )
            )
        return result

    def _build_forecast_scenario(
        self,
        *,
        job_id: str,
        source_kind: str,
        horizon_min: int,
        template_scenario: ScenarioDefinition | None,
        current_ts_ms: int,
        extra_disturbances: list[Disturbance],
        metadata: dict[str, Any],
    ) -> ScenarioDefinition:
        duration_ms = self._forecast_duration_ms(horizon_min)
        tick_ms = self._forecast_tick_ms(duration_ms)
        base = template_scenario.model_copy(deep=True) if template_scenario else ScenarioDefinition(
            id=f"forecast_{job_id}_{source_kind}_v1",
            version="1.0.0",
            domain="airport_turnaround_v1",
            description="Forecast derived scenario",
            duration_ms=duration_ms,
            tick_ms=tick_ms,
            timeline_events=[],
            disturbances=[],
            expected_assertions=[],
            metadata={},
        )
        base.id = f"forecast_{job_id}_{source_kind}_v1"
        base.version = "1.0.0"
        base.domain = "airport_turnaround_v1"
        base.duration_ms = duration_ms
        base.tick_ms = tick_ms
        base.description = (
            f"Forecast {source_kind} derived from {template_scenario.id}"
            if template_scenario
            else f"Forecast {source_kind} derived scenario"
        )
        base.timeline_events = self._clone_future_events(template_scenario, current_ts_ms, duration_ms)
        base.disturbances = [
            *self._clone_future_disturbances(template_scenario, current_ts_ms, duration_ms),
            *extra_disturbances,
        ]
        base.metadata = {
            **base.metadata,
            "generated_by": "forecast_mode",
            "source_kind": source_kind,
            "forecast_horizon_min": horizon_min,
            **metadata,
        }
        return base

    @staticmethod
    def _coerce_numeric_snapshot(config_snapshot: dict[str, float | int | bool | str]) -> dict[str, float | int]:
        overrides: dict[str, float | int] = {}
        for key, value in config_snapshot.items():
            if key not in _PARAMETER_KEYS or isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                overrides[key] = value
            elif isinstance(value, str):
                try:
                    overrides[key] = float(value)
                except ValueError:
                    continue
        return overrides

    def _build_config_snapshot_model_pack(
        self,
        *,
        job_id: str,
        base_model_pack: ModelPack,
        config_snapshot: dict[str, float | int | bool | str],
        horizon_min: int,
        source_scenario_id: str | None,
    ) -> ModelPack:
        derived = base_model_pack.model_copy(deep=True)
        derived.id = f"forecast_{job_id}_model_v1"
        derived.parameter_set = {
            **derived.parameter_set,
            **self._coerce_numeric_snapshot(config_snapshot),
        }
        derived.calibration_meta = {
            **derived.calibration_meta,
            "generated_by": "forecast_mode",
            "source_kind": "config_snapshot",
            "forecast_horizon_min": horizon_min,
            "source_model_pack_id": base_model_pack.id,
            "source_scenario_id": source_scenario_id,
        }
        return derived

    def _build_run_snapshot_model_pack(
        self,
        *,
        job_id: str,
        base_model_pack: ModelPack,
        latest_metrics: dict[str, float],
        horizon_min: int,
        source_run: RunRecord,
    ) -> ModelPack:
        params = dict(base_model_pack.parameter_set)
        gate_util = latest_metrics.get("gate_utilization_pct", 0.0)
        crew_util = latest_metrics.get("ground_crew_utilization_pct", 0.0)
        dep_queue = latest_metrics.get("departure_queue_flights", 0.0)
        bag_queue = latest_metrics.get("baggage_queue_flights", 0.0)
        delay = latest_metrics.get("delay_avg_min", 0.0)
        otp = latest_metrics.get("otp_pct", 100.0)

        params["departures_per_hour"] = round(
            max(4.0, float(params.get("departures_per_hour", 24.0)) + min(6.0, dep_queue * 2.5 + max(0.0, 90.0 - otp) * 0.04)),
            3,
        )
        params["baggage_capacity_flights_per_hour"] = round(
            max(4.0, float(params.get("baggage_capacity_flights_per_hour", 26.0)) - min(8.0, bag_queue * 1.8)),
            3,
        )
        params["ground_crew_teams"] = round(
            max(2.0, float(params.get("ground_crew_teams", 14.0)) - min(3.0, max(0.0, crew_util - 88.0) / 8.0)),
            3,
        )
        params["runway_slots_per_hour"] = round(
            max(4.0, float(params.get("runway_slots_per_hour", 28.0)) - min(5.0, delay / 6.0 + dep_queue * 0.75)),
            3,
        )
        params["gates_open_pct"] = round(
            min(100.0, max(35.0, float(params.get("gates_open_pct", 95.0)) - min(12.0, max(0.0, gate_util - 84.0) * 0.35))),
            3,
        )
        params["arrivals_per_hour"] = round(
            max(2.0, float(params.get("arrivals_per_hour", 24.0)) + min(5.0, dep_queue * 0.8 + bag_queue * 0.5)),
            3,
        )

        derived = base_model_pack.model_copy(deep=True)
        derived.id = f"forecast_{job_id}_model_v1"
        derived.parameter_set = params
        derived.calibration_meta = {
            **derived.calibration_meta,
            "generated_by": "forecast_mode",
            "source_kind": "run_snapshot",
            "forecast_horizon_min": horizon_min,
            "source_model_pack_id": base_model_pack.id,
            "source_run_id": source_run.status.run_id,
        }
        return derived

    def _read_latest_run_metrics(self, source_run: RunRecord) -> tuple[dict[str, float], int]:
        metrics: dict[str, float] = {}
        last_ts = 0
        telemetry_path = self.storage.telemetry_path(source_run.status.run_id)
        if telemetry_path.exists():
            metrics, last_ts = self._read_latest_telemetry_metrics(telemetry_path)
        if not metrics and source_run.summary and source_run.summary.airport_kpis is not None:
            kpis = source_run.summary.airport_kpis
            metrics = {
                "otp_pct": kpis.otp_rate_pct,
                "gate_utilization_pct": kpis.gate_utilization_avg_pct,
                "ground_crew_utilization_pct": kpis.ground_crew_utilization_avg_pct,
                "departure_queue_flights": kpis.departure_queue_avg_flights,
                "baggage_queue_flights": kpis.baggage_queue_avg_flights,
                "delay_avg_min": kpis.delay_avg_min,
            }
        if last_ts == 0 and source_run.status.state == RunState.completed:
            try:
                scenario = self.storage.get_scenario(source_run.request.scenario_id)
                last_ts = scenario.duration_ms
            except Exception:
                last_ts = 0
        return metrics, last_ts

    @staticmethod
    def _read_latest_telemetry_metrics(path: Path) -> tuple[dict[str, float], int]:
        metrics: dict[str, float] = {}
        last_ts = -1
        with path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                ts = int(payload.get("ts", 0))
                if ts > last_ts:
                    metrics = {}
                    last_ts = ts
                if ts == last_ts:
                    metric = str(payload.get("metric", ""))
                    value = payload.get("value")
                    if isinstance(value, (int, float)):
                        metrics[metric] = float(value)
        return metrics, max(0, last_ts)

    @staticmethod
    def _derive_run_snapshot_disturbances(latest_metrics: dict[str, float], horizon_min: int) -> list[Disturbance]:
        horizon_ms = ForecastService._forecast_duration_ms(horizon_min)
        initial_window_ms = min(horizon_ms, max(120_000, horizon_ms // 3))
        gate_util = latest_metrics.get("gate_utilization_pct", 0.0)
        crew_util = latest_metrics.get("ground_crew_utilization_pct", 0.0)
        dep_queue = latest_metrics.get("departure_queue_flights", 0.0)
        bag_queue = latest_metrics.get("baggage_queue_flights", 0.0)
        delay = latest_metrics.get("delay_avg_min", 0.0)

        disturbances: list[Disturbance] = []

        gate_blockage = min(30.0, max(0.0, (gate_util - 78.0) * 0.45 + dep_queue * 4.0))
        if gate_blockage > 1.0:
            disturbances.append(
                Disturbance(
                    name="forecast-gate-pressure",
                    target="gate_blockage_pct",
                    start_ms=0,
                    duration_ms=initial_window_ms,
                    magnitude=round(gate_blockage, 3),
                )
            )

        staff_shortage = min(28.0, max(0.0, (crew_util - 86.0) * 0.55 + max(0.0, delay - 4.0) * 0.4))
        if staff_shortage > 1.0:
            disturbances.append(
                Disturbance(
                    name="forecast-staffing-pressure",
                    target="staffing_shortage_pct",
                    start_ms=0,
                    duration_ms=initial_window_ms,
                    magnitude=round(staff_shortage, 3),
                )
            )

        baggage_jam = min(36.0, max(0.0, bag_queue * 12.0 + max(0.0, delay - 5.0) * 1.6))
        if baggage_jam > 1.0:
            disturbances.append(
                Disturbance(
                    name="forecast-baggage-pressure",
                    target="baggage_jam_pct",
                    start_ms=0,
                    duration_ms=initial_window_ms,
                    magnitude=round(baggage_jam, 3),
                )
            )

        runway_reduction = min(32.0, max(0.0, dep_queue * 6.0 + max(0.0, delay - 4.0) * 1.35))
        if runway_reduction > 1.0:
            disturbances.append(
                Disturbance(
                    name="forecast-slot-pressure",
                    target="runway_slot_reduction_pct",
                    start_ms=0,
                    duration_ms=initial_window_ms,
                    magnitude=round(runway_reduction, 3),
                )
            )

        security_delay = min(12.0, max(0.0, delay * 0.35 + dep_queue * 0.9))
        if security_delay > 1.0:
            disturbances.append(
                Disturbance(
                    name="forecast-security-pressure",
                    target="security_delay_min",
                    start_ms=0,
                    duration_ms=initial_window_ms,
                    magnitude=round(security_delay, 3),
                )
            )

        return disturbances
