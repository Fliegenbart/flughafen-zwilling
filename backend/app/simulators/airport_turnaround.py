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
    AirportKpiSummary,
    Disturbance,
    ModelPack,
    RunSummary,
    SafetySummary,
    ScenarioDefinition,
    TelemetrySample,
)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _compute_disturbance_effects(disturbances: list[Disturbance], ts_ms: int) -> dict[str, float]:
    effects: dict[str, float] = {
        "gate_blockage_pct": 0.0,
        "weather_restriction_pct": 0.0,
        "baggage_jam_pct": 0.0,
        "staffing_shortage_pct": 0.0,
        "security_delay_min": 0.0,
        "deicing_delay_min": 0.0,
        "runway_slot_reduction_pct": 0.0,
    }
    for disturbance in disturbances:
        if disturbance.start_ms <= ts_ms < disturbance.start_ms + disturbance.duration_ms:
            if disturbance.target in effects:
                effects[disturbance.target] += max(0.0, disturbance.magnitude)
    return effects


def _apply_event(state: dict[str, float | int | bool | str], target: str, action: str, value: float | int | str | bool | None) -> None:
    if target not in state and action != "set":
        return

    if action == "toggle":
        state[target] = not bool(state.get(target, False))
        return

    if action == "inject":
        current = state.get(target, 0.0)
        if isinstance(current, (int, float)) and isinstance(value, (int, float)):
            state[target] = float(current) + float(value)
        return

    if action == "set":
        if isinstance(value, (bool, int, float, str)):
            state[target] = value


