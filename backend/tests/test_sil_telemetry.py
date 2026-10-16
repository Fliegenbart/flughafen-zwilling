"""SIL must finish its telemetry sink before closing the run's output file."""
from threading import get_ident
from time import sleep

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
