from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import sqlite3
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO, StringIO
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CSV_ROWS = 100_000
ASSESSMENT_VERSION = "pilot-assessment-v1"
REPLAY_METRICS = {"grid_import_kw", "ground_charging_kw", "parking_kw"}
CLAIM_BOUNDARY = (
    "Frozen quantitative check only; not empirical model, safety, or operational validation."
)
TEMPLATE_CSV = (
    "timestamp,measured_kw,model_kw\n"
    "2026-10-04T08:00:00+00:00,120.0,118.5\n"
    "2026-10-04T08:01:00+00:00,122.0,121.0\n"
    "2026-10-04T08:02:00+00:00,121.5,122.0\n"
)


class ProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    decision: str = Field(min_length=1, max_length=1_000)
    scope: str = Field(min_length=1, max_length=1_000)
    acceptance_note: str = Field(min_length=1, max_length=2_000)


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    csv_text: str = Field(min_length=1, max_length=MAX_CSV_BYTES)
    role: Literal["calibration", "holdout", "lab"]
    measurement_boundary: str = Field(min_length=1, max_length=2_000)
    source_note: str = Field(min_length=1, max_length=2_000)
    sample_semantics: Literal["point_samples", "interval_end_mean"] = "point_samples"
    model_run_id: str | None = Field(default=None, max_length=64)

    @field_validator("model_run_id")
    @classmethod
    def normalize_model_run_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return str(UUID(value.strip()))
        except (AttributeError, ValueError) as exc:
            raise ValueError("model_run_id must be a UUID") from exc


class AssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    import_id: str
    mae_max_kw: float = Field(ge=0, le=1_000_000_000)
    energy_error_max_pct: float = Field(ge=0, le=1_000_000_000)


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    import_id: str
    run_id: str
    metric: Literal["grid_import_kw", "ground_charging_kw", "parking_kw"]


