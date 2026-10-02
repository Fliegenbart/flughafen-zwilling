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


def wait_for_run(base_url: str, run_id: str, timeout_s: float = 60.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status = http_json("GET", f"{base_url}/api/v1/runs/{run_id}")
        state = status.get("state")
        if state in {"completed", "failed"}:
            return status
        time.sleep(0.2)
    raise RuntimeError(f"Run {run_id} did not finish within {timeout_s}s")


def main() -> int:
    parser = argparse.ArgumentParser(description="Gate A stability check (100 sim runs)")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Twin API base URL")
    parser.add_argument("--runs", type=int, default=100, help="Number of runs")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    scenario_id = "gate_a_sim_stability_v1"
    model_pack_id = "gate_a_model_pack_v1"

    scenario = {
        "id": scenario_id,
        "version": "1.0.0",
        "description": "Gate A stability sweep",
        "duration_ms": 60000,
        "tick_ms": 40,
        "timeline_events": [{"at_ms": 2500, "action": "set", "target": "grid_on", "value": False}],
        "disturbances": [{
            "name": "load-step",
            "target": "load_step_kw",
            "start_ms": 2600,
            "duration_ms": 4500,
            "magnitude": 70.0,
        }],
        "expected_assertions": [
            {"name": "Frequency floor", "metric": "freq_nadir_hz", "op": ">=", "threshold": 47.0},
            {"name": "Blackout budget", "metric": "blackout_ms", "op": "<=", "threshold": 500.0},
        ],
    }

    model_pack = {
        "id": model_pack_id,
        "site_profile": "kaserne-eon-testinglab",
        "assets": [],
        "parameter_set": {
            "nominal_freq_hz": 50.0,
            "nominal_voltage_v": 400.0,
            "critical_load_kw": 120.0,
            "noncritical_load_kw": 180.0,
            "battery_capacity_kwh": 500.0,
            "battery_soc_pct": 85.0,
            "battery_max_kw": 250.0,
            "diesel_max_kw": 400.0,
            "diesel_start_delay_ms": 3500.0,
            "diesel_ramp_time_ms": 14000.0,
            "inverter_switch_time_ms": 18.0,
            "load_shed_delay_ms": 150.0,
            "pv_peak_kw": 100.0,
        },
        "calibration_meta": {"gate": "A", "source": "script"},
    }

    http_json("POST", f"{base_url}/api/v1/scenarios", scenario)
    http_json("POST", f"{base_url}/api/v1/model-packs", model_pack)

    failures: list[str] = []
    for idx in range(args.runs):
        run_payload = {
            "scenario_id": scenario_id,
            "model_pack_id": model_pack_id,
            "seed": 20260219 + idx,
            "realtime_mode": "hil_realtime",
            "adapters": [
                {
                    "name": "modbus",
                    "enabled": True,
                    "endpoint": "sim://modbus-eon-testinglab",
                    "profile": "eon_testinglab_essen_v1",
                    "transport": "sim",
                    "mapping": {},
                },
                {
                    "name": "opcua",
                    "enabled": True,
                    "endpoint": "sim://opcua-eon-testinglab",
                    "profile": "eon_testinglab_essen_v1",
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
        if not record.get("summary", {}).get("telemetry_hash"):
            failures.append(f"{run_id}: missing telemetry hash")

        if (idx + 1) % 10 == 0:
            print(f"[{idx + 1}/{args.runs}] completed")

    if failures:
        print("Gate A FAILED")
        for line in failures:
            print(f" - {line}")
        return 1

    print(f"Gate A PASSED ({args.runs} runs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
