from __future__ import annotations

import hashlib
import math
import random
import time
from collections import defaultdict
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import Callable

from ..adapters import AdapterPlugin
from ..models import (
    Disturbance,
    ModelPack,
    RunSummary,
    SafetySummary,
    ScenarioDefinition,
    TelemetrySample,
)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * _clamp(t, 0.0, 1.0)


def _compare(observed: float, op: str, threshold: float) -> bool:
    if op == "<":
        return observed < threshold
    if op == "<=":
        return observed <= threshold
    if op == ">":
        return observed > threshold
    if op == ">=":
        return observed >= threshold
    if op == "==":
        return observed == threshold
    if op == "!=":
        return observed != threshold
    return False


def _compute_disturbance_effects(disturbances: list[Disturbance], ts_ms: int) -> dict[str, float | bool]:
    effects: dict[str, float | bool] = {
        "grid_outage": False,
        "load_step_kw": 0.0,
        "frequency_noise": 0.0,
        "diesel_derate_pct": 0.0,
        "voltage_sag_pct": 0.0,
    }
    for disturbance in disturbances:
        if disturbance.start_ms <= ts_ms < disturbance.start_ms + disturbance.duration_ms:
            if disturbance.target == "grid_outage":
                effects["grid_outage"] = True
            elif disturbance.target == "load_step_kw":
                effects["load_step_kw"] = float(effects["load_step_kw"]) + disturbance.magnitude
            elif disturbance.target == "frequency_noise":
                effects["frequency_noise"] = float(effects["frequency_noise"]) + abs(disturbance.magnitude)
            elif disturbance.target == "diesel_derate_pct":
                effects["diesel_derate_pct"] = float(effects["diesel_derate_pct"]) + max(0.0, disturbance.magnitude)
            elif disturbance.target == "voltage_sag_pct":
                effects["voltage_sag_pct"] = float(effects["voltage_sag_pct"]) + max(0.0, disturbance.magnitude)
    return effects


def _apply_event(state: dict[str, float | int | bool | str], target: str, action: str, value: float | int | str | bool | None) -> None:
    if target not in state and action != "set":
        return

    if action == "toggle":
        current = bool(state.get(target, False))
        state[target] = not current
        return

    if action == "inject":
        current = state.get(target, 0.0)
        if isinstance(current, (int, float)) and isinstance(value, (int, float)):
            state[target] = float(current) + float(value)
        return

    if action == "set":
        if target == "inv_mode" and isinstance(value, str):
            state[target] = value
            return
        if isinstance(value, bool):
            state[target] = value
            return
        if isinstance(value, (int, float, str)):
            state[target] = value


