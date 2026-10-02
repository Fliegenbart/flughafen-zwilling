from __future__ import annotations

import json
import logging
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4

from .config import Settings
from .adapters import build_adapters
from .deterministic import run_simulation
from .models import (
    ModelPack,
    RunRecord,
    RunRequest,
    RunState,
    RunStatus,
    SafetyResponse,
    SafetySummary,
    ScenarioDefinition,
    TelemetrySample,
)
from .observability import InfluxTelemetryWriter, RUNS_TOTAL, TICK_DRIFT_P99, WATCHDOG_MISSES
from .reporting import build_report_payload, write_pdf_report
from .storage import FileStorage, StorageError

logger = logging.getLogger("twin_core.run_service")


def _log_event(event: str, **fields: str | int | float | bool | None) -> None:
    logger.info(json.dumps({"event": event, **fields}, sort_keys=True))


class RunService:
    def __init__(self, storage: FileStorage, settings: Settings) -> None:
        self.storage = storage
        self.settings = settings
        self._lock = Lock()

    @staticmethod
    def _canon_json_bytes(payload: dict) -> bytes:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    def _compute_audit_fingerprint(
        self,
        run_request: RunRequest,
        scenario: ScenarioDefinition,
        model_pack: ModelPack,
        telemetry_path: Path,
    ) -> str:
        digest = sha256()
        digest.update(b"run_request\n")
        digest.update(self._canon_json_bytes(run_request.model_dump(mode="json")))
        digest.update(b"\nscenario\n")
        digest.update(self._canon_json_bytes(scenario.model_dump(mode="json")))
        digest.update(b"\nmodel_pack\n")
        digest.update(self._canon_json_bytes(model_pack.model_dump(mode="json")))
        digest.update(b"\ntelemetry\n")
        digest.update(telemetry_path.read_bytes())
        return digest.hexdigest()

    def recompute_audit_fingerprint(self, run_id: str) -> str:
        record = self.storage.get_run_record(run_id)
        scenario = self.storage.get_scenario(record.request.scenario_id)
        model_pack = self.storage.get_model_pack(record.request.model_pack_id)
        telemetry_path = self.get_run_telemetry_path(run_id)
        return self._compute_audit_fingerprint(record.request, scenario, model_pack, telemetry_path)

    def create_scenario(self, scenario: ScenarioDefinition) -> ScenarioDefinition:
        self.storage.save_scenario(scenario)
        return scenario

    def get_scenario(self, scenario_id: str) -> ScenarioDefinition:
        return self.storage.get_scenario(scenario_id)

    def list_scenarios(self) -> list[ScenarioDefinition]:
        return self.storage.list_scenarios()

    def create_model_pack(self, model_pack: ModelPack) -> ModelPack:
        self.storage.save_model_pack(model_pack)
        return model_pack

    def get_model_pack(self, model_pack_id: str) -> ModelPack:
        return self.storage.get_model_pack(model_pack_id)

    def list_model_packs(self) -> list[ModelPack]:
        return self.storage.list_model_packs()

    def queue_run(self, request: RunRequest) -> RunStatus:
        # Validate references before creating the run.
        self.storage.get_scenario(request.scenario_id)
        self.storage.get_model_pack(request.model_pack_id)

        run_id = uuid4().hex
        status = RunStatus(
            run_id=run_id,
            state=RunState.queued,
            progress=0,
            scenario_id=request.scenario_id,
            model_pack_id=request.model_pack_id,
            seed=request.seed,
            realtime_mode=request.realtime_mode,
        )
        record = RunRecord(
            status=status,
            request=request,
            build_meta={"backend_git_commit": self.settings.build_git_commit},
            hardware_meta=request.hardware_meta,
        )
        self.storage.save_run_record(record)
        _log_event(
            "run_queued",
            run_id=run_id,
            scenario_id=request.scenario_id,
            model_pack_id=request.model_pack_id,
            seed=request.seed,
            realtime_mode=request.realtime_mode,
        )
        return status

    def execute_run(self, run_id: str) -> None:
        with self._lock:
            record = self.storage.get_run_record(run_id)
            record.status.state = RunState.running
            record.status.progress = 5
            record.status.start_ts = datetime.now(timezone.utc)
            self.storage.save_run_record(record)
            _log_event(
                "run_started",
                run_id=run_id,
                scenario_id=record.status.scenario_id,
                model_pack_id=record.status.model_pack_id,
                state=record.status.state.value,
            )

        influx = None
        if self.settings.influx_token:
            influx = InfluxTelemetryWriter(
                self.settings.influx_url,
                self.settings.influx_token,
                self.settings.influx_org,
                self.settings.influx_bucket,
            )
        telemetry_path = self.storage.run_dir(run_id) / "telemetry.jsonl"

        try:
            scenario = self.storage.get_scenario(record.request.scenario_id)
            model_pack = self.storage.get_model_pack(record.request.model_pack_id)
            adapters = build_adapters(record.request.adapters)

            with telemetry_path.open("w", encoding="utf-8") as f_out:

                def on_sample(sample: TelemetrySample) -> None:
                    f_out.write(json.dumps(sample.model_dump(mode="json"), sort_keys=True) + "\n")
                    if influx:
                        influx.write_sample(run_id, sample)

                result = run_simulation(
                    run_id=run_id,
                    scenario=scenario,
                    model_pack=model_pack,
                    seed=record.request.seed,
                    realtime_mode=record.request.realtime_mode,
                    adapters=adapters,
                    run_assertions=record.request.assertions,
                    telemetry_callback=on_sample,
                )

            audit_fingerprint = self._compute_audit_fingerprint(record.request, scenario, model_pack, telemetry_path)

            with self._lock:
                record = self.storage.get_run_record(run_id)
                record.status.progress = 85
                self.storage.save_run_record(record)

            with self._lock:
                record = self.storage.get_run_record(run_id)
                record.status.pass_fail = result.pass_fail
                record.summary = result.summary
                record.summary.audit_fingerprint_sha256 = audit_fingerprint
                record.assertion_results = result.assertion_results
                record.watchdog_summary = result.watchdog_summary

                payload = build_report_payload(record, result.summary, result.assertion_results)
                report_json_path = self.storage.save_run_report(run_id, payload)
                pdf_path = self.storage.run_dir(run_id) / "report.pdf"
                write_pdf_report(pdf_path, payload)

                record.status.artifacts = [
                    str(telemetry_path),
                    str(report_json_path),
                    str(pdf_path),
                ]
                record.status.state = RunState.completed
                record.status.progress = 100
                record.status.end_ts = datetime.now(timezone.utc)
                self.storage.save_run_record(record)
                RUNS_TOTAL.labels(state="completed", realtime_mode=record.request.realtime_mode).inc()
                TICK_DRIFT_P99.set(result.summary.tick_drift_p99_ms)
                if result.watchdog_summary.watchdog_misses > 0:
                    WATCHDOG_MISSES.inc(result.watchdog_summary.watchdog_misses)
                if result.watchdog_summary.watchdog_fail_safe:
                    _log_event(
                        "watchdog_fail_safe",
                        run_id=run_id,
                        reason=result.watchdog_summary.fail_reason,
                        misses=result.watchdog_summary.watchdog_misses,
                    )
                elif result.watchdog_summary.watchdog_misses > 0:
                    _log_event(
                        "watchdog_miss",
                        run_id=run_id,
                        misses=result.watchdog_summary.watchdog_misses,
                    )
                elif result.watchdog_summary.watchdog_config_loaded:
                    _log_event(
                        "watchdog_tick_ok",
                        run_id=run_id,
                        ticks_ok=result.watchdog_summary.watchdog_ticks_ok,
                        misses=result.watchdog_summary.watchdog_misses,
                    )
                _log_event(
                    "run_completed",
                    run_id=run_id,
                    state=record.status.state.value,
                    pass_fail=record.status.pass_fail,
                    progress=record.status.progress,
                )

        except Exception as exc:
            RUNS_TOTAL.labels(state="failed", realtime_mode=record.request.realtime_mode).inc()
            with self._lock:
                failed = self.storage.get_run_record(run_id)
                failed.status.state = RunState.failed
                failed.status.progress = 100
                failed.status.error = str(exc)
                if "watchdog_timeout" in str(exc):
                    failed.watchdog_summary = SafetySummary(
                        watchdog_config_loaded=True,
                        watchdog_misses=1,
                        watchdog_fail_safe=True,
                        fail_reason=str(exc),
                    )
                    _log_event(
                        "watchdog_fail_safe",
                        run_id=run_id,
                        state=RunState.failed.value,
                        reason=str(exc),
                    )
                failed.status.end_ts = datetime.now(timezone.utc)
                self.storage.save_run_record(failed)
                _log_event(
                    "run_failed",
                    run_id=run_id,
                    state=failed.status.state.value,
                    error=failed.status.error,
                    progress=failed.status.progress,
                )
            raise
        finally:
            if influx:
                influx.close()

    def get_run_status(self, run_id: str) -> RunStatus:
        return self.storage.get_run_record(run_id).status

    def get_run_record(self, run_id: str) -> RunRecord:
        return self.storage.get_run_record(run_id)

    def list_runs(self) -> list[RunStatus]:
        return [record.status for record in self.storage.list_runs()]

    def get_run_telemetry_path(self, run_id: str) -> Path:
        path = self.storage.telemetry_path(run_id)
        if not path.exists():
            raise StorageError(f"Telemetry for run '{run_id}' not found")
        return path

    def get_run_safety(self, run_id: str) -> SafetyResponse:
        record = self.storage.get_run_record(run_id)
        summary = record.summary
        recomputed = ""
        fingerprint = ""
        tick_avg = 0.0
        tick_max = 0.0
        tick_p99 = 0.0
        if summary is not None:
            tick_avg = summary.tick_drift_avg_ms
            tick_max = summary.tick_drift_max_ms
            tick_p99 = summary.tick_drift_p99_ms
            fingerprint = summary.audit_fingerprint_sha256
            telemetry_path = self.get_run_telemetry_path(run_id)
            if telemetry_path.exists():
                recomputed = self.recompute_audit_fingerprint(run_id)

        return SafetyResponse(
            run_id=run_id,
            state=record.status.state,
            watchdog_summary=record.watchdog_summary,
            tick={
                "avg_drift_ms": tick_avg,
                "max_drift_ms": tick_max,
                "p99_drift_ms": tick_p99,
            },
            audit={
                "fingerprint_sha256": fingerprint,
                "fingerprint_match": bool(fingerprint) and fingerprint == recomputed,
                "backend_git_commit": record.build_meta.get("backend_git_commit", ""),
                "firmware_versions": record.hardware_meta.get("firmware_versions", {}),
            },
        )
