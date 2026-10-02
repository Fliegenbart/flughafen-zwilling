from __future__ import annotations

import time

from influxdb_client import InfluxDBClient, Point, WriteOptions
from prometheus_client import Counter, Gauge

from .models import TelemetrySample

RUNS_TOTAL = Counter("twin_runs_total", "Runs", ["state", "realtime_mode"])
WATCHDOG_MISSES = Counter("twin_watchdog_misses_total", "Watchdog misses")
TICK_DRIFT_P99 = Gauge("twin_tick_drift_p99_ms", "P99 drift")
PLAYBOOK_JOBS_TOTAL = Counter("twin_playbook_jobs_total", "Playbook jobs", ["state"])
PLAYBOOK_JOB_DURATION_SECONDS = Gauge("twin_playbook_job_duration_seconds", "Playbook job duration in seconds")
PLAYBOOK_CANDIDATES_EVALUATED = Gauge("twin_playbook_candidates_evaluated", "Playbook candidates evaluated")


class InfluxTelemetryWriter:
    def __init__(self, url: str, token: str, org: str, bucket: str) -> None:
        self.client = InfluxDBClient(url=url, token=token, org=org)
        self.write_api = self.client.write_api(
            write_options=WriteOptions(batch_size=1000, flush_interval=500)
        )
        self.bucket = bucket
        self.run_start_ns = time.time_ns()

    def write_sample(self, run_id: str, sample: TelemetrySample) -> None:
        p = (
            Point(sample.metric)
            .tag("run_id", run_id)
            .tag("asset_id", sample.asset_id)
            .tag("source", sample.source)
            .field("value", float(sample.value))
            .time(self.run_start_ns + int(sample.ts * 1_000_000))
        )
        self.write_api.write(bucket=self.bucket, record=p)

    def close(self) -> None:
        self.write_api.flush()
        self.client.close()
