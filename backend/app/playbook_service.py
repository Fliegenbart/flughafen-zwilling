from __future__ import annotations

import csv
import json
import logging
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Callable
from uuid import uuid4

from .config import Settings
from .forecast_service import ForecastResolution, ForecastService
from .models import (
    AirportKpiSummary,
    PlaybookDelta,
    PlaybookJobState,
    PlaybookOption,
    PlaybookRecord,
    PlaybookRequest,
    PlaybookStatus,
    RunRequest,
    RunState,
    ScenarioDefinition,
)
from .observability import (
    PLAYBOOK_CANDIDATES_EVALUATED,
    PLAYBOOK_JOB_DURATION_SECONDS,
    PLAYBOOK_JOBS_TOTAL,
)
from .playbook_synth import build_playbook_scenario, synthesize_playbook_options
from .run_service import RunService
from .storage import FileStorage, StorageError

logger = logging.getLogger("twin_core.playbook_service")


class PlaybookError(Exception):
    """Raised when playbook jobs cannot be created or executed."""


def _log_event(event: str, **fields: str | int | float | bool | None) -> None:
    logger.info(json.dumps({"event": event, **fields}, sort_keys=True))


class PlaybookService:
    def __init__(self, storage: FileStorage, settings: Settings, run_service: RunService) -> None:
        self.storage = storage
        self.settings = settings
        self.run_service = run_service
        self.forecast_service = ForecastService(storage)
        self._lock = Lock()
        self._enqueue_run: Callable[[str], bool] | None = None

    def set_run_dispatcher(self, enqueue_run: Callable[[str], bool]) -> None:
        self._enqueue_run = enqueue_run

    def _assert_enabled(self) -> None:
        if not self.settings.enable_playbook_synth:
            raise PlaybookError("playbook_synth_disabled")

    def _active_jobs_count(self) -> int:
        active_states = {PlaybookJobState.queued, PlaybookJobState.running}
        return sum(1 for record in self.storage.list_playbook_records() if record.status.state in active_states)

    def _clear_job_artifacts(self, job_id: str) -> None:
        job_dir = self.storage.playbook_job_dir(job_id)
        for path in job_dir.iterdir():
            if path.name == "record.json":
                continue
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)

    @staticmethod
    def _with_recovery_meta(build_meta: dict[str, object], *, recovered: bool) -> dict[str, object]:
        next_meta = dict(build_meta)
        if recovered:
            next_meta["recovery_count"] = int(next_meta.get("recovery_count", 0)) + 1
            next_meta["last_recovered_ts"] = datetime.now(timezone.utc).isoformat()
            next_meta["recovered_after_restart"] = True
        return next_meta

    def _reset_job_record(self, job_id: str, *, recovered_after_restart: bool) -> PlaybookRecord:
        with self._lock:
            record = self.storage.get_playbook_record(job_id)
            self._clear_job_artifacts(job_id)
            record.status.state = PlaybookJobState.queued
            record.status.progress = 0
            record.status.start_ts = None
            record.status.end_ts = None
            record.status.error = None
            record.baseline_option = None
            record.best_option = None
            record.pareto_options = []
            record.candidates_evaluated = 0
            record.frontier_size = 0
            record.artifacts = []
            record.build_meta = self._with_recovery_meta(record.build_meta, recovered=recovered_after_restart)
            self.storage.save_playbook_record(record)
            return record

    def recover_pending_jobs(self) -> list[str]:
        recovered_ids: list[str] = []
        for record in self.storage.list_playbook_records():
            if record.status.state == PlaybookJobState.running:
                self._reset_job_record(record.status.job_id, recovered_after_restart=True)
                recovered_ids.append(record.status.job_id)
            elif record.status.state == PlaybookJobState.queued:
                with self._lock:
                    queued = self.storage.get_playbook_record(record.status.job_id)
                    queued.status.progress = 0
                    queued.status.error = None
                    queued.status.start_ts = None
                    queued.status.end_ts = None
                    self.storage.save_playbook_record(queued)
                recovered_ids.append(record.status.job_id)
        return recovered_ids

    def queue_job(self, request: PlaybookRequest) -> PlaybookStatus:
        self._assert_enabled()
        normalized_request = self._normalize_request(request)

        search_budget_sec = min(max(1, normalized_request.search_budget_sec), self.settings.playbook_budget_sec_max)
        max_options = max(1, min(20, normalized_request.max_options))
        normalized_request = normalized_request.model_copy(update={"search_budget_sec": search_budget_sec, "max_options": max_options})

        with self._lock:
            if self._active_jobs_count() >= self.settings.playbook_max_active_jobs:
                raise PlaybookError("playbook_max_active_jobs_exceeded")

            job_id = uuid4().hex
            status = PlaybookStatus(
                job_id=job_id,
                state=PlaybookJobState.queued,
                progress=0,
            )
            resolved = self.forecast_service.resolve(job_id, normalized_request)
            if resolved.scenario.domain != "airport_turnaround_v1":
                raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
            record = PlaybookRecord(
                status=status,
                request=normalized_request,
                scenario_snapshot=resolved.scenario,
                model_pack_snapshot=resolved.model_pack,
                build_meta={
                    "backend_git_commit": self.settings.build_git_commit,
                    "input_freeze": "queued",
                    "input_resolution": {key: value for key, value in vars(resolved).items()
                                         if key not in {"scenario", "model_pack"}},
                },
            )
            self.storage.save_playbook_record(record)

        _log_event(
            "playbook_queued",
            job_id=job_id,
            scenario_id=normalized_request.scenario_id,
            model_pack_id=normalized_request.model_pack_id,
            seed=normalized_request.seed,
            search_budget_sec=normalized_request.search_budget_sec,
            max_options=normalized_request.max_options,
        )
        PLAYBOOK_JOBS_TOTAL.labels(state="queued").inc()
        return status

    def _normalize_request(self, request: PlaybookRequest) -> PlaybookRequest:
        if request.source_kind == "scenario":
            assert request.scenario_id is not None
            assert request.model_pack_id is not None
            if self.storage.get_scenario(request.scenario_id).domain != "airport_turnaround_v1":
                raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
            if self.storage.get_model_pack(request.model_pack_id).site_profile == "munich_public_reference_v1":
                raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
            return request

        if request.source_kind == "config_snapshot":
            assert request.model_pack_id is not None
            model = self.storage.get_model_pack(request.model_pack_id)
            if model.site_profile == "munich_public_reference_v1":
                raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
            if request.scenario_id:
                if self.storage.get_scenario(request.scenario_id).domain != "airport_turnaround_v1":
                    raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
            return request

        assert request.source_run_id is not None
        source_run = self.run_service.get_run_record(request.source_run_id)
        if source_run.scenario_snapshot and source_run.scenario_snapshot.domain != "airport_turnaround_v1":
            raise PlaybookError("playbook_only_supports_airport_turnaround_v1")
        model_pack_id = request.model_pack_id or source_run.request.model_pack_id
        scenario_id = request.scenario_id or source_run.request.scenario_id
        self.storage.get_model_pack(model_pack_id)
        self.storage.get_scenario(scenario_id)
        return request.model_copy(update={"model_pack_id": model_pack_id, "scenario_id": scenario_id})

    @staticmethod
    def _effective_kpis(option: PlaybookOption) -> AirportKpiSummary:
        return option.validated_airport_kpis or option.estimated_airport_kpis

    @staticmethod
    def _delta_to_baseline(option: PlaybookOption, baseline: PlaybookOption) -> PlaybookDelta:
        current = PlaybookService._effective_kpis(option)
        reference = PlaybookService._effective_kpis(baseline)
        return PlaybookDelta(
            otp_rate_pct_delta=round(current.otp_rate_pct - reference.otp_rate_pct, 6),
            avg_turnaround_min_delta=round(current.avg_turnaround_min - reference.avg_turnaround_min, 6),
            gate_utilization_avg_pct_delta=round(
                current.gate_utilization_avg_pct - reference.gate_utilization_avg_pct,
                6,
            ),
            delay_avg_min_delta=round(current.delay_avg_min - reference.delay_avg_min, 6),
            intervention_cost_delta=round(option.intervention_cost - baseline.intervention_cost, 6),
        )

    def _build_shortlist(self, record: PlaybookRecord, synth) -> tuple[PlaybookOption, PlaybookOption, list[PlaybookOption]]:
        baseline = synth.baseline_option.model_copy(deep=True)
        best = synth.best_option.model_copy(deep=True)
        alternatives: list[PlaybookOption] = []
        seen_option_ids = {baseline.option_id, best.option_id}
        for option in synth.pareto_options:
            if option.option_id in seen_option_ids:
                continue
            alternatives.append(option.model_copy(deep=True))
            seen_option_ids.add(option.option_id)
            if len(alternatives) >= max(0, record.request.max_options - 1):
                break
        return baseline, best, alternatives

    def _validate_option(
        self,
        *,
        job_id: str,
        option: PlaybookOption,
        derived_index: int,
        source_scenario_id: str,
        model_pack_id: str,
        seed: int,
        source_scenario: ScenarioDefinition | None = None,
    ) -> None:
        if self._enqueue_run is None:
            raise PlaybookError("run_dispatcher_not_configured")

        derived_id = (
            f"playbook_{job_id}_baseline_v1"
            if option.option_id == "baseline"
            else f"playbook_{job_id}_opt_{derived_index}_v1"
        )
        base_scenario = source_scenario or self.storage.get_scenario(source_scenario_id)
        derived_scenario = build_playbook_scenario(base_scenario, option, derived_id)
        self.run_service.create_scenario(derived_scenario)

        run_req = RunRequest(
            scenario_id=derived_id,
            model_pack_id=model_pack_id,
            seed=seed,
            realtime_mode="sil",
            adapters=[],
            assertions=[],
            hardware_meta={
                "generated_by": "playbook_synth",
                "playbook_job_id": job_id,
                "playbook_option_id": option.option_id,
            },
        )
        run_status = self.run_service.queue_run(run_req)
        self._enqueue_run(run_status.run_id)
        final_status = self.run_service.wait_for_run_terminal(run_status.run_id, timeout_s=60.0)
        option.derived_scenario_id = derived_id
        option.validation_run_id = run_status.run_id
        option.validation_pass_fail = final_status.state == RunState.completed and final_status.pass_fail is not False
        if final_status.state == RunState.completed:
            run_record = self.run_service.get_run_record(run_status.run_id)
            if run_record.summary and run_record.summary.airport_kpis is not None:
                option.validated_airport_kpis = run_record.summary.airport_kpis

    def _apply_validation_results(
        self,
        *,
        baseline: PlaybookOption,
        best: PlaybookOption,
        alternatives: list[PlaybookOption],
    ) -> None:
        baseline.delta_to_baseline = self._delta_to_baseline(baseline, baseline)
        best.delta_to_baseline = self._delta_to_baseline(best, baseline)
        for option in alternatives:
            option.delta_to_baseline = self._delta_to_baseline(option, baseline)

    def execute_job(self, job_id: str) -> None:
        self._assert_enabled()
        started = time.perf_counter()

        record = self.storage.get_playbook_record(job_id)
        record.status.state = PlaybookJobState.running
        record.status.progress = 2
        record.status.start_ts = datetime.now(timezone.utc)
        self.storage.save_playbook_record(record)
        _log_event("playbook_started", job_id=job_id)
        PLAYBOOK_JOBS_TOTAL.labels(state="running").inc()

        try:
            resolution_meta = record.build_meta.get("input_resolution")
            if record.scenario_snapshot is not None and record.model_pack_snapshot is not None and resolution_meta:
                resolved = ForecastResolution(
                    scenario=record.scenario_snapshot,
                    model_pack=record.model_pack_snapshot,
                    **resolution_meta,
                )
            else:
                resolved = self.forecast_service.resolve(job_id, record.request)
                record.scenario_snapshot = resolved.scenario
                record.model_pack_snapshot = resolved.model_pack
                record.build_meta["input_freeze"] = "legacy_catalog_at_execution"
                record.build_meta["input_resolution"] = {
                    key: value for key, value in vars(resolved).items() if key not in {"scenario", "model_pack"}
                }
                self.storage.save_playbook_record(record)
            scenario = resolved.scenario
            model_pack = resolved.model_pack

            synth = synthesize_playbook_options(
                scenario=scenario,
                model_pack=model_pack,
                seed=record.request.seed,
                constraints=record.request.constraints,
                search_budget_sec=record.request.search_budget_sec,
                search_seed=record.request.search_seed,
                max_candidates=640,
            )

            record = self.storage.get_playbook_record(job_id)
            record.status.progress = 40
            record.candidates_evaluated = synth.candidates_evaluated
            record.frontier_size = synth.frontier_size
            self.storage.save_playbook_record(record)
            _log_event(
                "playbook_candidate_batch",
                job_id=job_id,
                candidates_evaluated=synth.candidates_evaluated,
                frontier_size=synth.frontier_size,
            )

            baseline, best, alternatives = self._build_shortlist(record, synth)
            unique_validation_order: list[PlaybookOption] = []
            seen_option_ids: set[str] = set()
            for option in [baseline, best, *alternatives]:
                if option.option_id in seen_option_ids:
                    continue
                unique_validation_order.append(option)
                seen_option_ids.add(option.option_id)

            validation_run_ids: list[str] = []
            validation_model_pack = model_pack.model_copy(update={"id": f"playbook_{job_id}_validation_model_v1"})
            self.storage.save_model_pack(validation_model_pack)
            option_lookup = {option.option_id: option for option in unique_validation_order}
            for idx, option in enumerate(unique_validation_order, start=1):
                self._validate_option(
                    job_id=job_id,
                    option=option,
                    derived_index=idx,
                    source_scenario_id=scenario.id,
                    model_pack_id=validation_model_pack.id,
                    seed=record.request.seed,
                    source_scenario=scenario,
                )
                if option.validation_run_id:
                    validation_run_ids.append(option.validation_run_id)
                record = self.storage.get_playbook_record(job_id)
                record.status.progress = 40 + ((idx / max(1, len(unique_validation_order))) * 45)
                self.storage.save_playbook_record(record)

            if best.option_id in option_lookup:
                best = option_lookup[best.option_id].model_copy(deep=True)
            if baseline.option_id in option_lookup:
                baseline = option_lookup[baseline.option_id].model_copy(deep=True)
            alternatives = [
                option_lookup[option.option_id].model_copy(deep=True)
                if option.option_id in option_lookup
                else option
                for option in alternatives
            ]
            self._apply_validation_results(baseline=baseline, best=best, alternatives=alternatives)

            record = self.storage.get_playbook_record(job_id)
            record.baseline_option = baseline
            record.best_option = best
            record.pareto_options = alternatives
            record.build_meta = {
                **record.build_meta,
                "source_scenario_id": resolved.source_scenario_id,
                "source_model_pack_id": resolved.source_model_pack_id,
                "source_run_id": resolved.source_run_id,
                "seed": record.request.seed,
                "search_seed": record.request.search_seed if record.request.search_seed is not None else record.request.seed,
                "validation_run_ids": validation_run_ids,
                "forecast_mode": resolved.forecast_mode,
                "forecast_source_kind": resolved.forecast_source_kind,
                "forecast_horizon_min": resolved.forecast_horizon_min,
                "derived_forecast_scenario_id": resolved.derived_scenario_id,
                "derived_forecast_model_pack_id": resolved.derived_model_pack_id,
            }

            self._write_artifacts(record)
            record.status.state = PlaybookJobState.completed
            record.status.progress = 100
            record.status.end_ts = datetime.now(timezone.utc)
            self.storage.save_playbook_record(record)

            elapsed = time.perf_counter() - started
            PLAYBOOK_JOBS_TOTAL.labels(state="completed").inc()
            PLAYBOOK_JOB_DURATION_SECONDS.set(elapsed)
            PLAYBOOK_CANDIDATES_EVALUATED.set(record.candidates_evaluated)
            _log_event(
                "playbook_completed",
                job_id=job_id,
                duration_sec=round(elapsed, 3),
                candidates_evaluated=record.candidates_evaluated,
                frontier_size=record.frontier_size,
            )

        except Exception as exc:
            record = self.storage.get_playbook_record(job_id)
            record.status.state = PlaybookJobState.failed
            record.status.progress = 100
            record.status.error = str(exc)
            record.status.end_ts = datetime.now(timezone.utc)
            self.storage.save_playbook_record(record)
            PLAYBOOK_JOBS_TOTAL.labels(state="failed").inc()
            _log_event("playbook_failed", job_id=job_id, error=str(exc))
            raise

    def _write_artifacts(self, record: PlaybookRecord) -> None:
        job_dir = self.storage.playbook_job_dir(record.status.job_id)

        frontier_path = job_dir / "frontier.json"
        frontier_path.write_text(
            json.dumps(
                {
                    "baseline_option": record.baseline_option.model_dump(mode="json") if record.baseline_option else None,
                    "best_option": record.best_option.model_dump(mode="json") if record.best_option else None,
                    "pareto_options": [opt.model_dump(mode="json") for opt in record.pareto_options],
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        summary_csv_path = job_dir / "summary.csv"
        with summary_csv_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(
                [
                    "option_id",
                    "kind",
                    "feasible",
                    "violation_penalty",
                    "intervention_cost",
                    "otp_rate_pct",
                    "avg_turnaround_min",
                    "gate_utilization_avg_pct",
                    "delay_avg_min",
                    "validated_otp_rate_pct",
                    "validated_avg_turnaround_min",
                    "validated_gate_utilization_avg_pct",
                    "validated_delay_avg_min",
                    "otp_rate_pct_delta",
                    "avg_turnaround_min_delta",
                    "gate_utilization_avg_pct_delta",
                    "delay_avg_min_delta",
                    "intervention_cost_delta",
                    "action_count",
                    "validation_run_id",
                    "validation_pass_fail",
                ]
            )
            option_rows = [
                ("baseline", record.baseline_option),
                ("recommended", record.best_option),
                *[("alternative", option) for option in record.pareto_options],
            ]
            for kind, option in option_rows:
                if option is None:
                    continue
                validated = option.validated_airport_kpis or AirportKpiSummary()
                delta = option.delta_to_baseline or PlaybookDelta()
                writer.writerow(
                    [
                        option.option_id,
                        kind,
                        option.feasible,
                        option.violation_penalty,
                        option.intervention_cost,
                        option.estimated_airport_kpis.otp_rate_pct,
                        option.estimated_airport_kpis.avg_turnaround_min,
                        option.estimated_airport_kpis.gate_utilization_avg_pct,
                        option.estimated_airport_kpis.delay_avg_min,
                        validated.otp_rate_pct if option.validated_airport_kpis else "",
                        validated.avg_turnaround_min if option.validated_airport_kpis else "",
                        validated.gate_utilization_avg_pct if option.validated_airport_kpis else "",
                        validated.delay_avg_min if option.validated_airport_kpis else "",
                        delta.otp_rate_pct_delta,
                        delta.avg_turnaround_min_delta,
                        delta.gate_utilization_avg_pct_delta,
                        delta.delay_avg_min_delta,
                        delta.intervention_cost_delta,
                        len(option.actions),
                        option.validation_run_id or "",
                        option.validation_pass_fail,
                    ]
                )

        playbook_md_path = job_dir / "playbook.md"
        best = record.best_option
        baseline = record.baseline_option
        if best is not None and baseline is not None:
            baseline_kpis = self._effective_kpis(baseline)
            recommended_kpis = self._effective_kpis(best)
            delta = best.delta_to_baseline or self._delta_to_baseline(best, baseline)
            source_scenario_id = record.build_meta.get("source_scenario_id") or record.request.scenario_id or "n/a"
            source_model_pack_id = record.build_meta.get("source_model_pack_id") or record.request.model_pack_id or "n/a"
            lines = [
                "# Playbook Recommendation",
                "",
                f"- Job ID: `{record.status.job_id}`",
                f"- Source Scenario: `{source_scenario_id}`",
                f"- Source Model Pack: `{source_model_pack_id}`",
                f"- Seed: `{record.request.seed}`",
                f"- Baseline Option: `{baseline.option_id}`",
                f"- Recommended Option: `{best.option_id}`",
                f"- Feasible: `{best.feasible}`",
                f"- Violation Penalty: `{best.violation_penalty}`",
                f"- Intervention Cost: `{best.intervention_cost}`",
                f"- Validation Run ID: `{best.validation_run_id or 'n/a'}`",
                "",
                "## Executive Summary",
                "",
            ]
            if record.build_meta.get("forecast_mode"):
                lines.extend(
                    [
                        f"- Forecast Source Kind: `{record.build_meta.get('forecast_source_kind', 'n/a')}`",
                        f"- Forecast Horizon (min): `{record.build_meta.get('forecast_horizon_min', 'n/a')}`",
                        f"- Source Run ID: `{record.build_meta.get('source_run_id', 'n/a')}`",
                        f"- Derived Forecast Scenario: `{record.build_meta.get('derived_forecast_scenario_id', 'n/a')}`",
                        f"- Derived Forecast Model Pack: `{record.build_meta.get('derived_forecast_model_pack_id', 'n/a')}`",
                        "",
                    ]
                )
            lines.extend(
                [
                    f"- Baseline OTP: `{baseline_kpis.otp_rate_pct:.4f}`",
                    f"- Recommended OTP: `{recommended_kpis.otp_rate_pct:.4f}`",
                    f"- Delta OTP: `{delta.otp_rate_pct_delta:+.4f}`",
                    f"- Baseline Turnaround: `{baseline_kpis.avg_turnaround_min:.4f}`",
                    f"- Recommended Turnaround: `{recommended_kpis.avg_turnaround_min:.4f}`",
                    f"- Delta Turnaround: `{delta.avg_turnaround_min_delta:+.4f}`",
                    f"- Delta Gate Utilization: `{delta.gate_utilization_avg_pct_delta:+.4f}`",
                    f"- Delta Delay Avg: `{delta.delay_avg_min_delta:+.4f}`",
                    "",
                    "## Action Timeline",
                    "",
                ]
            )
            for action in best.actions:
                lines.append(
                    f"- t={action.at_ms}ms: `{action.action}` `{action.target}` by `{action.value}` (cost `{action.cost_component}`)"
                )
            playbook_md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        else:
            playbook_md_path.write_text("# Playbook Recommendation\n\nNo recommendation generated.\n", encoding="utf-8")

        record.artifacts = [
            "record.json",
            "frontier.json",
            "playbook.md",
            "summary.csv",
        ]

        self.storage.save_playbook_record(record)

    def get_status(self, job_id: str) -> PlaybookStatus:
        return self.storage.get_playbook_record(job_id).status

    def get_record(self, job_id: str) -> PlaybookRecord:
        return self.storage.get_playbook_record(job_id)

    def list_statuses(self) -> list[PlaybookStatus]:
        return [record.status for record in self.storage.list_playbook_records()]

    def get_artifact_path(self, job_id: str, artifact_name: str) -> Path:
        self.storage.get_playbook_record(job_id)
        return self.storage.playbook_artifact_path(job_id, artifact_name)
