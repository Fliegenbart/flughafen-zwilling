"""Check local evidence completeness and result/report agreement, not authenticity."""
from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from ..models import AssertionResult, RunRecord, RunState, RunSummary, SafetySummary
from .coupled_evidence import ARTIFACT_NAMES

AUDIT_VERSION = "coupled_evidence_v2"
SEALED_ARTIFACT_NAMES = ARTIFACT_NAMES | {"report.json", "report.pdf"}


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def report_matches_record(record: RunRecord, directory: Path) -> bool:
    if record.status.state != RunState.completed or record.summary is None:
        return False
    try:
        with (directory / "report.pdf").open("rb") as pdf:
            if pdf.read(5) != b"%PDF-":
                return False
        payload = json.loads((directory / "report.json").read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return False
        report_meta = payload["build_meta"]
        if not isinstance(report_meta, dict):
            return False
        # Report hashes are added after rendering; exclude only this circular manifest.
        def metadata(meta: dict) -> dict:
            return {k: v for k, v in meta.items() if k != "result_artifact_hashes"}
        return all([
            payload["run_id"] == record.status.run_id,
            payload["scenario_id"] == record.status.scenario_id,
            payload["model_pack_id"] == record.status.model_pack_id,
            payload["seed"] == record.status.seed,
            payload["realtime_mode"] == record.status.realtime_mode,
            payload["pass_fail"] is record.status.pass_fail,
            RunSummary.model_validate(payload["summary"]) == record.summary,
            [AssertionResult.model_validate(a) for a in payload["assertions"]]
            == record.assertion_results,
            SafetySummary.model_validate(payload["watchdog_summary"]) == record.watchdog_summary,
            payload["scenario_snapshot"] == record.scenario_snapshot.model_dump(mode="json"),
            payload["model_pack_snapshot"] == record.model_pack_snapshot.model_dump(mode="json"),
            payload["hardware_meta"] == record.hardware_meta,
            metadata(report_meta) == metadata(record.build_meta),
        ])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def inspect_coupled_evidence(record: RunRecord, directory: Path) -> dict:
    version = record.build_meta.get("result_audit_version")
    scope = "invalid"
    if version == AUDIT_VERSION:
        names, scope = SEALED_ARTIFACT_NAMES, "data_and_reports_v2"
    elif version is None:
        names, scope = ARTIFACT_NAMES, "data_and_report_consistency_v1"
    else:
        names = set()
    expected = record.build_meta.get("result_artifact_hashes")
    hashes_match = bool(names) and isinstance(expected, dict) and set(expected) == names
    if hashes_match:
        try:
            hashes_match = all(
                isinstance(expected[name], str)
                and file_sha256(directory / name) == expected[name]
                for name in sorted(names)
            )
        except OSError:
            hashes_match = False
    return {
        "artifact_hashes_match": hashes_match,
        "report_consistent_match": report_matches_record(record, directory),
        "result_audit_scope": scope,
        "reports_hashed": scope == "data_and_reports_v2" and hashes_match,
    }
