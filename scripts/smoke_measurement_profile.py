#!/usr/bin/env python3
"""Read-only smoke of a completed coupled run's three measurement profiles."""
import argparse
import json
from datetime import datetime
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/api/v1/runs/" + args.run_id

    def get(path):
        with urlopen(base + path, timeout=30) as response:
            return json.load(response)

    record = get("/record")
    assert record["status"]["state"] == "completed"
    expected = record["build_meta"]["result_artifact_hashes"]["coupled-evidence.json"]
    evidence = get("/artifacts/coupled-evidence.json")
    for metric in ("grid_import_kw", "ground_charging_kw", "parking_kw"):
        profile = get("/measurement-profile?metric=" + metric)
        assert profile["provenance"]["artifact_sha256"] == expected
        assert profile["sample_semantics"] == "interval_end_mean"
        assert profile["unit"] == "kW" and profile["interval_seconds"] == 60
        assert profile["evidence_level"] == "model_checked"
        assert len(profile["points"]) == len(evidence["series"]) >= 60
        times = [datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00"))
                 for p in profile["points"]]
        assert all((b - a).total_seconds() == 60 for a, b in zip(times, times[1:]))
        assert all(p["model_kw"] == row[metric]
                   for p, row in zip(profile["points"], evidence["series"]))
        energy = sum(p["model_kw"] for p in profile["points"]) / 60
        print(metric, "PASS", len(times), "minute means; model_kwh=", round(energy, 3))
    print("Read-only technical smoke passed. No measurements uploaded, no model validation.")


if __name__ == "__main__":
    main()