class EvidenceStore:
    """Small SQLite evidence ledger with generated-path raw source retention."""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir.resolve()
        self.root = (self.base_dir / "pilot").resolve()
        self.import_dir = (self.root / "imports").resolve()
        self.replay_dir = (self.root / "replays").resolve()
        self._assert_within(self.root, self.base_dir)
        self._assert_within(self.import_dir, self.root)
        self._assert_within(self.replay_dir, self.root)
        self.import_dir.mkdir(parents=True, exist_ok=True)
        self.replay_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "pilot_evidence.sqlite3"
        self._initialize()

    @staticmethod
    def _assert_within(path: Path, parent: Path) -> None:
        try:
            path.relative_to(parent)
        except ValueError as exc:
            raise ValueError("pilot evidence path escapes its base directory") from exc

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    acceptance_note TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS imports (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    filename TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('calibration', 'holdout', 'lab')),
                    sample_semantics TEXT NOT NULL DEFAULT 'point_samples'
                        CHECK(sample_semantics IN ('point_samples', 'interval_end_mean')),
                    measurement_boundary TEXT NOT NULL,
                    source_note TEXT NOT NULL,
                    model_run_id TEXT,
                    model_provenance_json TEXT NOT NULL,
                    quality_json TEXT NOT NULL,
                    raw_path TEXT NOT NULL UNIQUE,
                    source_import_id TEXT REFERENCES imports(id),
                    replay_json TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS imports_by_project
                    ON imports(project_id, created_at, id);
                CREATE TABLE IF NOT EXISTS assessments (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    import_id TEXT NOT NULL REFERENCES imports(id),
                    version TEXT NOT NULL,
                    validity_status TEXT NOT NULL
                        CHECK(validity_status IN ('NOT_EVALUABLE', 'PASS', 'FAIL')),
                    thresholds_json TEXT NOT NULL,
                    metrics_json TEXT NOT NULL,
                    reasons_json TEXT NOT NULL,
                    claim_boundary TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS assessments_by_project
                    ON assessments(project_id, created_at, id);
                CREATE TABLE IF NOT EXISTS audit (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    action TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    details_json TEXT NOT NULL,
                    previous_hash TEXT,
                    entry_hash TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS audit_by_project ON audit(project_id, seq);
                CREATE TRIGGER IF NOT EXISTS audit_append_only_update
                BEFORE UPDATE ON audit BEGIN
                    SELECT RAISE(ABORT, 'audit entries are immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS audit_append_only_delete
                BEFORE DELETE ON audit BEGIN
                    SELECT RAISE(ABORT, 'audit entries are immutable');
                END;
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(imports)")}
            if "source_import_id" not in columns:
                connection.execute("ALTER TABLE imports ADD COLUMN source_import_id TEXT")
            if "replay_json" not in columns:
                connection.execute("ALTER TABLE imports ADD COLUMN replay_json TEXT")
            if "sample_semantics" not in columns:
                connection.execute(
                    "ALTER TABLE imports ADD COLUMN sample_semantics "
                    "TEXT NOT NULL DEFAULT 'point_samples'"
                )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")

    @staticmethod
    def _canonical(payload: object) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

    @staticmethod
    def _json(value: object) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

    @staticmethod
    def _clean_text(value: str, field: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise HTTPException(status_code=422, detail=f"{field} must not be blank")
        return cleaned

    @staticmethod
    def _project_payload(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "decision": row["decision"],
            "scope": row["scope"],
            "acceptance_note": row["acceptance_note"],
            "created_at": row["created_at"],
        }

    @staticmethod
    def _import_payload(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "filename": row["filename"],
            "role": row["role"],
            "sample_semantics": row["sample_semantics"],
            "measurement_boundary": row["measurement_boundary"],
            "source_note": row["source_note"],
            "model_run_id": row["model_run_id"],
            "model_provenance": json.loads(row["model_provenance_json"]),
            "quality": json.loads(row["quality_json"]),
            "source_import_id": row["source_import_id"],
            "replay": json.loads(row["replay_json"]) if row["replay_json"] else None,
            "created_at": row["created_at"],
        }

    @staticmethod
    def _assessment_payload(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "import_id": row["import_id"],
            "version": row["version"],
            "validity_status": row["validity_status"],
            "thresholds": json.loads(row["thresholds_json"]),
            "metrics": json.loads(row["metrics_json"]),
            "not_evaluable_reasons": json.loads(row["reasons_json"]),
            "claim_boundary": row["claim_boundary"],
            "created_at": row["created_at"],
        }

    def _append_audit(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        action: str,
        entity_id: str,
        details: dict,
    ) -> None:
        previous = connection.execute(
            "SELECT entry_hash FROM audit WHERE project_id = ? ORDER BY seq DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        previous_hash = previous["entry_hash"] if previous else None
        created_at = self._now()
        entry_id = str(uuid4())
        body = {
            "id": entry_id,
            "project_id": project_id,
            "action": action,
            "entity_id": entity_id,
            "created_at": created_at,
            "details": details,
            "previous_hash": previous_hash,
        }
        entry_hash = hashlib.sha256(self._canonical(body).encode("utf-8")).hexdigest()
        connection.execute(
            """
            INSERT INTO audit(
                id, project_id, action, entity_id, created_at, details_json,
                previous_hash, entry_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                project_id,
                action,
                entity_id,
                created_at,
                self._json(details),
                previous_hash,
                entry_hash,
            ),
        )

    def _project_row(self, connection: sqlite3.Connection, project_id: str) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="pilot project not found")
        return row

    def create_project(self, request: ProjectRequest) -> dict:
        project_id = str(uuid4())
        payload = {
            "id": project_id,
            "name": self._clean_text(request.name, "name"),
            "decision": self._clean_text(request.decision, "decision"),
            "scope": self._clean_text(request.scope, "scope"),
            "acceptance_note": self._clean_text(request.acceptance_note, "acceptance_note"),
            "created_at": self._now(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projects(id, name, decision, scope, acceptance_note, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                tuple(payload.values()),
            )
            self._append_audit(
                connection, project_id, "project_created", project_id, {"name": payload["name"]}
            )
        return payload

    def list_projects(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM projects ORDER BY created_at, id").fetchall()
        return [self._project_payload(row) for row in rows]

    def get_project(self, project_id: str) -> dict:
        with self._connect() as connection:
            return self._project_payload(self._project_row(connection, project_id))

    def _raw_path(self, import_id: str) -> Path:
        path = (self.import_dir / f"{import_id}.csv").resolve()
        self._assert_within(path, self.import_dir)
        return path

    def _replay_path(self, import_id: str, name: str) -> Path:
        if name not in {"run.json", "coupled-evidence.json"}:
            raise ValueError("unsupported frozen replay evidence name")
        directory = (self.replay_dir / import_id).resolve()
        self._assert_within(directory, self.replay_dir)
        directory.mkdir(parents=True, exist_ok=True)
        path = (directory / name).resolve()
        self._assert_within(path, directory)
        return path

    def _overlap_issue(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        role: str,
        quality: dict,
        sample_semantics: str,
        rows_data: list[tuple[datetime, float, float | None]],
    ) -> bool:
        if quality["state"] != "valid" or role not in {"calibration", "holdout"}:
            return False
        counterpart = "holdout" if role == "calibration" else "calibration"
        rows = connection.execute(
            "SELECT id, quality_json, sample_semantics FROM imports "
            "WHERE project_id = ? AND role = ?",
            (project_id, counterpart),
        ).fetchall()
        start, end = _coverage_bounds(rows_data, sample_semantics)
        for row in rows:
            other = json.loads(row["quality_json"])
            if other["state"] != "valid":
                continue
            try:
                source_bytes = self._raw_path(row["id"]).read_bytes()
                if hashlib.sha256(source_bytes).hexdigest() != other["sha256"]:
                    raise ValueError("counterpart source hash mismatch")
                parsed = _inspect_csv(source_bytes.decode("utf-8"), source_bytes)
                if parsed["state"] != "valid":
                    raise ValueError("counterpart source quality changed")
                other_start, other_end = _coverage_bounds(
                    parsed["rows_data"], row["sample_semantics"]
                )
            except (OSError, UnicodeDecodeError, ValueError) as exc:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "cannot verify calibration/holdout separation against stored counterpart"
                    ),
                ) from exc
            if start <= other_end and other_start <= end:
                return True
        return False

    def create_import(self, project_id: str, request: ImportRequest) -> dict:
        source_bytes = _source_bytes(request.csv_text)
        if len(source_bytes) > MAX_CSV_BYTES:
            raise HTTPException(status_code=413, detail="csv_text exceeds the 5 MiB upload limit")
        filename = self._clean_text(request.filename, "filename")
        if "/" in filename or "\\" in filename or "\x00" in filename:
            raise HTTPException(status_code=422, detail="filename must not contain a path")
        inspected = _inspect_csv(request.csv_text, source_bytes)
        quality = _public_quality(inspected)
        model_provenance = _model_provenance(
            request.model_run_id, inspected["model_column_present"]
        )
        import_id = str(uuid4())
        raw_path = self._raw_path(import_id)
        created_at = self._now()
        payload = {
            "id": import_id,
            "project_id": project_id,
            "filename": filename,
            "role": request.role,
            "sample_semantics": request.sample_semantics,
            "measurement_boundary": self._clean_text(
                request.measurement_boundary, "measurement_boundary"
            ),
            "source_note": self._clean_text(request.source_note, "source_note"),
            "model_run_id": request.model_run_id,
            "model_provenance": model_provenance,
            "quality": quality,
            "source_import_id": None,
            "replay": None,
            "created_at": created_at,
        }
        with self._connect() as connection:
            self._project_row(connection, project_id)
            if self._overlap_issue(
                connection,
                project_id,
                request.role,
                quality,
                request.sample_semantics,
                inspected["rows_data"],
            ):
                _add_issue(quality["issues"], "calibration_holdout_overlap")
                quality["state"] = "invalid"
            _write_source(raw_path, source_bytes)
            try:
                connection.execute(
                    """
                    INSERT INTO imports(
                        id, project_id, filename, role, sample_semantics, measurement_boundary,
                        source_note, model_run_id, model_provenance_json, quality_json, raw_path,
                        source_import_id, replay_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        import_id,
                        project_id,
                        filename,
                        request.role,
                        request.sample_semantics,
                        payload["measurement_boundary"],
                        payload["source_note"],
                        request.model_run_id,
                        self._json(model_provenance),
                        self._json(quality),
                        raw_path.name,
                        None,
                        None,
                        created_at,
                    ),
                )
                self._append_audit(
                    connection,
                    project_id,
                    "import_created",
                    import_id,
                    {
                        "role": request.role,
                        "quality_state": quality["state"],
                        "source_sha256": quality["sha256"],
                    },
                )
            except Exception:
                raw_path.unlink(missing_ok=True)
                raise
        return payload

    def list_imports(self, project_id: str) -> list[dict]:
        with self._connect() as connection:
            self._project_row(connection, project_id)
            rows = connection.execute(
                "SELECT * FROM imports WHERE project_id = ? ORDER BY created_at, id", (project_id,)
            ).fetchall()
        return [self._import_payload(row) for row in rows]

    def create_replay(self, project_id: str, request: ReplayRequest) -> dict:
        source_import_id = _normalize_uuid(request.import_id, "import_id")
        run_id = _normalize_run_id(request.run_id)
        with self._connect() as connection:
            self._project_row(connection, project_id)
            source = self._import_row(connection, project_id, source_import_id)
            source_quality = json.loads(source["quality_json"])
            if source_quality["state"] != "valid":
                raise HTTPException(status_code=409, detail="source import quality is invalid")
            if source["source_import_id"] is not None:
                raise HTTPException(
                    status_code=409, detail="a replay source must be an original import"
                )
            if source["sample_semantics"] != "interval_end_mean":
                raise HTTPException(
                    status_code=409,
                    detail="replay requires source sample_semantics=interval_end_mean",
                )
            try:
                source_bytes = self._raw_path(source_import_id).read_bytes()
            except OSError as exc:
                raise HTTPException(
                    status_code=409, detail="source raw evidence is unavailable"
                ) from exc
            if hashlib.sha256(source_bytes).hexdigest() != source_quality["sha256"]:
                raise HTTPException(
                    status_code=409, detail="source raw evidence hash does not match metadata"
                )
            try:
                source_text = source_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=409, detail="source raw evidence is not UTF-8"
                ) from exc
            parsed = _inspect_csv(source_text, source_bytes)
            if parsed["state"] != "valid":
                raise HTTPException(
                    status_code=409, detail="source raw evidence no longer passes quality checks"
                )
            model_rows, replay, frozen_evidence = _verified_coupled_series(
                self.base_dir, run_id, request.metric
            )
            source_by_timestamp = {
                _timestamp_text(timestamp): measured
                for timestamp, measured, _ in parsed["rows_data"]
            }
            model_timestamps = [timestamp for timestamp, _ in model_rows]
            if set(source_by_timestamp) != set(model_timestamps) or len(source_by_timestamp) != len(
                model_rows
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "exact full-series UTC timestamp coverage is required; "
                        "interpolation and shifting are refused"
                    ),
                )
            derived_text = _derived_csv(
                [
                    (timestamp, source_by_timestamp[timestamp], model)
                    for timestamp, model in model_rows
                ]
            )
            derived_bytes = derived_text.encode("utf-8")
            quality = _public_quality(_inspect_csv(derived_text, derived_bytes))
            if quality["state"] != "valid":
                raise HTTPException(
                    status_code=409, detail="server-derived replay failed its own quality check"
                )
            import_id = str(uuid4())
            raw_path = self._raw_path(import_id)
            created_at = self._now()
            provenance = {
                "model_column_status": "server_verified_coupled_replay",
                "model_run_id": run_id,
                "artifact_sha256": replay["artifact_sha256"],
                "metric": request.metric,
            }
            payload = {
                "id": import_id,
                "project_id": project_id,
                "filename": f"replay-{source_import_id[:8]}-{run_id[:8]}-{request.metric}.csv",
                "role": source["role"],
                "sample_semantics": "interval_end_mean",
                "measurement_boundary": (
                    "Paired read-only kW comparison: source measured samples and exact coupled "
                    "one-minute interval-end model samples in UTC; no interpolation or time shift."
                ),
                "source_note": (
                    "Server-derived replay; original source import is retained unchanged."
                ),
                "model_run_id": run_id,
                "model_provenance": provenance,
                "quality": quality,
                "source_import_id": source_import_id,
                "replay": replay,
                "created_at": created_at,
            }
            _write_source(raw_path, derived_bytes)
            frozen_paths: list[Path] = []
            try:
                for name, content in frozen_evidence.items():
                    path = self._replay_path(import_id, name)
                    _write_source(path, content)
                    frozen_paths.append(path)
                connection.execute(
                    """
                    INSERT INTO imports(
                        id, project_id, filename, role, sample_semantics, measurement_boundary,
                        source_note, model_run_id, model_provenance_json, quality_json, raw_path,
                        source_import_id, replay_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        import_id,
                        project_id,
                        payload["filename"],
                        source["role"],
                        payload["sample_semantics"],
                        payload["measurement_boundary"],
                        payload["source_note"],
                        run_id,
                        self._json(provenance),
                        self._json(quality),
                        raw_path.name,
                        source_import_id,
                        self._json(replay),
                        created_at,
                    ),
                )
                self._append_audit(
                    connection,
                    project_id,
                    "replay_created",
                    import_id,
                    {
                        "source_import_id": source_import_id,
                        "run_id": run_id,
                        "metric": request.metric,
                        "artifact_sha256": replay["artifact_sha256"],
                    },
                )
            except Exception:
                raw_path.unlink(missing_ok=True)
                for path in frozen_paths:
                    path.unlink(missing_ok=True)
                raise
        return payload

    def _import_row(
        self, connection: sqlite3.Connection, project_id: str, import_id: str
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM imports WHERE project_id = ? AND id = ?", (project_id, import_id)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="pilot import not found")
        return row

    def create_assessment(self, project_id: str, request: AssessmentRequest) -> dict:
        import_id = _normalize_uuid(request.import_id, "import_id")
        with self._connect() as connection:
            self._project_row(connection, project_id)
            imported = self._import_row(connection, project_id, import_id)
            quality = json.loads(imported["quality_json"])
            provenance = json.loads(imported["model_provenance_json"])
            reasons: list[str] = []
            if quality["state"] != "valid":
                reasons.append("import_quality_invalid")
            parsed = None
            if not reasons:
                raw_path = self._raw_path(imported["id"])
                try:
                    source_bytes = raw_path.read_bytes()
                except OSError:
                    reasons.append("source_raw_missing")
                else:
                    if hashlib.sha256(source_bytes).hexdigest() != quality["sha256"]:
                        reasons.append("source_raw_hash_mismatch")
                    else:
                        try:
                            source_text = source_bytes.decode("utf-8")
                        except UnicodeDecodeError:
                            reasons.append("source_raw_not_utf8")
                        else:
                            parsed = _inspect_csv(source_text, source_bytes)
                            if parsed["state"] != "valid":
                                reasons.append("source_revalidation_failed")
            metrics = _empty_metrics()
            if parsed is not None:
                metrics, metric_reasons = _paired_metrics(
                    parsed["rows_data"], imported["sample_semantics"]
                )
                reasons.extend(metric_reasons)
            if provenance["model_column_status"] == "user_supplied_unverified":
                reasons.append("model_provenance_unverified")
            if provenance["model_column_status"] != "server_verified_coupled_replay":
                reasons.append("model_provenance_not_server_verified")
            reasons = list(dict.fromkeys(reasons))
            thresholds = {
                "mae_max_kw": _rounded(request.mae_max_kw),
                "energy_error_max_pct": _rounded(request.energy_error_max_pct),
            }
            if reasons:
                validity_status = "NOT_EVALUABLE"
            elif (
                metrics["time_weighted_mae_kw"] <= thresholds["mae_max_kw"]
                and abs(metrics["energy_error_pct"]) <= thresholds["energy_error_max_pct"]
            ):
                validity_status = "PASS"
            else:
                validity_status = "FAIL"
            assessment_id = str(uuid4())
            created_at = self._now()
            payload = {
                "id": assessment_id,
                "project_id": project_id,
                "import_id": import_id,
                "version": ASSESSMENT_VERSION,
                "validity_status": validity_status,
                "thresholds": thresholds,
                "metrics": metrics,
                "not_evaluable_reasons": reasons,
                "claim_boundary": CLAIM_BOUNDARY,
                "created_at": created_at,
            }
            connection.execute(
                """
                INSERT INTO assessments(
                    id, project_id, import_id, version, validity_status, thresholds_json,
                    metrics_json, reasons_json, claim_boundary, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    assessment_id,
                    project_id,
                    import_id,
                    ASSESSMENT_VERSION,
                    validity_status,
                    self._json(thresholds),
                    self._json(metrics),
                    self._json(reasons),
                    CLAIM_BOUNDARY,
                    created_at,
                ),
            )
            self._append_audit(
                connection,
                project_id,
                "assessment_created",
                assessment_id,
                {
                    "import_id": import_id,
                    "version": ASSESSMENT_VERSION,
                    "validity_status": validity_status,
                    "thresholds": thresholds,
                },
            )
        return payload

    def list_assessments(self, project_id: str) -> list[dict]:
        with self._connect() as connection:
            self._project_row(connection, project_id)
            rows = connection.execute(
                "SELECT * FROM assessments WHERE project_id = ? ORDER BY created_at, id",
                (project_id,),
            ).fetchall()
        return [self._assessment_payload(row) for row in rows]

    def list_audit(self, project_id: str) -> list[dict]:
        with self._connect() as connection:
            self._project_row(connection, project_id)
            rows = connection.execute(
                "SELECT * FROM audit WHERE project_id = ? ORDER BY seq", (project_id,)
            ).fetchall()
        return [
            {
                "id": row["id"],
                "project_id": row["project_id"],
                "action": row["action"],
                "entity_id": row["entity_id"],
                "created_at": row["created_at"],
                "details": json.loads(row["details_json"]),
                "previous_hash": row["previous_hash"],
                "entry_hash": row["entry_hash"],
            }
            for row in rows
        ]

    def package(self, project_id: str) -> bytes:
        project = self.get_project(project_id)
        imports = self.list_imports(project_id)
        assessments = self.list_assessments(project_id)
        audit = self.list_audit(project_id)
        files: dict[str, bytes] = {
            "project.json": _json_bytes(project),
            "imports.json": _json_bytes(imports),
            "assessments.json": _json_bytes(assessments),
            "audit.json": _json_bytes(audit),
            "README.md": _readme().encode("utf-8"),
            "template.csv": TEMPLATE_CSV.encode("utf-8"),
        }
        for imported in imports:
            raw_path = self._raw_path(imported["id"])
            try:
                source = raw_path.read_bytes()
            except OSError as exc:
                raise HTTPException(
                    status_code=409, detail="stored raw evidence is unavailable"
                ) from exc
            if hashlib.sha256(source).hexdigest() != imported["quality"]["sha256"]:
                raise HTTPException(
                    status_code=409, detail="stored raw evidence hash does not match metadata"
                )
            files[f"imports/{imported['id']}.csv"] = source
            if imported["replay"] is not None:
                replay = imported["replay"]
                frozen_files = replay.get("frozen_files") if isinstance(replay, dict) else None
                if not isinstance(frozen_files, dict) or set(frozen_files) != {
                    "run.json",
                    "coupled-evidence.json",
                }:
                    raise HTTPException(status_code=409, detail="replay provenance is incomplete")
                files[f"replays/{imported['id']}/provenance.json"] = _json_bytes(replay)
                for name, expected_hash in frozen_files.items():
                    try:
                        frozen = self._replay_path(imported["id"], name).read_bytes()
                    except OSError as exc:
                        raise HTTPException(
                            status_code=409, detail="frozen replay evidence is unavailable"
                        ) from exc
                    if (
                        not isinstance(expected_hash, str)
                        or hashlib.sha256(frozen).hexdigest() != expected_hash
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail="frozen replay evidence hash does not match provenance",
                        )
                    files[f"replays/{imported['id']}/{name}"] = frozen
        manifest = {
            "files": {
                name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())
            }
        }
        manifest["manifest_sha256"] = hashlib.sha256(
            self._canonical(manifest).encode("utf-8")
        ).hexdigest()
        files["manifest.json"] = _json_bytes(manifest)
        buffer = BytesIO()
        with zipfile.ZipFile(
            buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o600 << 16
                archive.writestr(info, data)
        return buffer.getvalue()


def _source_bytes(csv_text: str) -> bytes:
    try:
        return csv_text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise HTTPException(status_code=422, detail="csv_text must be UTF-8 encodable") from exc


def _write_source(path: Path, source_bytes: bytes) -> None:
    temp_path = path.with_suffix(".tmp")
    with temp_path.open("xb") as handle:
        handle.write(source_bytes)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)


def _normalize_uuid(value: str, field: str) -> str:
    try:
        return str(UUID(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{field} must be a UUID") from exc


def _normalize_run_id(value: str) -> str:
    """RunService persists uuid4().hex directory names, unlike API UUID resource IDs."""
    try:
        return UUID(value).hex
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="run_id must be a UUID") from exc


def _add_issue(issues: list[str], issue: str) -> None:
    if issue not in issues and len(issues) < 32:
        issues.append(issue)


def _timestamp(value: str) -> datetime:
    candidate = value.strip()
    if "T" not in candidate:
        raise ValueError("timestamp_not_iso8601")
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp_timezone_required")
    return parsed.astimezone(timezone.utc)


def _timestamp_text(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def _finite(value: object, issue: str) -> float:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(issue) from exc
    if not math.isfinite(parsed):
        raise ValueError(issue)
    return parsed


def _inspect_csv(csv_text: str, source_bytes: bytes) -> dict:
    issues: list[str] = []
    rows_data: list[tuple[datetime, float, float | None]] = []
    row_count = 0
    model_column_present = False
    try:
        reader = csv.DictReader(StringIO(csv_text, newline=""))
        headers = reader.fieldnames
        if headers is None:
            _add_issue(issues, "csv_header_missing")
        elif len(headers) != len(set(headers)):
            _add_issue(issues, "duplicate_column")
        elif set(headers) - {"timestamp", "measured_kw", "model_kw"}:
            _add_issue(issues, "unexpected_column")
        elif not {"timestamp", "measured_kw"}.issubset(headers):
            _add_issue(issues, "required_column_missing")
        else:
            model_column_present = "model_kw" in headers
            for row_count, row in enumerate(reader, start=1):
                if row_count > MAX_CSV_ROWS:
                    _add_issue(issues, "too_many_rows")
                    break
                if None in row:
                    _add_issue(issues, "unexpected_column_value")
                    continue
                try:
                    timestamp = _timestamp(row.get("timestamp") or "")
                except (TypeError, ValueError) as exc:
                    _add_issue(issues, str(exc))
                    continue
                try:
                    measured = _finite(row.get("measured_kw"), "measured_kw_not_finite")
                except ValueError as exc:
                    _add_issue(issues, str(exc))
                    continue
                model: float | None = None
                if model_column_present and (row.get("model_kw") or "").strip():
                    try:
                        model = _finite(row.get("model_kw"), "model_kw_not_finite")
                    except ValueError as exc:
                        _add_issue(issues, str(exc))
                        continue
                rows_data.append((timestamp, measured, model))
    except csv.Error:
        _add_issue(issues, "csv_parse_error")

    if row_count < 2:
        _add_issue(issues, "too_few_rows")
    timestamps = [row[0] for row in rows_data]
    if len(timestamps) != len(set(timestamps)):
        _add_issue(issues, "duplicate_timestamp")
    deltas: list[float] = []
    for previous, current in zip(timestamps, timestamps[1:]):
        seconds = (current - previous).total_seconds()
        if seconds <= 0:
            _add_issue(issues, "non_monotonic_timestamp")
        else:
            deltas.append(seconds)
    if not issues and len(deltas) >= 2:
        cadence = min(deltas)
        if any(delta > cadence * 1.5 for delta in deltas):
            _add_issue(issues, "timestamp_gap")
    first = timestamps[0] if timestamps and not issues else None
    last = timestamps[-1] if timestamps and not issues else None
    coverage = (last - first).total_seconds() if first is not None and last is not None else None
    return {
        "state": "valid" if not issues else "invalid",
        "issues": issues,
        "rows": row_count,
        "coverage_seconds": _rounded(coverage) if coverage is not None else None,
        "first_timestamp": _timestamp_text(first),
        "last_timestamp": _timestamp_text(last),
        "sha256": hashlib.sha256(source_bytes).hexdigest(),
        "model_column_present": model_column_present,
        "rows_data": rows_data,
    }


def _model_provenance(model_run_id: str | None, model_column_present: bool) -> dict:
    if not model_column_present:
        return {"model_column_status": "not_provided", "model_run_id": None}
    if model_run_id is None:
        return {"model_column_status": "user_supplied_unverified", "model_run_id": None}
    return {
        "model_column_status": "run_reference_recorded_not_independently_verified",
        "model_run_id": model_run_id,
    }


def _public_quality(inspected: dict) -> dict:
    return {
        key: inspected[key]
        for key in (
            "state",
            "issues",
            "rows",
            "coverage_seconds",
            "first_timestamp",
            "last_timestamp",
            "sha256",
        )
    }


def _coverage_bounds(
    rows: list[tuple[datetime, float, float | None]], sample_semantics: str
) -> tuple[datetime, datetime]:
    if len(rows) < 2:
        raise ValueError("at least two rows are required for coverage bounds")
    first, last = rows[0][0], rows[-1][0]
    if sample_semantics == "point_samples":
        return first, last
    if sample_semantics != "interval_end_mean":
        raise ValueError("unknown sample semantics")
    first_interval_seconds = (rows[1][0] - first).total_seconds()
    if first_interval_seconds <= 0:
        raise ValueError("interval-end timestamps are not monotonic")
    # The first timestamp labels the end of its own interval, not its start.
    return first - timedelta(seconds=first_interval_seconds), last


def _verified_coupled_series(
    base_dir: Path,
    run_id: str,
    metric: str,
) -> tuple[list[tuple[str, float]], dict, dict[str, bytes]]:
    """Read only a completed, sealed coupled artifact; never accept caller model values."""
    if metric not in REPLAY_METRICS:
        raise HTTPException(status_code=422, detail="unsupported coupled replay metric")
    try:
        # Keep ordinary import/list endpoints usable when optional runtime dependencies are absent.
        from ..storage import FileStorage, StorageError

        storage = FileStorage(base_dir)
        record = storage.get_run_record(run_id)
    except (ImportError, ModuleNotFoundError) as exc:
        raise HTTPException(
            status_code=503, detail="run safety verification dependency is unavailable"
        ) from exc
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="coupled run not found") from exc

    if (
        record.status.state.value != "completed"
        or record.scenario_snapshot is None
        or record.scenario_snapshot.domain != "airport_coupled_v1"
        or record.summary is None
        or record.summary.domain != "airport_coupled_v1"
    ):
        raise HTTPException(status_code=409, detail="run is not a completed coupled result")
    try:
        safety = _run_safety_audit(storage, run_id)
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="coupled run safety verification failed"
        ) from exc
    if not all(
        safety.get(key) is True
        for key in (
            "fingerprint_match",
            "artifact_hashes_match",
            "report_consistent_match",
            "reports_hashed",
        )
    ):
        raise HTTPException(status_code=409, detail="coupled run safety receipt is not verified")
    expected_hash = record.build_meta.get("result_artifact_hashes", {}).get("coupled-evidence.json")
    artifact_path = storage.run_dir(run_id) / "coupled-evidence.json"
    run_path = storage.runs_dir / run_id / "run.json"
    try:
        artifact = artifact_path.read_bytes()
        run_record = run_path.read_bytes()
    except OSError as exc:
        raise HTTPException(
            status_code=409, detail="frozen coupled replay evidence is unavailable"
        ) from exc
    actual_hash = hashlib.sha256(artifact).hexdigest()
    if not isinstance(expected_hash, str) or actual_hash != expected_hash:
        raise HTTPException(
            status_code=409, detail="coupled evidence artifact hash is not verified"
        )
    try:
        evidence = json.loads(artifact)
        origin = _timestamp(evidence["day_start_utc"])
        series = evidence["series"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=409, detail="coupled evidence artifact is malformed"
        ) from exc
    if not isinstance(series, list) or not series:
        raise HTTPException(status_code=409, detail="coupled evidence contains no series")
    rows: list[tuple[str, float]] = []
    seen: set[str] = set()
    for row in series:
        try:
            minute = _finite(row["minute"], "minute_not_finite")
            value = _finite(row[metric], "metric_not_finite")
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=409, detail="coupled evidence series is malformed"
            ) from exc
        if not minute.is_integer():
            raise HTTPException(status_code=409, detail="coupled evidence minute is not integral")
        timestamp = _timestamp_text(origin + timedelta(minutes=int(minute)))
        assert timestamp is not None
        if timestamp in seen:
            raise HTTPException(status_code=409, detail="coupled evidence has duplicate timestamps")
        seen.add(timestamp)
        rows.append((timestamp, value))
    if rows != sorted(rows, key=lambda row: row[0]):
        raise HTTPException(status_code=409, detail="coupled evidence timestamps are not monotonic")
    frozen_files = {
        "run.json": hashlib.sha256(run_record).hexdigest(),
        "coupled-evidence.json": actual_hash,
    }
    artifact_hashes = record.build_meta.get("result_artifact_hashes")
    if not isinstance(artifact_hashes, dict) or not all(
        isinstance(name, str) and isinstance(value, str) and len(value) == 64
        for name, value in artifact_hashes.items()
    ):
        raise HTTPException(status_code=409, detail="coupled run artifact hash manifest is invalid")
    return (
        rows,
        {
            "run_id": run_id,
            "metric": metric,
            "source_artifact": "coupled-evidence.json",
            "artifact_sha256": actual_hash,
            "day_start_utc": _timestamp_text(origin),
            "alignment": "exact_full_series_interval_end_utc",
            "sample_count": len(rows),
            "safety_receipt": "RunService.get_run_safety verified",
            "run_record_sha256": frozen_files["run.json"],
            "run_artifact_hashes": dict(sorted(artifact_hashes.items())),
            "frozen_files": frozen_files,
        },
        {"run.json": run_record, "coupled-evidence.json": artifact},
    )


def _run_safety_audit(storage, run_id: str) -> dict:
    from ..config import Settings
    from ..run_service import RunService

    return RunService(storage, Settings.load()).get_run_safety(run_id).audit


def _derived_csv(rows: list[tuple[str, float, float]]) -> str:
    output = StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["timestamp", "measured_kw", "model_kw"])
    for timestamp, measured, model in rows:
        writer.writerow([timestamp, format(measured, ".15g"), format(model, ".15g")])
    return output.getvalue()


