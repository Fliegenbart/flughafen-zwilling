#!/usr/bin/env python3
"""Check synthetic Munich comparison, evidence and audit on the local demo."""
import argparse
import json
import time
import urllib.request
from pilot_auth import configure_auth


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5176")
    parser.add_argument("--auth-file", help="Private 0600 netrc file for HTTPS pilot")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    configure_auth(base, args.auth_file)

    def request(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + path, data=data,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)

    def record(run_id):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            status = request(f"/api/v1/runs/{run_id}")
            if status["state"] in {"completed", "failed"}:
                assert status["state"] == "completed", status
                return request(f"/api/v1/runs/{run_id}/record")
            time.sleep(0.1)
        raise AssertionError(f"Run timeout: {run_id}")

    reference = request("/api/v1/munich/reference")
    assert reference["evidence_level"] == "synthetic_uncalibrated"
    for label, override in [
        ("Referenztag", {}), ("Anschluss-Engpass", {"grid_import_limit_kw": 2500}),
        ("Wenig Solarertrag", {"grid_import_limit_kw": 3000, "pv_peak_factor": 0.15}),
        ("Speicheroption", {"grid_import_limit_kw": 2500, "battery_capacity_kwh": 2000}),
    ]:
        started = time.monotonic()
        pair = request("/api/v1/munich/comparisons", {"seed": 42, "assumptions": override})
        records = [record(run["run_id"]) for run in pair["runs"]]
        a, b = [r["summary"]["energy_kpis"] for r in records]
        assert records[0]["summary"]["energy_world_hash"] == records[1]["summary"]["energy_world_hash"] == pair["world_hash"]
        if label == "Referenztag":
            assert a["bus_ready_count"] == b["bus_ready_count"] == 50
        if label == "Anschluss-Engpass":
            assert b["bus_ready_count"] > a["bus_ready_count"]
        for result in records:
            run_id = result["status"]["run_id"]
            kpis = result["summary"]["energy_kpis"]
            assert result["scenario_snapshot"]["domain"] == "airport_energy_v1"
            assert kpis["balance_error_max_kw"] < 1e-6
            assert request(f"/api/v1/runs/{run_id}/safety")["audit"]["fingerprint_match"]
            for name, signature in [("report.pdf", b"%PDF"), ("report.json", b"{"),
                                    ("charging.csv", b"id,sector,")]:
                with urllib.request.urlopen(base + f"/api/v1/runs/{run_id}/artifacts/{name}", timeout=15) as response:
                    assert response.read().startswith(signature), name
        print(json.dumps({"case": label, "seconds": round(time.monotonic() - started, 2),
                          "comparison_id": pair["comparison_id"],
                          "run_ids": [r["status"]["run_id"] for r in records],
                          "bus_ready_baseline": a["bus_ready_count"],
                          "bus_ready_priority": b["bus_ready_count"],
                          "evidence_level": "synthetic_uncalibrated"}))


if __name__ == "__main__":
    main()