def run_legacy_ems_simulation(
    run_id: str,
    scenario: ScenarioDefinition,
    model_pack: ModelPack,
    seed: int,
    realtime_mode: str,
    adapters: list[AdapterPlugin],
    telemetry_callback: Callable[[TelemetrySample], None] | None = None,
) -> tuple[RunSummary, SafetySummary]:
    params = model_pack.parameter_set
    rng = random.Random(seed)

    state: dict[str, float | int | bool | str] = {
        "nominal_freq_hz": float(params.get("nominal_freq_hz", 50.0)),
        "nominal_voltage_v": float(params.get("nominal_voltage_v", 400.0)),
        "critical_load_kw": float(params.get("critical_load_kw", 120.0)),
        "noncritical_load_kw": float(params.get("noncritical_load_kw", 180.0)),
        "battery_capacity_kwh": float(params.get("battery_capacity_kwh", 500.0)),
        "battery_soc_pct": float(params.get("battery_soc_pct", 85.0)),
        "battery_max_kw": float(params.get("battery_max_kw", 250.0)),
        "diesel_max_kw": float(params.get("diesel_max_kw", 400.0)),
        "diesel_start_delay_ms": float(params.get("diesel_start_delay_ms", 3500.0)),
        "diesel_ramp_time_ms": float(params.get("diesel_ramp_time_ms", 14000.0)),
        "inverter_switch_time_ms": float(params.get("inverter_switch_time_ms", 18.0)),
        "load_shed_delay_ms": float(params.get("load_shed_delay_ms", 150.0)),
        "pv_peak_kw": float(params.get("pv_peak_kw", 100.0)),
        "grid_on": bool(params.get("grid_on", True)),
        "wan_on": bool(params.get("wan_on", True)),
        "ncrit_on": bool(params.get("ncrit_on", True)),
        "inv_mode": str(params.get("inv_mode", "grid_following")),
    }

    freq = float(state["nominal_freq_hz"])
    volt = float(state["nominal_voltage_v"])
    batt_kw = 0.0
    diesel_kw = 0.0
    outage_start_ms: int | None = None
    switch_time_ms = 0
    blackout_ms = 0
    freq_nadir = freq
    volt_nadir = volt
    io_latencies_ms: list[float] = []
    tick_drift_abs_ms: list[float] = []
    tick_drift_signed_ms: list[float] = []
    telemetry_queue: Queue[TelemetrySample] = Queue(maxsize=20_000)
    telemetry_stop = Event()
    backlog_warned = False
    events = scenario.timeline_events
    event_idx = 0
    watchdog_fail_safe = False
    watchdog_fail_reason = ""
    watchdog_ticks_ok = 0
    watchdog_misses = 0
    watchdog_last_heartbeat_ts_ms = 0
    watchdog_last_tick_by_adapter = defaultdict(int)
    watchdog_last_ok_by_adapter = defaultdict(int)
    digest = hashlib.sha256()
    telemetry_errors: list[Exception] = []

    def _telemetry_worker() -> None:
        while not telemetry_stop.is_set() or not telemetry_queue.empty():
            try:
                sample = telemetry_queue.get(timeout=0.05)
            except Empty:
                continue
            try:
                digest.update(
                    f"{sample.ts}|{sample.asset_id}|{sample.metric}|{sample.value}|{sample.unit}|{sample.quality}\n".encode(
                        "utf-8"
                    )
                )
                if telemetry_callback and not telemetry_errors:
                    telemetry_callback(sample)
            except Exception as exc:
                telemetry_errors.append(exc)
            finally:
                telemetry_queue.task_done()

    worker = Thread(target=_telemetry_worker, daemon=True)
    worker.start()

    try:
        for adapter in adapters:
            adapter.connect()
            adapter.clock_sync()

        for ts in range(0, scenario.duration_ms + scenario.tick_ms, scenario.tick_ms):
            if telemetry_errors:
                raise RuntimeError("telemetry_callback_failed") from telemetry_errors[0]
            tick_start = time.perf_counter()
            while event_idx < len(events) and events[event_idx].at_ms <= ts:
                event = events[event_idx]
                _apply_event(state, event.target, event.action, event.value)
                event_idx += 1

            effects = _compute_disturbance_effects(scenario.disturbances, ts)
            if effects["grid_outage"]:
                state["grid_on"] = False

            grid_on = bool(state["grid_on"])
            nominal_freq = float(state["nominal_freq_hz"])
            nominal_volt = float(state["nominal_voltage_v"])
            critical_kw = float(state["critical_load_kw"])
            noncritical_kw = float(state["noncritical_load_kw"]) if bool(state["ncrit_on"]) else 0.0
            load_step_kw = float(effects["load_step_kw"])

            demand_kw = max(0.0, critical_kw + noncritical_kw + load_step_kw + rng.gauss(0, 0.3))

            sim_hour = (10.0 + ts / 3_600_000) % 24
            pv_shape = max(0.0, 1.0 - abs(sim_hour - 12.0) / 6.0)
            pv_kw = float(state["pv_peak_kw"]) * pv_shape if (grid_on or state["inv_mode"] == "grid_forming") else 0.0

            if not grid_on and outage_start_ms is None:
                outage_start_ms = ts

            if grid_on:
                outage_start_ms = None
                batt_kw = _lerp(batt_kw, -15.0, 0.2)
                freq = _lerp(freq, nominal_freq, 0.25) + rng.gauss(0, 0.01)
                volt = _lerp(volt, nominal_volt, 0.25) + rng.gauss(0, 0.2)
                diesel_kw = _lerp(diesel_kw, 0.0, 0.15)
                state["inv_mode"] = "grid_following"
                state["ncrit_on"] = True
            else:
                elapsed_outage = ts - outage_start_ms if outage_start_ms is not None else 0
                if state["inv_mode"] != "grid_forming" and elapsed_outage >= float(state["inverter_switch_time_ms"]):
                    state["inv_mode"] = "grid_forming"
                    if switch_time_ms == 0:
                        switch_time_ms = elapsed_outage

                if bool(state["ncrit_on"]) and elapsed_outage >= float(state["load_shed_delay_ms"]):
                    state["ncrit_on"] = False
                    noncritical_kw = 0.0
                    demand_kw = max(0.0, critical_kw + load_step_kw + rng.gauss(0, 0.2))

                supply_kw = pv_kw

                if state["inv_mode"] == "grid_forming":
                    batt_limit = float(state["battery_max_kw"])
                    batt_kw = min(batt_limit, max(0.0, demand_kw - supply_kw) * 0.8)
                    supply_kw += batt_kw
                    dt_hours = scenario.tick_ms / 3_600_000
                    soc_drop = (batt_kw * dt_hours) / max(1e-6, float(state["battery_capacity_kwh"])) * 100
                    state["battery_soc_pct"] = _clamp(float(state["battery_soc_pct"]) - soc_drop, 0.0, 100.0)
                else:
                    batt_kw = _lerp(batt_kw, 0.0, 0.2)

                if elapsed_outage >= float(state["diesel_start_delay_ms"]):
                    ramp_window = max(1.0, float(state["diesel_ramp_time_ms"]))
                    ramp = min(1.0, (elapsed_outage - float(state["diesel_start_delay_ms"])) / ramp_window)
                    derate = _clamp(float(effects["diesel_derate_pct"]) / 100.0, 0.0, 0.95)
                    diesel_kw = float(state["diesel_max_kw"]) * ramp * (1.0 - derate)
                else:
                    diesel_kw = 0.0

                supply_kw += diesel_kw
                net_kw = supply_kw - demand_kw
                noise = 0.02 + float(effects["frequency_noise"]) * 0.03
                freq = _lerp(freq + (net_kw / max(1.0, demand_kw)) * 0.4 + rng.gauss(0, noise), nominal_freq, 0.03)

                voltage_sag = float(effects["voltage_sag_pct"]) / 100.0
                volt_target = nominal_volt * (1.0 - voltage_sag + (net_kw / max(1.0, demand_kw)) * 0.06)
                volt = _lerp(volt, volt_target, 0.12) + rng.gauss(0, 0.8)

                if freq < 45.0 or volt < 340.0:
                    blackout_ms += scenario.tick_ms

            freq = _clamp(freq, 0.0, 55.0)
            volt = _clamp(volt, 0.0, 460.0)
            freq_nadir = min(freq_nadir, freq)
            volt_nadir = min(volt_nadir, volt)

            base_latency = 8.0 if realtime_mode == "sil" else 12.0
            latency = max(0.5, abs(rng.gauss(base_latency + len(adapters) * 0.4, 1.5)))
            io_latencies_ms.append(latency)

            for adapter in adapters:
                adapter.write(
                    {
                        "frequency_hz": round(freq, 4),
                        "voltage_v": round(volt, 3),
                        "load_kw": round(demand_kw, 3),
                        "battery_soc_pct": round(float(state["battery_soc_pct"]), 3),
                    }
                )
                # Force read/write cycle in HIL mode to validate adapter roundtrip behavior.
                adapter.read()
                if adapter.config.watchdog_enabled:
                    interval_ms = adapter.config.watchdog_interval_ms
                    timeout_ms = adapter.config.watchdog_timeout_ms
                    if ts - watchdog_last_tick_by_adapter[id(adapter)] >= interval_ms:
                        watchdog_last_tick_by_adapter[id(adapter)] = ts
                        try:
                            adapter.watchdog_write(ts)
                            adapter.watchdog_health()
                            watchdog_ticks_ok += 1
                            watchdog_last_heartbeat_ts_ms = ts
                            watchdog_last_ok_by_adapter[id(adapter)] = ts
                        except Exception as exc:
                            watchdog_misses += 1
                            if ts - watchdog_last_ok_by_adapter[id(adapter)] > timeout_ms:
                                watchdog_fail_safe = True
                                watchdog_fail_reason = f"watchdog_timeout:{adapter.config.name}:{exc}"
                                raise RuntimeError(watchdog_fail_reason) from exc

            samples = [
                TelemetrySample(ts=ts, source="twin_core", asset_id="microgrid", metric="frequency_hz", value=round(freq, 6), unit="Hz", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="microgrid", metric="voltage_v", value=round(volt, 6), unit="V", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="load", metric="load_kw", value=round(demand_kw, 6), unit="kW", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="battery", metric="battery_soc_pct", value=round(float(state["battery_soc_pct"]), 6), unit="%", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="battery", metric="battery_power_kw", value=round(batt_kw, 6), unit="kW", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="diesel", metric="diesel_power_kw", value=round(diesel_kw, 6), unit="kW", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="grid", metric="grid_on", value=int(bool(state["grid_on"])), unit="bool", run_id=run_id),
                TelemetrySample(ts=ts, source="twin_core", asset_id="io", metric="io_latency_ms", value=round(latency, 6), unit="ms", run_id=run_id),
            ]
            for sample in samples:
                try:
                    telemetry_queue.put(sample, timeout=0.05)
                except Full as exc:
                    if not backlog_warned:
                        backlog_warned = True
                    raise RuntimeError("telemetry_queue_backpressure") from exc

            if realtime_mode == "hil_realtime":
                elapsed_sec = time.perf_counter() - tick_start
                target_sec = scenario.tick_ms / 1000.0
                if elapsed_sec < target_sec:
                    time.sleep(target_sec - elapsed_sec)

            tick_duration_ms = (time.perf_counter() - tick_start) * 1000.0
            drift = tick_duration_ms - scenario.tick_ms
            tick_drift_signed_ms.append(drift)
            tick_drift_abs_ms.append(abs(drift))

    finally:
        for adapter in adapters:
            try:
                adapter.shutdown()
            except Exception:
                pass
        telemetry_stop.set()
        worker.join(timeout=2.0)
        if worker.is_alive():
            raise RuntimeError("telemetry_shutdown_timeout")
        if telemetry_errors:
            raise RuntimeError("telemetry_callback_failed") from telemetry_errors[0]

    sorted_lat = sorted(io_latencies_ms)
    p99_index = max(0, min(len(sorted_lat) - 1, math.ceil(0.99 * len(sorted_lat)) - 1))
    io_p99 = sorted_lat[p99_index] if sorted_lat else 0.0
    sorted_drift_abs = sorted(tick_drift_abs_ms)
    drift_p99_index = max(0, min(len(sorted_drift_abs) - 1, math.ceil(0.99 * len(sorted_drift_abs)) - 1))
    drift_p99 = sorted_drift_abs[drift_p99_index] if sorted_drift_abs else 0.0
    drift_avg = sum(tick_drift_abs_ms) / len(tick_drift_abs_ms) if tick_drift_abs_ms else 0.0
    drift_max = max(tick_drift_abs_ms) if tick_drift_abs_ms else 0.0

    telemetry_hash = digest.hexdigest()

    summary = RunSummary(
        freq_nadir_hz=round(freq_nadir, 6),
        volt_nadir_v=round(volt_nadir, 6),
        blackout_ms=int(blackout_ms),
        switch_time_ms=int(switch_time_ms),
        final_soc_pct=round(float(state["battery_soc_pct"]), 6),
        io_latency_p99_ms=round(io_p99, 6),
        telemetry_hash=telemetry_hash,
        domain="ems_legacy_v1",
        tick_target_ms=scenario.tick_ms,
        tick_drift_avg_ms=round(drift_avg, 6),
        tick_drift_max_ms=round(drift_max, 6),
        tick_drift_p99_ms=round(drift_p99, 6),
    )

    watchdog_summary = SafetySummary(
        watchdog_config_loaded=any(a.config.watchdog_enabled for a in adapters),
        watchdog_ticks_ok=watchdog_ticks_ok,
        watchdog_misses=watchdog_misses,
        watchdog_fail_safe=watchdog_fail_safe,
        fail_reason=watchdog_fail_reason,
        last_heartbeat_ts_ms=watchdog_last_heartbeat_ts_ms,
    )
    return summary, watchdog_summary