def _empty_metrics() -> dict:
    return {
        "time_weighted_mae_kw": None,
        "time_weighted_bias_kw": None,
        "energy_error_pct": None,
        "paired_coverage_seconds": None,
    }


def _paired_metrics(
    rows: list[tuple[datetime, float, float | None]],
    sample_semantics: str,
) -> tuple[dict, list[str]]:
    if len(rows) < 2:
        return _empty_metrics(), ["too_few_paired_rows"]
    if any(model is None for _, _, model in rows):
        return _empty_metrics(), ["model_kw_column_missing_or_incomplete"]
    if sample_semantics not in {"point_samples", "interval_end_mean"}:
        return _empty_metrics(), ["sample_semantics_unknown"]
    deltas = [(end - start).total_seconds() for (start, _, _), (end, _, _) in zip(rows, rows[1:])]
    if any(seconds <= 0 for seconds in deltas):
        return _empty_metrics(), ["paired_timestamps_not_monotonic"]
    if sample_semantics == "interval_end_mean" and any(
        not math.isclose(seconds, deltas[0], rel_tol=0, abs_tol=1e-6) for seconds in deltas[1:]
    ):
        return _empty_metrics(), ["interval_end_mean_requires_regular_intervals"]
    weighted_mae = 0.0
    weighted_bias = 0.0
    measured_energy = 0.0
    model_energy = 0.0
    absolute_measured_energy = 0.0
    duration = 0.0
    if sample_semantics == "point_samples":
        for (start, measured_start, model_start), (end, measured_end, model_end) in zip(
            rows, rows[1:]
        ):
            seconds = (end - start).total_seconds()
            assert model_start is not None and model_end is not None
            error_start = model_start - measured_start
            error_end = model_end - measured_end
            weighted_mae += (abs(error_start) + abs(error_end)) * 0.5 * seconds
            weighted_bias += (error_start + error_end) * 0.5 * seconds
            measured_energy += (measured_start + measured_end) * 0.5 * seconds / 3600
            model_energy += (model_start + model_end) * 0.5 * seconds / 3600
            absolute_measured_energy += (
                (abs(measured_start) + abs(measured_end)) * 0.5 * seconds / 3600
            )
            duration += seconds
    else:
        # Coupled evidence labels each row at the end of the interval it summarizes.
        first_seconds = deltas[0]
        for index, (_, measured, model) in enumerate(rows):
            assert model is not None
            seconds = first_seconds if index == 0 else deltas[index - 1]
            error = model - measured
            weighted_mae += abs(error) * seconds
            weighted_bias += error * seconds
            measured_energy += measured * seconds / 3600
            model_energy += model * seconds / 3600
            absolute_measured_energy += abs(measured) * seconds / 3600
            duration += seconds
    if duration <= 0:
        return _empty_metrics(), ["paired_coverage_missing"]
    if math.isclose(absolute_measured_energy, 0.0, abs_tol=1e-12):
        return _empty_metrics(), ["measured_energy_zero"]
    if abs(measured_energy) <= max(1e-9, absolute_measured_energy * 0.01):
        return _empty_metrics(), ["measured_energy_signed_cancellation"]
    return (
        {
            "time_weighted_mae_kw": _rounded(weighted_mae / duration),
            "time_weighted_bias_kw": _rounded(weighted_bias / duration),
            "energy_error_pct": _rounded(
                (model_energy - measured_energy) / abs(measured_energy) * 100
            ),
            "paired_coverage_seconds": _rounded(duration),
        },
        [],
    )


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")