def run_airport_turnaround_simulation(
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
        "gates_total": float(params.get("gates_total", 28.0)),
        "gates_open_pct": float(params.get("gates_open_pct", 95.0)),
        "arrivals_per_hour": float(params.get("arrivals_per_hour", 24.0)),
        "departures_per_hour": float(params.get("departures_per_hour", 24.0)),
        "base_turnaround_min": float(params.get("base_turnaround_min", 45.0)),
        "ground_crew_teams": float(params.get("ground_crew_teams", 14.0)),
        "crew_capacity_flights_per_hour": float(params.get("crew_capacity_flights_per_hour", 1.8)),
        "baggage_capacity_flights_per_hour": float(params.get("baggage_capacity_flights_per_hour", 26.0)),
        "runway_slots_per_hour": float(params.get("runway_slots_per_hour", 28.0)),
    }

    gate_queue_flights = 0.0
    in_turnaround_flights = 0.0
    departure_queue_flights = 0.0
    baggage_queue_flights = 0.0

    total_departures = 0.0
    delayed_departures = 0.0
    ontime_departures = 0.0

    otp_samples: list[float] = []
    turnaround_samples: list[float] = []
    gate_util_samples: list[float] = []
    crew_util_samples: list[float] = []
    departure_queue_samples: list[float] = []
    baggage_queue_samples: list[float] = []
    delay_samples: list[float] = []

    io_latencies_ms: list[float] = []
    tick_drift_abs_ms: list[float] = []
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
            dt_hours = scenario.tick_ms / 3_600_000.0

            gates_total = max(1.0, float(state["gates_total"]))
            gates_open_pct = _clamp(float(state["gates_open_pct"]), 5.0, 100.0)
            gates_open_pct *= 1.0 - _clamp(effects["gate_blockage_pct"], 0.0, 95.0) / 100.0
            gates_open = max(1.0, gates_total * gates_open_pct / 100.0)

            arrivals_per_hour = max(0.0, float(state["arrivals_per_hour"]))
            departures_per_hour = max(0.0, float(state["departures_per_hour"]))
            base_turnaround_min = max(10.0, float(state["base_turnaround_min"]))
            crew_teams = max(1.0, float(state["ground_crew_teams"]))
            crew_cap = max(0.1, float(state["crew_capacity_flights_per_hour"]))
            baggage_cap = max(0.1, float(state["baggage_capacity_flights_per_hour"]))
            runway_slots = max(0.1, float(state["runway_slots_per_hour"]))

            crew_capacity_per_hour = crew_teams * crew_cap
            crew_capacity_per_hour *= 1.0 - _clamp(effects["staffing_shortage_pct"], 0.0, 95.0) / 100.0

            baggage_capacity_per_hour = baggage_cap
            baggage_capacity_per_hour *= 1.0 - _clamp(effects["baggage_jam_pct"], 0.0, 95.0) / 100.0

            runway_capacity_per_hour = runway_slots
            runway_capacity_per_hour *= 1.0 - _clamp(effects["runway_slot_reduction_pct"], 0.0, 95.0) / 100.0
            runway_capacity_per_hour *= 1.0 - _clamp(effects["weather_restriction_pct"], 0.0, 95.0) / 100.0

            gate_throughput_per_hour = gates_open * (60.0 / base_turnaround_min)
            turnaround_capacity_per_hour = min(
                gate_throughput_per_hour,
                crew_capacity_per_hour,
                baggage_capacity_per_hour,
            )

            arrivals_tick = max(0.0, rng.gauss(arrivals_per_hour, max(0.2, arrivals_per_hour * 0.03))) * dt_hours
            gate_queue_flights += arrivals_tick

            move_to_gate = min(gate_queue_flights, max(0.0, gates_open - in_turnaround_flights))
            gate_queue_flights -= move_to_gate
            in_turnaround_flights += move_to_gate

            completed_turnaround = min(in_turnaround_flights, turnaround_capacity_per_hour * dt_hours)
            in_turnaround_flights -= completed_turnaround
            departure_queue_flights += completed_turnaround

            baggage_queue_flights = max(
                0.0,
                baggage_queue_flights + move_to_gate - baggage_capacity_per_hour * dt_hours,
            )

            planned_departures_tick = max(
                0.0,
                rng.gauss(departures_per_hour, max(0.2, departures_per_hour * 0.03)),
            ) * dt_hours
            departures_tick = min(
                departure_queue_flights,
                runway_capacity_per_hour * dt_hours,
                planned_departures_tick + 1e-9,
            )
            departure_queue_flights -= departures_tick
            total_departures += departures_tick

            queue_pressure = (gate_queue_flights + departure_queue_flights + baggage_queue_flights) / max(
                1.0,
                departures_per_hour,
            )
            throughput_pressure = departures_per_hour / max(1.0, turnaround_capacity_per_hour)

            turnaround_avg_min = base_turnaround_min
            turnaround_avg_min += effects["security_delay_min"]
            turnaround_avg_min += effects["deicing_delay_min"]
            turnaround_avg_min += _clamp(effects["weather_restriction_pct"], 0.0, 100.0) * 0.08
            turnaround_avg_min += queue_pressure * 20.0
            turnaround_avg_min += max(0.0, throughput_pressure - 1.0) * 12.0
            turnaround_avg_min = max(base_turnaround_min, turnaround_avg_min)

            delay_avg_min = max(0.0, turnaround_avg_min - base_turnaround_min)
            gate_utilization_pct = _clamp((in_turnaround_flights / gates_open) * 100.0, 0.0, 100.0)
            crew_utilization_pct = _clamp(
                ((completed_turnaround / max(dt_hours, 1e-9)) / max(1.0, crew_capacity_per_hour)) * 100.0,
                0.0,
                100.0,
            )

            otp_pct = _clamp(
                100.0 - delay_avg_min * 1.9 - queue_pressure * 6.0,
                0.0,
                100.0,
            )
            ontime_departures += departures_tick * (otp_pct / 100.0)
            delayed_departures += departures_tick * (1.0 - otp_pct / 100.0)

            otp_samples.append(otp_pct)
            turnaround_samples.append(turnaround_avg_min)
            gate_util_samples.append(gate_utilization_pct)
            crew_util_samples.append(crew_utilization_pct)
            departure_queue_samples.append(departure_queue_flights)
            baggage_queue_samples.append(baggage_queue_flights)
            delay_samples.append(delay_avg_min)

            base_latency = 7.0 if realtime_mode == "sil" else 10.0
            latency = max(0.5, abs(rng.gauss(base_latency + len(adapters) * 0.5, 1.2)))
            io_latencies_ms.append(latency)

            for adapter in adapters:
                adapter.write(
                    {
                        "otp_pct": round(otp_pct, 4),
                        "turnaround_avg_min": round(turnaround_avg_min, 4),
                        "gate_utilization_pct": round(gate_utilization_pct, 4),
                        "ground_crew_utilization_pct": round(crew_utilization_pct, 4),
                        "departure_queue_flights": round(departure_queue_flights, 4),
                        "baggage_queue_flights": round(baggage_queue_flights, 4),
                        "delay_avg_min": round(delay_avg_min, 4),
                    }
                )
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
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="otp_pct",
                    value=round(otp_pct, 6),
                    unit="%",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="turnaround_avg_min",
                    value=round(turnaround_avg_min, 6),
                    unit="min",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="gate_utilization_pct",
                    value=round(gate_utilization_pct, 6),
                    unit="%",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="ground_crew_utilization_pct",
                    value=round(crew_utilization_pct, 6),
                    unit="%",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="departure_queue_flights",
                    value=round(departure_queue_flights, 6),
                    unit="flights",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="baggage_queue_flights",
                    value=round(baggage_queue_flights, 6),
                    unit="flights",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="airport",
                    metric="delay_avg_min",
                    value=round(delay_avg_min, 6),
                    unit="min",
                    run_id=run_id,
                ),
                TelemetrySample(
                    ts=ts,
                    source="twin_core",
                    asset_id="io",
                    metric="io_latency_ms",
                    value=round(latency, 6),
                    unit="ms",
                    run_id=run_id,
                ),
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
            tick_drift_abs_ms.append(abs(tick_duration_ms - scenario.tick_ms))

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

    otp_rate_pct = (
        (ontime_departures / total_departures) * 100.0 if total_departures > 0 else (sum(otp_samples) / len(otp_samples))
    ) if otp_samples else 0.0

    airport_kpis = AirportKpiSummary(
        otp_rate_pct=round(otp_rate_pct, 6),
        avg_turnaround_min=round(sum(turnaround_samples) / len(turnaround_samples), 6) if turnaround_samples else 0.0,
        gate_utilization_avg_pct=round(sum(gate_util_samples) / len(gate_util_samples), 6) if gate_util_samples else 0.0,
        ground_crew_utilization_avg_pct=round(sum(crew_util_samples) / len(crew_util_samples), 6)
        if crew_util_samples
        else 0.0,
        departure_queue_avg_flights=round(sum(departure_queue_samples) / len(departure_queue_samples), 6)
        if departure_queue_samples
        else 0.0,
        baggage_queue_avg_flights=round(sum(baggage_queue_samples) / len(baggage_queue_samples), 6)
        if baggage_queue_samples
        else 0.0,
        delay_avg_min=round(sum(delay_samples) / len(delay_samples), 6) if delay_samples else 0.0,
        completed_departures=int(round(total_departures)),
        delayed_departures=int(round(delayed_departures)),
    )

    summary = RunSummary(
        freq_nadir_hz=round(50.0 - (100.0 - airport_kpis.otp_rate_pct) * 0.02, 6),
        volt_nadir_v=round(400.0 - airport_kpis.delay_avg_min * 0.5, 6),
        blackout_ms=int(round(max(0.0, airport_kpis.delay_avg_min - 5.0) * 1000.0)),
        switch_time_ms=int(round(airport_kpis.avg_turnaround_min * 1000.0)),
        final_soc_pct=round(_clamp(100.0 - airport_kpis.gate_utilization_avg_pct * 0.35, 0.0, 100.0), 6),
        io_latency_p99_ms=round(io_p99, 6),
        telemetry_hash=telemetry_hash,
        domain="airport_turnaround_v1",
        airport_kpis=airport_kpis,
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
