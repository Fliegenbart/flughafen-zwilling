#!/usr/bin/env python3
"""Explicit SIL smoke using an already imported snapshot; never fetches flight schedules."""
import argparse
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pilot_auth import configure_auth


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5176")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--accept-independent-entries", action="store_true")
    parser.add_argument("--auth-file", "--netrc", type=Path,
                        help="Private optional HTTPS BasicAuth file; never printed")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/api/v1"
    parsed = urllib.parse.urlsplit(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("Keine Zugangsdaten, Query oder Fragment in der Basis-URL")
    configure_auth(args.base_url, args.auth_file)

    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    def raw(path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(base + path, body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    def fetch(path, payload=None):
        return json.loads(raw(path, payload))

    started = time.monotonic()
    config = {"shared_group_policy": "independent_entries_assumption"} if (
        args.accept_independent_entries
    ) else {}
    pair = fetch("/munich/coupled-comparisons", {
        "flight_plan_snapshot_id": args.snapshot_id, "seed": 42, "config": config,
    })
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    results = []
    for run in pair["runs"]:
        run_id = run["run_id"]
        while True:
            status = fetch(f"/runs/{run_id}")
            if status["state"] in {"completed", "failed"}:
                break
            if time.monotonic() - started > args.timeout:
                raise RuntimeError("Smoke-Zeitlimit erreicht; Runs bleiben im Backend erhalten")
            time.sleep(0.5)
        if status["state"] != "completed":
            raise RuntimeError(f"Run {run_id} fehlgeschlagen: {status['error']}")
        record = fetch(f"/runs/{run_id}/record")
        require(record["summary"]["energy_world_hash"] == pair["world_hash"], "Welt-Hash abweichend")
        require(record["model_pack_snapshot"]["calibration_meta"]["flight_plan_snapshot"][
            "snapshot_id"
        ] == args.snapshot_id, "Flugplan-Snapshot abweichend")
        audit = fetch(f"/runs/{run_id}/safety")["audit"]
        require(audit["fingerprint_match"] and audit["artifact_hashes_match"], "Audit fehlgeschlagen")
        directory = args.output_dir / run_id
        directory.mkdir(exist_ok=True, mode=0o700)
        for artifact, expected in record["build_meta"]["result_artifact_hashes"].items():
            if artifact not in {"missions.csv", "departures.csv", "vehicles.csv", "parking.csv",
                                "coupled-evidence.json"}:
                raise RuntimeError("Unbekanntes Artefakt")
            content = raw(f"/runs/{run_id}/artifacts/{artifact}")
            require(hashlib.sha256(content).hexdigest() == expected, "Artefakt-Hash abweichend")
            (directory / artifact).write_bytes(content)
        for artifact in ["report.pdf", "record.json"]:
            content = raw(f"/runs/{run_id}/artifacts/{artifact}")
            if artifact.endswith(".pdf"):
                require(content.startswith(b"%PDF"), "Ungueltiger PDF-Export")
            (directory / artifact).write_bytes(content)
        results.append({"run_id": run_id, "pass_fail": status["pass_fail"],
                        "policy": record["model_pack_snapshot"]["parameter_set"]["policy"],
                        "coupled_kpis": record["summary"]["coupled_kpis"],
                        "energy_kpis": record["summary"]["energy_kpis"], "audit": audit})
    summary = {"comparison_id": pair["comparison_id"], "world_hash": pair["world_hash"],
               "duration_seconds": round(time.monotonic() - started, 2), "results": results}
    (args.output_dir / "smoke.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"comparison_id": summary["comparison_id"], "world_hash": summary["world_hash"],
                      "duration_seconds": summary["duration_seconds"],
                      "runs": [{"run_id": r["run_id"], "policy": r["policy"],
                                "model_criteria_pass": r["pass_fail"],
                                "missions": r["coupled_kpis"]["mission_count"],
                                "departure_readiness_pct": r["coupled_kpis"]["departure_readiness_pct"],
                                "energy_wait_min": r["coupled_kpis"]["energy_wait_total_min"],
                                "parking_unmet_kwh": r["energy_kpis"]["charging_unmet_kwh"]}
                               for r in results]}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, ValueError) as exc:
        raise SystemExit(f"Kopplungs-Smoke fehlgeschlagen: {exc}") from None
