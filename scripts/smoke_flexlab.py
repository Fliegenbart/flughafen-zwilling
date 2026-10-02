#!/usr/bin/env python3
"""Local FlexLab smoke: simulation, import, comparison, faults, cancellation, exports."""

import argparse
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5176")
    parser.add_argument(
        "--restart", action="store_true", help="Restart ONLY the local demo twin-core"
    )
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/api/v1/lab"

    def request(path, payload=None, raw=False):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(
            base + path, data=data, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.read().decode() if raw else json.load(response)

    def wait(run_id, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                record = request("/runs/" + run_id)
                if record["state"] in ("completed", "failed", "cancelled"):
                    assert record["state"] == "completed", record
                    return record
            except (urllib.error.URLError, ConnectionError):
                pass
            time.sleep(0.2)
        raise AssertionError("Run did not complete: " + run_id)

    catalog = request("/catalog")
    assert catalog["read_only"] and not catalog["live_connection"]
    example = request("/example.csv", raw=True)
    imported = request(
        "/imports",
        {
            "filename": "synthetic-smoke.csv",
            "csv_text": example,
            "label": "Smoke · Simuliertes CSV-Beispiel",
        },
    )
    imported = wait(imported["run_id"])
    assert imported["analysis"]["verdict"] == "pass", imported
    assert imported["source_sha256"] == hashlib.sha256(example.encode()).hexdigest()
    run = request(
        "/runs",
        {"duration_s": 180, "playback_speed": 100, "label": "Smoke · Sollwertsprung"},
    )
    run = wait(run["run_id"])
    assert run["analysis"]["verdict"] == "pass", run
    compare = request(
        f"/compare?baseline_id={imported['run_id']}&candidate_id={run['run_id']}"
    )
    assert all(value in (0, None) for value in compare["deltas"].values()), compare
    for name in ("record.json", "trace.csv", "report.html"):
        assert request(f"/runs/{run['run_id']}/artifacts/{name}", raw=True)
    for case in ("flex-reduction", "power-cap", "telemetry-loss"):
        case_run = wait(
            request(
                "/runs",
                {
                    "case_id": case,
                    "duration_s": 180,
                    "playback_speed": 100,
                    "label": "Smoke · " + case,
                },
            )["run_id"]
        )
        expected = (
            "inconclusive"
            if case == "telemetry-loss"
            else "fail"
            if case == "power-cap"
            else "pass"
        )
        assert case_run["analysis"]["verdict"] == expected, case_run
        print(
            json.dumps(
                {"case": case, "run_id": case_run["run_id"], "verdict": expected}
            )
        )
    cancelled = request("/runs", {"label": "Smoke · Abbruch", "playback_speed": 1})
    assert request(f"/runs/{cancelled['run_id']}/cancel", {})["state"] == "cancelled"
    if args.restart:
        recovery = request(
            "/runs",
            {
                "duration_s": 180,
                "playback_speed": 20,
                "label": "Smoke · Neustart-Recovery",
            },
        )
        deadline = time.monotonic() + 10
        while request("/runs/" + recovery["run_id"])["state"] != "running":
            if time.monotonic() >= deadline:
                raise AssertionError("Recovery test did not start")
            time.sleep(0.1)
        subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.demo.yml",
                "-f",
                "docker-compose.demo-monitoring.yml",
                "restart",
                "twin-core",
            ],
            cwd=Path(__file__).resolve().parents[1],
            check=True,
            timeout=60,
        )
        recovered = wait(recovery["run_id"])
        assert recovered["recovery_count"] >= 1, recovered
        print(
            json.dumps(
                {
                    "recovered_run_id": recovered["run_id"],
                    "recovery_count": recovered["recovery_count"],
                }
            )
        )
    print(
        json.dumps(
            {
                "result": "PASS",
                "simulation": run["run_id"],
                "import": imported["run_id"],
                "cancelled": cancelled["run_id"],
            }
        )
    )


if __name__ == "__main__":
    main()
