from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.models import (
    AirportKpiSummary,
    PlaybookOption,
    PlaybookRecord,
    PlaybookRequest,
    PlaybookStatus,
    PlaybookJobState,
    RunRecord,
    RunRequest,
    RunStatus,
    RunState,
    RunSummary,
)
from app.storage import FileStorage


def _sample_run_record() -> RunRecord:
    return RunRecord(
        status=RunStatus(
            run_id="run-storage-race",
            state=RunState.completed,
            progress=100.0,
            pass_fail=True,
            scenario_id="airport_case_02_guillotine_v1",
            model_pack_id="airport_medium_eu_v1",
            seed=42,
            realtime_mode="sil",
            artifacts=[],
        ),
        request=RunRequest(
            scenario_id="airport_case_02_guillotine_v1",
            model_pack_id="airport_medium_eu_v1",
            seed=42,
            realtime_mode="sil",
        ),
        summary=RunSummary(
            freq_nadir_hz=49.9,
            volt_nadir_v=398.0,
            blackout_ms=0,
            switch_time_ms=45000,
            final_soc_pct=99.0,
            io_latency_p99_ms=8.0,
            telemetry_hash="abc",
            domain="airport_turnaround_v1",
            airport_kpis=AirportKpiSummary(
                otp_rate_pct=88.0,
                avg_turnaround_min=50.0,
                gate_utilization_avg_pct=83.0,
                delay_avg_min=5.0,
            ),
            audit_fingerprint_sha256="def",
        ),
    )


def _sample_playbook_record() -> PlaybookRecord:
    option = PlaybookOption(
        option_id="baseline",
        feasible=True,
        intervention_cost=0.0,
        estimated_airport_kpis=AirportKpiSummary(
            otp_rate_pct=88.0,
            avg_turnaround_min=50.0,
            gate_utilization_avg_pct=83.0,
            delay_avg_min=5.0,
        ),
    )
    return PlaybookRecord(
        status=PlaybookStatus(
            job_id="playbook-storage-race",
            state=PlaybookJobState.completed,
            progress=100.0,
        ),
        request=PlaybookRequest(
            scenario_id="airport_case_02_guillotine_v1",
            model_pack_id="airport_medium_eu_v1",
            seed=42,
        ),
        baseline_option=option,
        best_option=option,
        pareto_options=[],
        candidates_evaluated=1,
        frontier_size=1,
        artifacts=[],
    )


def test_get_run_record_retries_after_transient_json_decode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    storage = FileStorage(tmp_path)
    record = _sample_run_record()
    run_path = storage.save_run_record(record)

    original_read_text = Path.read_text
    state = {"calls": 0}

    def flaky_read_text(self: Path, *args, **kwargs):  # type: ignore[no-untyped-def]
        if self == run_path and state["calls"] == 0:
            state["calls"] += 1
            return '{"status": {"run_id": "broken"}'
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", flaky_read_text)

    loaded = storage.get_run_record(record.status.run_id)

    assert loaded.status.run_id == record.status.run_id
    assert state["calls"] == 1


def test_get_playbook_record_retries_after_transient_json_decode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    storage = FileStorage(tmp_path)
    record = _sample_playbook_record()
    record_path = storage.save_playbook_record(record)

    original_read_text = Path.read_text
    state = {"calls": 0}

    def flaky_read_text(self: Path, *args, **kwargs):  # type: ignore[no-untyped-def]
        if self == record_path and state["calls"] == 0:
            state["calls"] += 1
            return '{"status": {"job_id": "broken"}'
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", flaky_read_text)

    loaded = storage.get_playbook_record(record.status.job_id)

    assert loaded.status.job_id == record.status.job_id
    assert state["calls"] == 1