def _readme() -> str:
    return """# Airport Twin Core Pilot Evidence Package

## Scope

This package records a bounded, read-only comparison of exported kW samples. It contains no
actuation command, live connector, hardware write, safety release, or operational optimization
claim.
The Airport Twin model remains an uncalibrated methods prototype.

## Test Protocol

1. Agree the decision, scope, measurement boundary, and acceptance thresholds before assessment.
2. Export a read-only CSV with timezone-aware ISO timestamps and finite `measured_kw` values.
   Uploads declare `sample_semantics`: `point_samples` (default) uses trapezoidal intervals;
   `interval_end_mean` labels each value as the mean over the preceding interval.
   Point-sample MAE and bias are discrete-error trapezoidal approximations, not a claim that a
   continuous linear signal exists between samples.
3. Keep calibration and holdout time ranges disjoint. Gaps, duplicates, non-monotonic timestamps,
   missing timezone information, and non-finite values are invalid and cannot result in PASS.
4. `model_kw` is optional. Signed kW values are allowed to preserve the source system's directional
   convention. Every uploaded model value and `model_run_id` is user-supplied and unverified;
   descriptive metrics may be shown but the assessment is NOT_EVALUABLE.
5. A server replay requires `interval_end_mean` and may derive `model_kw` only from a completed
   coupled run with a positive `RunService.get_run_safety` receipt and a matching sealed
   `coupled-evidence.json` hash. Source timestamps must exactly cover every UTC interval-end
   sample; interpolation and shifts are refused.
6. A PASS is only a frozen numerical check against the stored thresholds for a server-derived
   replay. It is not empirical model validation, safety validation, a claim about airport
   operations, or permission to actuate anything.

## Integrity

`manifest.json` supplies SHA-256 hashes for every package file and a canonical manifest hash.
`audit.json` is append-only, hash-linked metadata for project, import, and assessment mutations.
Each replay additionally includes its frozen `run.json`, sealed `coupled-evidence.json`, and
provenance receipt with the complete execution artifact-hash manifest. This supports
reproducibility only; it does not establish empirical agreement, calibration, safety, or
operational validity.
"""


