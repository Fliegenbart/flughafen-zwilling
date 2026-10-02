#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from urllib import request
from urllib.error import HTTPError


def http_json(method: str, url: str, payload: dict | None = None) -> dict:
    body = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = request.Request(url=url, data=body, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=20) as response:
            data = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {detail}") from exc

    if not data:
        return {}
    return json.loads(data)


def wait_for_run(base_url: str, run_id: str, timeout_s: float = 90.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status = http_json("GET", f"{base_url}/api/v1/runs/{run_id}")
        if status.get("state") in {"completed", "failed"}:
            return status
        time.sleep(0.2)
    raise RuntimeError(f"Run {run_id} did not finish within {timeout_s}s")


def main() -> int:
    parser = argparse.ArgumentParser(description="Airport turnaround stability check (100 sim runs)")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Twin API base URL")
    parser.add_argument("--runs", type=int, default=100, help="Number of runs")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    scenario_id = "airport_turnaround_stability_v1"
    model_pack_id = "airport_medium_eu_v1"

    scenario = {
        "id": scenario_id,
        "version": "1.0.0",
        "domain": "airport_turnaround_v1",
        "description": "Airport turnaround stability sweep",
        "duration_ms": 60000,
        "tick_ms": 40,
        "timeline_events": [
            {"at_ms": 12000, "action": "inject", "target": "arrivals_per_hour", "value": 2.0},
            {"at_ms": 15000, "action": "inject", "target": "departures_per_hour", "value": 2.0},
        ],
        "disturbances": [
            {
                "name": "gate-pressure",
                "target": "gate_blockage_pct",
                "start_ms": 12000,
                "duration_ms": 12000,
                "magnitude": 9.0,
            },
            {
                "name": "staffing-gap",
                "target": "staffing_shortage_pct",
                "start_ms": 24000,
                "duration_ms": 12000,
                "magnitude": 12.0,
            },
        ],
        "expected_assertions": [
            {"name": "OTP rate", "metric": "airport_kpis.otp_rate_pct", "op": ">=", "threshold": 85.0},
            {
                "name": "Turnaround average",
                "metric": "airport_kpis.avg_turnaround_min",
                "op": "<=",
                "threshold": 55.0,
            },
            {
                "name": "Gate utilization average",
                "metric": "airport_kpis.gate_utilization_avg_pct",
                "op": "<=",
                "threshold": 92.0,
            },
        ],
        "metadata": {"gate": "airport_stability", "source": "script"},
    }

    model_pack = {
        "id": model_pack_id,
        "site_profile": "airport-medium-eu",
        "assets": [],
        "parameter_set": {
            "gates_total": 28,
            "gates_open_pct": 96,
            "arrivals_per_hour": 24,
            "departures_per_hour": 24,
            "base_turnaround_min": 44,
            "ground_crew_teams": 14,
            "crew_capacity_flights_per_hour": 1.8,
            "baggage_capacity_flights_per_hour": 26,
            "runway_slots_per_hour": 28,
        },
        "calibration_meta": {"profile": "airport_medium_eu_v1", "source": "script"},
    }

    http_json("POST", f"{base_url}/api/v1/scenarios", scenario)
    http_json("POST", f"{base_url}/api/v1/model-packs", model_pack)

    failures: list[str] = []
    for idx in range(args.runs):
        run_payload = {
            "scenario_id": scenario_id,
            "model_pack_id": model_pack_id,
            "seed": 20260221 + idx,
            "realtime_mode": "hil_realtime",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://modbus-airport-medium-eu",
                    "profile": "airport_medium_eu_v1",
                    "transport": "sim",
                    "mapping": {},
                },
                {
                    "name": "opcua",
                    "enabled": True,
                    "endpoint": "sim://opcua-airport-medium-eu",
                    "profile": "airport_medium_eu_v1",
                    "transport": "sim",
                    "mapping": {},
                },
            ],
            "assertions": [],
        }
        run_status = http_json("POST", f"{base_url}/api/v1/runs", run_payload)
        run_id = run_status["run_id"]
        final_status = wait_for_run(base_url, run_id)

        if final_status.get("state") != "completed":
            failures.append(f"{run_id}: state={final_status.get('state')} error={final_status.get('error')}")
            continue

        record = http_json("GET", f"{base_url}/api/v1/runs/{run_id}/record")
        summary = record.get("summary", {})
        if not summary.get("telemetry_hash"):
            failures.append(f"{run_id}: missing telemetry hash")
            continue

        if not (summary.get("airport_kpis") or {}).get("otp_rate_pct"):
            failures.append(f"{run_id}: missing airport KPI payload")

        if (idx + 1) % 10 == 0:
            print(f"[{idx + 1}/{args.runs}] completed")

    if failures:
        print("Airport stability check FAILED")
        for line in failures:
            print(f" - {line}")
        return 1

    print(f"Airport stability check PASSED ({args.runs} runs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
