"""SIL must finish its telemetry sink before closing the run's output file."""
from threading import get_ident
from time import sleep
from types import SimpleNamespace

import pytest

from app.deterministic import run_simulation
from app.models import ModelPack, ScenarioDefinition


@pytest.mark.parametrize("domain", ["airport_turnaround_v1", "ems_legacy_v1"])
def test_sil_slow_sink_completes_in_order_without_shutdown_deadline(domain):
    scenario = ScenarioDefinition(id="slow-sink", version="1.0.0", domain=domain,
                                  duration_ms=80, tick_ms=40)
    model = ModelPack(id="slow-sink-model", site_profile="demo", assets=[], parameter_set={})
    expected, received, threads = [], [], []
    reference = run_simulation("same-run", scenario, model, 42, "sil", [], [], expected.append)

    def slow_sink(sample):
        if not received:
            sleep(2.1)
        received.append(sample)
        threads.append(get_ident())

    actual = run_simulation("same-run", scenario, model, 42, "sil", [], [], slow_sink)
    assert received == expected
    assert actual.summary.telemetry_hash == reference.summary.telemetry_hash
    assert set(threads) == {get_ident()}


@pytest.mark.parametrize("domain", ["airport_turnaround_v1", "ems_legacy_v1"])
def test_hil_keeps_telemetry_off_tick_thread(domain):
    scenario = ScenarioDefinition(id="hil-sink", version="1.0.0", domain=domain,
                                  duration_ms=80, tick_ms=40)
    model = ModelPack(id="hil-sink-model", site_profile="demo", assets=[], parameter_set={})
    threads = []
    run_simulation("hil-run", scenario, model, 42, "hil_realtime", [], [],
                   lambda sample: threads.append(get_ident()))
    assert threads and get_ident() not in threads


@pytest.mark.parametrize("domain", ["airport_turnaround_v1", "ems_legacy_v1"])
def test_sil_tick_drift_excludes_sink_time(domain, monkeypatch):
    from app.simulators import airport_turnaround, legacy_ems

    module = airport_turnaround if domain == "airport_turnaround_v1" else legacy_ems
    clock = [0.0]
    monkeypatch.setattr(module, "time", SimpleNamespace(
        perf_counter=lambda: clock[0], sleep=lambda seconds: None))
    scenario = ScenarioDefinition(id="timed-sink", version="1.0.0", domain=domain,
                                  duration_ms=80, tick_ms=40)
    model = ModelPack(id="timed-sink-model", site_profile="demo", assets=[], parameter_set={})
    reference = run_simulation("fixed", scenario, model, 42, "sil", [], [])

    def sink(sample):
        clock[0] += 1

    actual = run_simulation("fixed", scenario, model, 42, "sil", [], [], sink)
    for key in ("tick_drift_avg_ms", "tick_drift_max_ms", "tick_drift_p99_ms"):
        assert getattr(actual.summary, key) == getattr(reference.summary, key)


def test_optional_influx_sink_has_explicit_request_timeout(monkeypatch):
    from app import observability

    options = {}

    class Client:
        def __init__(self, **kwargs):
            options.update(kwargs)

        def write_api(self, **kwargs):
            return None

    monkeypatch.setattr(observability, "InfluxDBClient", Client)
    observability.InfluxTelemetryWriter("http://unused.invalid", "", "qa", "qa")
    assert options["timeout"] == 10_000
