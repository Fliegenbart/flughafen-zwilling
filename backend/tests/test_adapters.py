from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.adapters import (
    AdapterError,
    FaultWatchdogSimulatedAdapter,
    _coerce_numeric,
    _coerce_payload,
    _parse_endpoint,
    _register_spec,
)
from app.models import AdapterConfig


def test_parse_endpoint_variants() -> None:
    host, port, normalized = _parse_endpoint("sim://lab-host:1502", "tcp", 502)
    assert host == "lab-host"
    assert port == 1502
    assert normalized == "sim://lab-host:1502"

    host, port, normalized = _parse_endpoint("example.local:1600", "tcp", 502)
    assert host == "example.local"
    assert port == 1600
    assert normalized == "tcp://example.local:1600"

    host, port, normalized = _parse_endpoint("192.168.1.1", "tcp", 502)
    assert host == "192.168.1.1"
    assert port == 502
    assert normalized == "tcp://192.168.1.1:502"


def test_register_spec_parsing() -> None:
    address, scale = _register_spec("40001")
    assert address == 0
    assert scale == 1.0

    address, scale = _register_spec("40005@10.5")
    assert address == 4
    assert scale == pytest.approx(10.5)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, 1.0),
        (False, 0.0),
        ("1", 1.0),
        ("0", 0.0),
        ("true", 1.0),
        ("off", 0.0),
        (10.5, 10.5),
    ],
)
def test_coerce_numeric_supported_values(value: object, expected: float) -> None:
    assert _coerce_numeric(value) == expected


@pytest.mark.parametrize("value", [None, "NaN"])
def test_coerce_numeric_invalid_values_raise_value_error(value: object) -> None:
    with pytest.raises(ValueError):
        _coerce_numeric(value)


def test_coerce_payload_boolean_serialization() -> None:
    assert _coerce_payload(True) == "1"
    assert _coerce_payload(False) == "0"


def test_fault_watchdog_simulated_adapter_raises_after_after_successes_threshold() -> None:
    cfg = AdapterConfig(
        name="modbus",
        enabled=True,
        endpoint="sim://fault-watchdog?after_successes=2&mode=always",
        watchdog_enabled=True,
        watchdog_signal="40100@1",
    )
    adapter = FaultWatchdogSimulatedAdapter(
        config=cfg,
        protocol="modbus",
        after_successes=2,
        mode="always",
    )

    adapter.connect()
    adapter.watchdog_write(100)
    adapter.watchdog_write(200)

    with pytest.raises(AdapterError, match=r"injected_watchdog_failure:modbus:3"):
        adapter.watchdog_write(300)
