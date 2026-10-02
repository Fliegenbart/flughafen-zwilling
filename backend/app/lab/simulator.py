from __future__ import annotations

import random
from collections.abc import Iterator

from .models import RunRequest, Sample


def simulate(request: RunRequest) -> Iterator[Sample]:
    """Dimensioned aggregate reference load, not a calibrated charger/EV model."""
    bench = request.bench
    rng = random.Random(request.seed)
    low = min(20.0, bench.max_power_kw * 0.2, bench.grid_limit_kw * 0.25)
    high = min(bench.max_power_kw * 0.7, bench.grid_limit_kw)
    initial = high if request.case_id in ("flex-reduction", "power-cap") else low
    power = initial
    commands: list[float] = []
    for ts in range(request.duration_s + 1):
        limit = bench.grid_limit_kw
        command = initial
        if ts >= 30:
            if request.case_id == "power-cap":
                limit = bench.grid_limit_kw * 0.55
                command = min(high, limit)
            else:
                command = low if request.case_id == "flex-reduction" else high
        commands.append(command)
        delayed = commands[max(0, ts - bench.response_delay_s)]
        if ts:
            power += max(-bench.ramp_kw_per_s, min(bench.ramp_kw_per_s, delayed - power))
        measured = round(power + rng.uniform(-bench.noise_kw, bench.noise_kw), 4)
        if request.case_id == "telemetry-loss" and 60 <= ts < 80:
            measured = None
        yield Sample(ts_s=ts, power_kw=measured, setpoint_kw=command, limit_kw=limit)
