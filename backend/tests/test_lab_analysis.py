from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.lab.analysis import analyze, parse_csv
from app.lab.models import Criteria, Sample


def test_energy_uses_seconds_and_observed_intervals():
    trace = [Sample(ts_s=i, power_kw=36, setpoint_kw=36, limit_kw=40) for i in range(101)]
    result = analyze(trace, Criteria())
    assert result.metrics.energy_import_kwh == pytest.approx(1)
    assert result.metrics.limit_violation_s == 0
    assert result.verdict == "pass"


def test_gaps_never_produce_pass_or_fabricated_energy():
    trace = parse_csv("ts_s,power_kw,setpoint_kw,limit_kw\n0,36,36,40\n1,,36,40\n10,36,36,40\n")
    result = analyze(trace, Criteria())
    assert result.verdict == "inconclusive"
    assert result.metrics.energy_import_kwh == 0
    assert result.quality.coverage_pct == 0


@pytest.mark.parametrize(
    "bad",
    [
        "ts_s,power_kw,setpoint_kw,limit_kw\n0,nan,10,20\n1,10,10,20\n",
        "ts_s,power_kw,setpoint_kw,limit_kw\n1,10,10,20\n0,10,10,20\n",
        "ts_s,power_kw,setpoint_kw,limit_kw\n0,10,10,20\n0,10,10,20\n",
        "ts_s,power_kw,limit_kw\n0,10,20\n1,10,20\n",
    ],
)
def test_import_rejects_invalid_contract(bad):
    with pytest.raises(ValueError):
        parse_csv(bad)


def test_power_limit_and_response_are_actual_assertions():
    trace = [
        Sample(ts_s=i, power_kw=30, setpoint_kw=10 if i < 5 else 20, limit_kw=25) for i in range(41)
    ]
    result = analyze(trace, Criteria())
    assert result.verdict == "fail"
    assert result.metrics.limit_violation_s == 40
    assert next(c for c in result.checks if c.id == "response").state == "fail"


def test_signed_power_integrates_import_and_export_separately():
    trace = [
        Sample(ts_s=0, power_kw=-36, setpoint_kw=-36, limit_kw=40),
        Sample(ts_s=100, power_kw=-36, setpoint_kw=-36, limit_kw=40),
    ]
    result = analyze(trace, Criteria(expected_interval_s=100, max_gap_s=100))
    assert result.metrics.energy_export_kwh == pytest.approx(1)
    assert result.metrics.energy_import_kwh == 0


def test_undersampling_does_not_pass_declared_sampling_contract():
    trace = [Sample(ts_s=i, power_kw=20, setpoint_kw=20, limit_kw=40) for i in range(0, 101, 2)]
    result = analyze(trace, Criteria(expected_interval_s=1, max_gap_s=3))
    assert result.verdict == "inconclusive"
    assert result.quality.sampling_coverage_pct < 60


def test_interior_limit_spike_is_integrated_not_ignored():
    trace = [
        Sample(ts_s=i, power_kw=40 if i == 20 else 20, setpoint_kw=20, limit_kw=30)
        for i in range(41)
    ]
    result = analyze(trace, Criteria(limit_violation_budget_s=0))
    assert result.verdict == "fail"
    assert result.metrics.limit_violation_s == pytest.approx(0.8)


def test_one_unsettled_step_does_not_show_another_steps_success_as_response_time():
    trace = [
        Sample(
            ts_s=i,
            power_kw=10 if i < 5 else 20,
            setpoint_kw=10 if i < 5 else 20 if i < 25 else 40,
            limit_kw=80,
        )
        for i in range(61)
    ]
    result = analyze(trace, Criteria())
    assert result.metrics.response_time_s is None
    assert next(c for c in result.checks if c.id == "response").state == "fail"


def test_whitespace_only_csv_is_a_validation_error():
    with pytest.raises(ValueError, match="CSV ist leer"):
        parse_csv("\n \n")


def test_a_case_label_alone_is_not_evidence_that_the_test_profile_occurred():
    trace = [Sample(ts_s=i, power_kw=20, setpoint_kw=20, limit_kw=80) for i in range(61)]
    result = analyze(trace, Criteria(), "setpoint-step")
    assert result.verdict == "inconclusive"
    assert next(check for check in result.checks if check.id == "profile").state == "inconclusive"
