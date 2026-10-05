"""Qualitaets-Gates der Pilotbewertung: schlechte Daten fuehren nie zu PASS."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.pilot import router as pilot_router
from test_pilot_evidence import app_client, import_csv, persisted_coupled_run, project

ORIGIN = datetime(2026, 10, 4, tzinfo=timezone.utc)
RUN_ID = "44444444444444448444444444444444"


def _ts(minute: int) -> str:
    return (ORIGIN + timedelta(minutes=minute)).isoformat().replace("+00:00", "Z")


def _series(minutes: range, measured=lambda m: 100.5, model=lambda m: 100.0 + m % 3) -> tuple[str, list]:
    text = "timestamp,measured_kw\n" + "".join(f"{_ts(m)},{measured(m)}\n" for m in minutes)
    return text, [{"minute": m, "grid_import_kw": model(m)} for m in minutes]


@pytest.fixture
def safe_run(monkeypatch):
    monkeypatch.setattr(
        pilot_router,
        "_run_safety_audit",
        lambda _s, _r: {k: True for k in (
            "fingerprint_match", "artifact_hashes_match", "report_consistent_match", "reports_hashed",
        )},
    )


def _tolerances(client, pid, **body):
    payload = {"mae_max_kw": 5, "energy_error_max_pct": 10, **body}
    return client.put(f"/api/v1/pilot/projects/{pid}/tolerances", json=payload)


def _replay_assessment(client, pid, tmp_path, role="holdout", minutes=range(1, 62), **kw):
    text, series = _series(minutes, **kw)
    persisted_coupled_run(tmp_path, RUN_ID, series)
    source = import_csv(client, pid, role, text, sample_semantics="interval_end_mean")
    assert source.status_code == 201, source.text
    replay = client.post(
        f"/api/v1/pilot/projects/{pid}/replays",
        json={"import_id": source.json()["id"], "run_id": RUN_ID, "metric": "grid_import_kw"},
    )
    assert replay.status_code == 201, replay.text
    response = client.post(
        f"/api/v1/pilot/projects/{pid}/assessments", json={"import_id": replay.json()["id"]}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_holdout_with_frozen_tolerances_can_pass(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        assert _tolerances(client, pid, lock=True).json()["locked"] is True
        result = _replay_assessment(client, pid, tmp_path)
        assert result["validity_status"] == "PASS", result
        assert result["evaluation_kind"] == "holdout_validation"
        assert result["thresholds"]["tolerances_sha256"]
        audit = client.get(f"/api/v1/pilot/projects/{pid}/audit").json()
        assert audit[1]["action"] == "tolerances_set"
        assert audit[1]["details"]["sha256"] == result["thresholds"]["tolerances_sha256"]


def test_tolerances_freeze_on_first_holdout_and_are_immutable(tmp_path):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        assert _tolerances(client, pid).json()["locked"] is False
        assert _tolerances(client, pid, mae_max_kw=4).status_code == 200
        text, _ = _series(range(1, 62))
        import_csv(client, pid, "holdout", text)
        assert client.get(f"/api/v1/pilot/projects/{pid}/tolerances").json()["locked"] is True
        assert _tolerances(client, pid, mae_max_kw=50).status_code == 409


def test_tolerance_ceilings_and_request_mismatch(tmp_path):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        assert _tolerances(client, pid, energy_error_max_pct=51).status_code == 422
        assert _tolerances(client, pid, min_rows=10).status_code == 422
        assert _tolerances(client, pid, min_coverage_seconds=60).status_code == 422
        _tolerances(client, pid, lock=True)
        text, _ = _series(range(1, 62))
        imported = import_csv(client, pid, "holdout", text).json()
        mismatch = client.post(
            f"/api/v1/pilot/projects/{pid}/assessments",
            json={"import_id": imported["id"], "mae_max_kw": 1000, "energy_error_max_pct": 10},
        )
        assert mismatch.status_code == 409


def test_missing_tolerances_not_evaluable(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        result = _replay_assessment(client, pid, tmp_path)
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert "tolerances_not_frozen" in result["not_evaluable_reasons"]


def test_tolerances_set_after_holdout_import_not_evaluable(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        text, series = _series(range(1, 62))
        persisted_coupled_run(tmp_path, RUN_ID, series)
        source = import_csv(client, pid, "holdout", text, sample_semantics="interval_end_mean").json()
        _tolerances(client, pid)
        replay = client.post(
            f"/api/v1/pilot/projects/{pid}/replays",
            json={"import_id": source["id"], "run_id": RUN_ID, "metric": "grid_import_kw"},
        ).json()
        result = client.post(
            f"/api/v1/pilot/projects/{pid}/assessments", json={"import_id": replay["id"]}
        ).json()
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert "tolerances_set_after_import" in result["not_evaluable_reasons"]


@pytest.mark.parametrize("role,kind", [("calibration", "calibration_fit"), ("lab", "lab_diagnostic")])
def test_non_holdout_roles_never_pass(tmp_path, safe_run, role, kind):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        _tolerances(client, pid, lock=True)
        result = _replay_assessment(client, pid, tmp_path, role=role)
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert result["evaluation_kind"] == kind
        assert "role_not_holdout" in result["not_evaluable_reasons"]


def test_overlap_rechecked_against_invalid_calibration(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        _tolerances(client, pid, lock=True)
        # Kalibrierimport mit Luecke (ungueltig) im selben Zeitraum wie der Holdout.
        bad = "timestamp,measured_kw\n" + "".join(
            f"{_ts(m)},100\n" for m in (10, 11, 30, 31)
        )
        assert import_csv(client, pid, "calibration", bad).status_code == 422
        result = _replay_assessment(client, pid, tmp_path)
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert "calibration_holdout_overlap" in result["not_evaluable_reasons"]


def test_insufficient_rows_and_coverage(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        _tolerances(client, pid, lock=True)
        result = _replay_assessment(client, pid, tmp_path, minutes=range(1, 31))
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert {"insufficient_rows", "insufficient_coverage"} <= set(result["not_evaluable_reasons"])


def test_circular_series_not_evaluable(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        _tolerances(client, pid, lock=True)
        result = _replay_assessment(
            client, pid, tmp_path, measured=lambda m: 100.0 + m % 3, model=lambda m: 100.0 + m % 3
        )
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert "circular" in result["not_evaluable_reasons"]


def test_mae_tolerance_too_loose_relative_to_measurement(tmp_path, safe_run):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        _tolerances(client, pid, mae_max_kw=80, lock=True)
        result = _replay_assessment(client, pid, tmp_path)
        assert result["validity_status"] == "NOT_EVALUABLE"
        assert "tolerance_mae_too_loose_for_measurement" in result["not_evaluable_reasons"]


@pytest.mark.parametrize("measured,model", [("120000", "120"), ("5e6", ""), ("1e308", "1")])
def test_unit_suspect_and_overflow_values_are_invalid(tmp_path, measured, model):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        rows = "".join(f"{_ts(m)},{measured},{model}\n" for m in range(1, 4))
        response = import_csv(client, pid, "lab", "timestamp,measured_kw,model_kw\n" + rows)
        assert response.status_code == 422
        assert "unit_suspect" in response.json()["quality"]["issues"]


def test_utf8_bom_is_stripped_not_rejected(tmp_path):
    with app_client(tmp_path) as client:
        pid = project(client)["id"]
        text, _ = _series(range(1, 4))
        response = import_csv(client, pid, "lab", "﻿" + text)
        assert response.status_code == 201, response.text
        assert response.json()["quality"]["state"] == "valid"
