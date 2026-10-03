#!/usr/bin/env python3
"""Manually import a local MUC PDF and verify the frozen daily schedule; no fetching."""
import argparse
import csv
import hashlib
import io
import json
import time
import urllib.request
from datetime import date
from pathlib import Path

from pilot_auth import configure_auth


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--date", required=True, type=date.fromisoformat)
    parser.add_argument("--base-url", default="http://localhost:5176")
    parser.add_argument("--auth-file", help="Private 0600 netrc for the HTTPS pilot")
    parser.add_argument("--compare", action="store_true", help="Also run the SIL energy pair")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    configure_auth(base, args.auth_file)
    if args.pdf.stat().st_size > 6 * 1024 * 1024:
        parser.error("PDF exceeds 6 MiB")
    body = args.pdf.read_bytes()

    def request(path, data=None, content_type="application/json"):
        req = urllib.request.Request(base + "/api/v1" + path, data=data,
                                     headers={"Content-Type": content_type})
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.read()

    endpoint = f"/munich/flight-plans?service_date={args.date}"
    started = time.monotonic()
    plan = json.loads(request(endpoint, body, "application/pdf"))
    assert plan["source_pdf_sha256"] == hashlib.sha256(body).hexdigest()
    assert plan["service_date"] == str(args.date)
    assert json.loads(request(endpoint, body, "application/pdf")) == plan
    root = "/munich/flight-plans/" + plan["snapshot_id"]
    assert json.loads(request(root)) == plan
    rows = list(csv.DictReader(io.StringIO(request(root + "/export.csv").decode())))
    assert len(rows) == len(plan["rows"])
    assert sum(h["arrivals"] for h in plan["hourly_counts"]) == plan["arrival_entry_count"]
    assert sum(h["departures"] for h in plan["hourly_counts"]) == plan["departure_entry_count"]
    run_ids = []
    if args.compare:
        pair = json.loads(request("/munich/comparisons", json.dumps({
            "seed": 42, "flight_plan_snapshot_id": plan["snapshot_id"],
        }).encode()))
        for run in pair["runs"]:
            run_id = run["run_id"]
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                status = json.loads(request("/runs/" + run_id))
                if status["state"] in {"completed", "failed"}:
                    break
                time.sleep(0.1)
            assert status["state"] == "completed", status
            record = json.loads(request(f"/runs/{run_id}/record"))
            meta = record["model_pack_snapshot"]["calibration_meta"]
            assert meta["flight_plan_snapshot"] == plan
            assert meta["flight_plan_usage"] == "context_only_not_driving_energy"
            assert record["summary"]["airport_kpis"] is None
            assert record["summary"]["energy_world_hash"] == pair["world_hash"]
            assert json.loads(request(f"/runs/{run_id}/safety"))["audit"]["fingerprint_match"]
            run_ids.append(run_id)
    print(json.dumps({
        "service_date": plan["service_date"], "source_data_date": plan["source_data_date"],
        "snapshot_id": plan["snapshot_id"], "arrival_entries": plan["arrival_entry_count"],
        "departure_entries": plan["departure_entry_count"],
        "unresolved_shared_groups": plan["possible_shared_flight_groups"],
        "seconds": round(time.monotonic() - started, 2), "run_ids": run_ids,
        "usage": "context_only_not_driving_energy",
    }))


if __name__ == "__main__":
    main()