def create_router(base_dir: Path) -> APIRouter:
    store = EvidenceStore(base_dir)
    router = APIRouter(prefix="/api/v1/pilot", tags=["Airport pilot evidence (read-only)"])

    @router.get("/projects")
    def list_projects() -> list[dict]:
        return store.list_projects()

    @router.post("/projects", status_code=201)
    def create_project(request: ProjectRequest) -> dict:
        return store.create_project(request)

    @router.get("/projects/{project_id}")
    def get_project(project_id: str) -> dict:
        return store.get_project(_normalize_uuid(project_id, "project_id"))

    @router.post("/projects/{project_id}/imports", status_code=201)
    def create_import(project_id: str, request: ImportRequest):
        payload = store.create_import(_normalize_uuid(project_id, "project_id"), request)
        if payload["quality"]["state"] == "invalid":
            return JSONResponse(status_code=422, content=payload)
        return payload

    @router.get("/projects/{project_id}/imports")
    def list_imports(project_id: str) -> list[dict]:
        return store.list_imports(_normalize_uuid(project_id, "project_id"))

    @router.post("/projects/{project_id}/replays", status_code=201)
    def create_replay(project_id: str, request: ReplayRequest) -> dict:
        return store.create_replay(_normalize_uuid(project_id, "project_id"), request)

    @router.post("/projects/{project_id}/assessments", status_code=201)
    def create_assessment(project_id: str, request: AssessmentRequest) -> dict:
        return store.create_assessment(_normalize_uuid(project_id, "project_id"), request)

    @router.get("/projects/{project_id}/assessments")
    def list_assessments(project_id: str) -> list[dict]:
        return store.list_assessments(_normalize_uuid(project_id, "project_id"))

    @router.get("/projects/{project_id}/audit")
    def list_audit(project_id: str) -> list[dict]:
        return store.list_audit(_normalize_uuid(project_id, "project_id"))

    @router.get("/projects/{project_id}/package")
    def package(project_id: str) -> Response:
        normalized_id = _normalize_uuid(project_id, "project_id")
        return Response(
            store.package(normalized_id),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="airport-pilot-{normalized_id}.zip"'
            },
        )

    @router.get("/template.csv")
    def template() -> Response:
        return Response(
            TEMPLATE_CSV,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="airport-pilot-template.csv"'},
        )

    return router
