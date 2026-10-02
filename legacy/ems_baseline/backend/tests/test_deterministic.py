from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.deterministic import (
    _apply_event,
    _clamp,
    _compare,
    _compute_disturbance_effects,
    _lerp,
)
from app.models import Disturbance


def test_clamp_normal_bounds_and_boundaries() -> None:
    assert _clamp(5.0, 0.0, 10.0) == 5.0
    assert _clamp(0.0, 0.0, 10.0) == 0.0
    assert _clamp(10.0, 0.0, 10.0) == 10.0
    assert _clamp(-1.0, 0.0, 10.0) == 0.0
    assert _clamp(11.0, 0.0, 10.0) == 10.0


def test_clamp_inverted_bounds_behavior() -> None:
    # Current implementation behavior with inverted bounds is deterministic:
    # max(lo, min(hi, value)) -> lo when lo > hi.
    assert _clamp(5.0, 10.0, 0.0) == 10.0
    assert _clamp(-5.0, 10.0, 0.0) == 10.0


def test_lerp_with_core_and_out_of_bounds_t_values() -> None:
    assert _lerp(10.0, 20.0, 0.0) == 10.0
    assert _lerp(10.0, 20.0, 1.0) == 20.0
    assert _lerp(10.0, 20.0, 0.5) == 15.0
    assert _lerp(10.0, 20.0, 1.5) == 20.0
    assert _lerp(10.0, 20.0, -0.5) == 10.0


@pytest.mark.parametrize(
    ("observed", "op", "threshold", "expected"),
    [
        (1.0, "<", 2.0, True),
        (2.0, "<", 2.0, False),
        (2.0, "<=", 2.0, True),
        (3.0, "<=", 2.0, False),
        (3.0, ">", 2.0, True),
        (2.0, ">", 2.0, False),
        (3.0, ">=", 3.0, True),
        (2.0, ">=", 3.0, False),
        (4.0, "==", 4.0, True),
        (4.0, "==", 5.0, False),
        (4.0, "!=", 5.0, True),
        (4.0, "!=", 4.0, False),
    ],
)
def test_compare_all_supported_operators(observed: float, op: str, threshold: float, expected: bool) -> None:
    assert _compare(observed, op, threshold) is expected


def test_compute_disturbance_effects_overlap_sums_load_steps() -> None:
    disturbances = [
        Disturbance(
            name="load-step-a",
            target="load_step_kw",
            start_ms=100,
            duration_ms=200,
            magnitude=30.0,
        ),
        Disturbance(
            name="load-step-b",
            target="load_step_kw",
            start_ms=150,
            duration_ms=200,
            magnitude=40.0,
        ),
        Disturbance(
            name="freq-noise",
            target="frequency_noise",
            start_ms=150,
            duration_ms=50,
            magnitude=-1.2,
        ),
    ]

    # At t=160ms, both load steps overlap and should sum.
    effects = _compute_disturbance_effects(disturbances, ts_ms=160)
    assert effects["load_step_kw"] == 70.0
    # frequency_noise adds abs(magnitude)
    assert effects["frequency_noise"] == pytest.approx(1.2)


def test_apply_event_inject_toggle_set() -> None:
    state: dict[str, float | int | bool | str] = {
        "x": 1,
        "flag": False,
        "inv_mode": "grid_following",
    }

    _apply_event(state, target="x", action="inject", value=0.5)
    assert state["x"] == pytest.approx(1.5)
    assert isinstance(state["x"], float)

    _apply_event(state, target="flag", action="toggle", value=None)
    assert state["flag"] is True

    _apply_event(state, target="x", action="set", value=7)
    assert state["x"] == 7
