#!/usr/bin/env python3
"""Verify the local demo using only Python's standard library."""
import argparse
import json
import time
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5176")
    parser.add_argument("--planner", action="store_true")
    parser.add_argument("--all-cases", action="store_true", help="Verify all eight airport cases instead of two reference cases")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    def request(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    def terminal(path):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            status = request(path)
            if status["state"] in {"completed", "failed"}:
                assert status["state"] == "completed", status
                return status
            time.sleep(0.25)
        raise AssertionError("Job timeout: " + path)

    assert request("/api/v1/ready")["status"] == "ready"
    seeds = request("/api/v1/scenarios")
    assert len([s for s in seeds if s["id"].startswith("airport_case_")]) >= 8
    cases = sorted(s["id"] for s in seeds if s["id"].startswith("airport_case_") and s["id"].endswith("_v1"))
    reference_cases = ["airport_case_02_guillotine_v1", "airport_case_08_schwarzstart_v1"]
    for scenario in ["airport_turnaround_stability_v1", *(cases if args.all_cases else reference_cases)]:
        created = request("/api/v1/runs", {
            "scenario_id": scenario, "model_pack_id": "airport_medium_eu_v1",
            "seed": 42, "realtime_mode": "sil", "adapters": [],
        })
        run_id = created["run_id"]
        terminal("/api/v1/runs/" + run_id)
        record = request("/api/v1/runs/" + run_id + "/record")
        assert record["summary"]["airport_kpis"]
        assert record["status"]["artifacts"]
        assert record["scenario_snapshot"]["domain"] == "airport_turnaround_v1"
        safety = request("/api/v1/runs/" + run_id + "/safety")
        assert safety["audit"]["fingerprint_match"], safety
        for artifact, signature in (("telemetry.csv", b"ts,source,"), ("artifacts/report.pdf", b"%PDF")):
            with urllib.request.urlopen(base + f"/api/v1/runs/{run_id}/{artifact}", timeout=10) as response:
                assert response.read().startswith(signature), artifact
        print(json.dumps({"scenario": scenario, "run_id": run_id, "kpis": record["summary"]["airport_kpis"]}))

    if args.planner:
        assert request("/api/v1/capabilities")["playbook_synth_enabled"]
        for scenario in ("airport_case_02_guillotine_v1", "airport_case_08_schwarzstart_v1"):
            job = request("/api/v1/playbook-jobs", {
                "scenario_id": scenario, "model_pack_id": "airport_medium_eu_v1",
                "seed": 42, "search_seed": 42, "search_budget_sec": 5, "max_options": 2,
            })
            job_id = job["job_id"]
            terminal("/api/v1/playbook-jobs/" + job_id)
            record = request("/api/v1/playbook-jobs/" + job_id + "/record")
            for option in (record["baseline_option"], record["best_option"]):
                assert option["validated_airport_kpis"], option
                assert option["delta_to_baseline"] is not None, option
                terminal("/api/v1/runs/" + option["validation_run_id"])
            for artifact in ("playbook.md", "frontier.json", "summary.csv"):
                with urllib.request.urlopen(base + f"/api/v1/playbook-jobs/{job_id}/artifacts/{artifact}", timeout=10) as response:
                    assert response.read(), artifact
            print(json.dumps({"scenario": scenario, "job_id": job_id, "delta": record["best_option"]["delta_to_baseline"]}))


if __name__ == "__main__":
    main()
