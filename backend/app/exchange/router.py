"""Austausch-Endpunkte je Projekt (Airport Energy Check), siehe docs/EXCHANGE_API.md."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
import zipfile
from io import BytesIO, StringIO
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ..instance_access import EXCHANGE_ROLES
from ..pilot.router import EvidenceStore, _normalize_uuid, _verified_coupled_series
from . import library
from .situation import build_situation, empty_situation

NOTICE = "Versuchsentwurf, Freigabe separat. Strikt read-only, keine Hardwarewrites."
EVIDENCE_LEVELS = ("assumption", "synthetic", "model_checked", "empirical_open", "empirical_pass")
LINK_KINDS = ("flight_plan_snapshot", "coupled_run", "robustness_suite", "flexlab_run")
PROFILE_METRICS = ("ground_charging_kw", "grid_import_kw", "parking_kw")
RUN_ID = re.compile(r"^[a-f0-9]{32}$")
SNAPSHOT_ID = re.compile(r"^[a-f0-9]{64}$")
SUITE_ID = re.compile(r"^[a-f0-9]{32}$")
# Erlaubte Statusuebergaenge einer Testanfrage (nur Rolle lab/admin).
TRANSITIONS = {
    "proposed": {"accepted", "rejected"},
    "accepted": {"scheduled", "rejected"},
    "scheduled": {"done", "rejected"},
    "done": set(),
    "rejected": set(),
}


class Actor(BaseModel):
    user: str | None
    role: str | None
    source: str


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["flight_plan_snapshot", "coupled_run", "robustness_suite", "flexlab_run"]
    ref_id: str = Field(min_length=1, max_length=128)
    note: str = Field(default="", max_length=1_000)


class ItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    type: Literal["scenario_package", "test_request", "lab_result"]
    # scenario_package
    title: str | None = Field(default=None, max_length=200)
    direction: Literal["airport_to_lab", "lab_to_airport"] | None = None
    flight_plan_snapshot_id: str | None = Field(default=None, max_length=64)
    scenario_id: str | None = Field(default=None, max_length=128)
    variant: str | None = Field(default=None, max_length=128)
    parameters: dict[str, float | int | str | bool] = Field(default_factory=dict, max_length=64)
    run_ids: list[str] = Field(default_factory=list, max_length=16)
    # test_request
    question: str | None = Field(default=None, max_length=2_000)
    component: str | None = Field(default=None, max_length=500)
    scenario_package_id: str | None = Field(default=None, max_length=64)
    # lab_result
    test_request_id: str | None = Field(default=None, max_length=64)
    flexlab_run_id: str | None = Field(default=None, max_length=64)
    pilot_assessment_id: str | None = Field(default=None, max_length=64)
    summary: str | None = Field(default=None, max_length=4_000)
    note: str = Field(default="", max_length=2_000)


class TransitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to: Literal["accepted", "scheduled", "done", "rejected"]
    reason: str = Field(default="", max_length=2_000)


class CommentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4_000)


class AdoptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str
    note: str = Field(default="", max_length=2_000)


def _canonical(payload: object) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def content_hash(content: dict) -> str:
    return hashlib.sha256(_canonical(content).encode("utf-8")).hexdigest()


def _clean(value: str | None, field: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{field} must not be blank")
    return cleaned


def _forbid(actor: Actor, allowed: set[str], action: str) -> None:
    if actor.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"role_forbidden: {action} requires {'|'.join(sorted(allowed))}",
        )


def flexlab_evidence(record) -> str:
    """FlexLab-Messdaten bleiben empirical_open; nur Pilot-Holdout-PASS ist empirical_pass."""
    return "synthetic" if record.source == "simulation" else "empirical_open"


def assessment_evidence(assessment: dict) -> str:
    if (
        assessment.get("validity_status") == "PASS"
        and assessment.get("evaluation_kind") == "holdout_validation"
    ):
        return "empirical_pass"
    return "empirical_open"


class ExchangeStore:
    def __init__(self, pilot: EvidenceStore, storage, lab_service, plans):
        self.pilot = pilot
        self.storage = storage
        self.lab = lab_service
        self.plans = plans
        self.base_dir = storage.base_dir
        with self.pilot._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS project_links (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    kind TEXT NOT NULL,
                    ref_id TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(project_id, kind, ref_id)
                );
                CREATE TABLE IF NOT EXISTS exchange_items (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    type TEXT NOT NULL
                        CHECK(type IN ('scenario_package', 'test_request', 'lab_result')),
                    direction TEXT NOT NULL
                        CHECK(direction IN ('airport_to_lab', 'lab_to_airport')),
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    content_json TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    test_request_id TEXT REFERENCES exchange_items(id),
                    evidence_level TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS exchange_items_by_project
                    ON exchange_items(project_id, created_at, id);
                CREATE TRIGGER IF NOT EXISTS exchange_content_frozen
                BEFORE UPDATE OF content_json, content_sha256, type, project_id
                ON exchange_items BEGIN
                    SELECT RAISE(ABORT, 'exchange item content is frozen');
                END;
                CREATE TABLE IF NOT EXISTS exchange_comments (
                    id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL REFERENCES exchange_items(id),
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    text TEXT NOT NULL,
                    created_by_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS exchange_comments_by_item
                    ON exchange_comments(item_id, created_at, id);
                """
            )

    # ---- Hilfen -------------------------------------------------------------
    def _audit(self, connection, project_id: str, action: str, entity_id: str,
               actor: Actor, details: dict) -> None:
        self.pilot._append_audit(
            connection,
            project_id,
            f"exchange_{action}",
            entity_id,
            {**details, "actor": actor.user, "role": actor.role, "actor_source": actor.source},
        )

    def _project(self, connection, project_id: str) -> sqlite3.Row:
        return self.pilot._project_row(connection, project_id)

    @staticmethod
    def _item_payload(row: sqlite3.Row) -> dict:
        content = json.loads(row["content_json"])
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "type": row["type"],
            "direction": row["direction"],
            "status": row["status"],
            "status_reason": row["status_reason"],
            "content": content,
            "content_sha256": row["content_sha256"],
            "hash_valid": content_hash(content) == row["content_sha256"],
            "links": {"test_request_id": row["test_request_id"]},
            "evidence_level": row["evidence_level"],
            "created_by": json.loads(row["created_by_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "notice": NOTICE,
        }

    def _item_row(self, connection, project_id: str, item_id: str) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM exchange_items WHERE id = ? AND project_id = ?",
            (item_id, project_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="exchange item not found")
        return row

    def _run_record(self, run_id: str):
        if not RUN_ID.fullmatch(run_id):
            raise HTTPException(status_code=422, detail="run_id must be a 32-char hex id")
        from ..storage import StorageError

        try:
            return self.storage.get_run_record(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc

    def _flight_plan(self, snapshot_id: str):
        if not SNAPSHOT_ID.fullmatch(snapshot_id):
            raise HTTPException(status_code=422, detail="flight_plan_snapshot_id invalid")
        try:
            return self.plans.get(snapshot_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="flight plan snapshot not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    def _flexlab(self, run_id: str):
        try:
            return self.lab.get(run_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="FlexLab run not found") from exc

    def _suite(self, suite_id: str) -> dict:
        if not SUITE_ID.fullmatch(suite_id):
            raise HTTPException(status_code=422, detail="suite_id invalid")
        path = self.base_dir / "munich" / "robustness_suites" / f"{suite_id}.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="robustness suite not found")
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _is_coupled(record) -> bool:
        return (
            record.scenario_snapshot is not None
            and record.scenario_snapshot.domain == "airport_coupled_v1"
        )

    # ---- Verknuepfungen -------------------------------------------------------
    def _validate_ref(self, kind: str, ref_id: str) -> str:
        if kind == "flight_plan_snapshot":
            self._flight_plan(ref_id)
        elif kind == "coupled_run":
            if not self._is_coupled(self._run_record(ref_id)):
                raise HTTPException(status_code=409, detail="run is not a coupled run")
        elif kind == "robustness_suite":
            self._suite(ref_id)
        elif kind == "flexlab_run":
            ref_id = _normalize_uuid(ref_id, "ref_id")
            self._flexlab(ref_id)
        return ref_id

    def add_link(self, project_id: str, request: LinkRequest, actor: Actor) -> dict:
        _forbid(actor, EXCHANGE_ROLES, "link")
        ref_id = self._validate_ref(request.kind, request.ref_id.strip())
        payload = {
            "id": str(uuid4()),
            "project_id": project_id,
            "kind": request.kind,
            "ref_id": ref_id,
            "note": request.note.strip(),
            "created_by": actor.model_dump(),
            "created_at": self.pilot._now(),
        }
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            try:
                connection.execute(
                    "INSERT INTO project_links(id, project_id, kind, ref_id, note, "
                    "created_by_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (payload["id"], project_id, request.kind, ref_id, payload["note"],
                     _canonical(payload["created_by"]), payload["created_at"]),
                )
            except sqlite3.IntegrityError as exc:
                raise HTTPException(status_code=409, detail="link already exists") from exc
            self._audit(connection, project_id, "link_added", payload["id"], actor,
                        {"kind": request.kind, "ref_id": ref_id})
        return payload

    def list_links(self, project_id: str) -> list[dict]:
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            rows = connection.execute(
                "SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at, id",
                (project_id,),
            ).fetchall()
        return [
            {
                "id": row["id"], "project_id": row["project_id"], "kind": row["kind"],
                "ref_id": row["ref_id"], "note": row["note"],
                "created_by": json.loads(row["created_by_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    # ---- Uebersicht -------------------------------------------------------------
    def _element(self, kind: str, ref_id: str) -> dict:
        element = {"kind": kind, "ref_id": ref_id, "title": ref_id, "status": "missing",
                   "evidence_level": "assumption", "detail": None}
        try:
            if kind == "flight_plan_snapshot":
                plan = self._flight_plan(ref_id)
                element.update(title=f"Flugplan {plan.service_date}", status="available",
                               detail=plan.evidence_level, sha256=plan.content_sha256)
            elif kind == "coupled_run":
                record = self._run_record(ref_id)
                state = record.status.state.value
                element.update(
                    title=f"Gekoppelter Lauf {ref_id[:8]}", status=state,
                    evidence_level="model_checked" if state == "completed" else "assumption",
                    detail="schedule_driven_assumptions_uncalibrated",
                    policy=(record.model_pack_snapshot.parameter_set.get("policy")
                            if record.model_pack_snapshot else None),
                )
            elif kind == "robustness_suite":
                suite = self._suite(ref_id)
                run_ids = [run["run_id"] for scenario in suite.get("scenarios", [])
                           for run in scenario.get("runs", [])]
                states = []
                for run_id in run_ids:
                    try:
                        states.append(self._run_record(run_id).status.state.value)
                    except HTTPException:
                        states.append("missing")
                done = bool(states) and all(state == "completed" for state in states)
                element.update(
                    title=f"Robustheits-Suite {ref_id[:8]}",
                    status="completed" if done else "incomplete",
                    evidence_level="model_checked" if done else "assumption",
                    detail=f"{states.count('completed')}/{len(states)} Laeufe abgeschlossen",
                )
            elif kind == "flexlab_run":
                record = self._flexlab(ref_id)
                element.update(
                    title=record.label, status=record.state,
                    verdict=record.analysis.verdict if record.analysis else None,
                    evidence_level=flexlab_evidence(record),
                    detail="FlexLab-Verdict ist keine Projektabnahme; PASS nur ueber Holdout.",
                    sha256=record.source_sha256,
                )
        except HTTPException:
            pass
        return element

    def overview(self, project_id: str) -> dict:
        project = self.pilot.get_project(project_id)
        elements = [self._element(link["kind"], link["ref_id"])
                    for link in self.list_links(project_id)]
        for assessment in self.pilot.list_assessments(project_id):
            elements.append({
                "kind": "pilot_assessment", "ref_id": assessment["id"],
                "title": f"Pilot-Bewertung {assessment['evaluation_kind']}",
                "status": assessment["validity_status"],
                "evidence_level": assessment_evidence(assessment),
                "detail": assessment["claim_boundary"],
            })
        for item in self.list_items(project_id):
            elements.append({
                "kind": "exchange_item", "ref_id": item["id"], "item_type": item["type"],
                "title": item["content"].get("title") or item["content"].get("question")
                or item["type"],
                "status": item["status"], "evidence_level": item["evidence_level"],
                "detail": item["direction"], "sha256": item["content_sha256"],
            })
        summary = {level: 0 for level in EVIDENCE_LEVELS}
        for element in elements:
            summary[element["evidence_level"]] += 1
        return {
            "project": project,
            "acceptance": self.pilot.get_tolerances(project_id),
            "elements": elements,
            "evidence_summary": summary,
            "notice": NOTICE,
        }

    # ---- Items ---------------------------------------------------------------
    def list_items(self, project_id: str, item_type: str | None = None) -> list[dict]:
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            query = "SELECT * FROM exchange_items WHERE project_id = ?"
            params: tuple = (project_id,)
            if item_type:
                query += " AND type = ?"
                params += (item_type,)
            rows = connection.execute(query + " ORDER BY created_at, id", params).fetchall()
        return [self._item_payload(row) for row in rows]

    def get_item(self, project_id: str, item_id: str) -> dict:
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            return self._item_payload(self._item_row(connection, project_id, item_id))

    def _insert_item(self, project_id: str, item_type: str, direction: str, status: str,
                     content: dict, evidence: str, actor: Actor,
                     test_request_id: str | None = None) -> dict:
        item_id = str(uuid4())
        now = self.pilot._now()
        sha256 = content_hash(content)
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            connection.execute(
                """
                INSERT INTO exchange_items(id, project_id, type, direction, status,
                    status_reason, content_json, content_sha256, test_request_id,
                    evidence_level, created_by_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                """,
                (item_id, project_id, item_type, direction, status, _canonical(content),
                 sha256, test_request_id, evidence, _canonical(actor.model_dump()), now, now),
            )
            self._audit(connection, project_id, f"{item_type}_created", item_id, actor,
                        {"content_sha256": sha256, "direction": direction})
        return self.get_item(project_id, item_id)

    def _scenario_package(self, project_id: str, request: ItemRequest, actor: Actor) -> dict:
        _forbid(actor, EXCHANGE_ROLES, "scenario_package")
        if actor.role == "airport":
            if request.direction not in (None, "airport_to_lab"):
                raise HTTPException(status_code=403, detail="role_forbidden: airport sends to lab")
            direction = "airport_to_lab"
        elif actor.role == "lab":
            if request.direction not in (None, "lab_to_airport"):
                raise HTTPException(status_code=403, detail="role_forbidden: lab sends to airport")
            direction = "lab_to_airport"
        else:
            direction = request.direction or "airport_to_lab"
        if not request.flight_plan_snapshot_id and not request.scenario_id:
            raise HTTPException(
                status_code=422, detail="flight_plan_snapshot_id or scenario_id required"
            )
        content: dict = {
            "title": _clean(request.title, "title"),
            "flight_plan": None,
            "scenario": None,
            "variant": request.variant,
            "parameters": dict(sorted(request.parameters.items())),
            "runs": [],
            "note": request.note.strip(),
            "notice": NOTICE,
        }
        if request.flight_plan_snapshot_id:
            plan = self._flight_plan(request.flight_plan_snapshot_id)
            content["flight_plan"] = {
                "snapshot_id": plan.snapshot_id,
                "content_sha256": plan.content_sha256,
                "service_date": str(plan.service_date),
            }
        if request.scenario_id:
            _, sha256 = library.scenario_file(request.scenario_id)
            content["scenario"] = {"scenario_id": request.scenario_id, "file_sha256": sha256,
                                   "data_status": "synthetic"}
        all_checked = bool(request.run_ids)
        for run_id in dict.fromkeys(request.run_ids):
            record = self._run_record(run_id)
            coupled = self._is_coupled(record)
            completed = record.status.state.value == "completed"
            all_checked = all_checked and coupled and completed
            content["runs"].append({
                "run_id": run_id,
                "state": record.status.state.value,
                "coupled": coupled,
                "evidence_sha256": record.build_meta.get("result_artifact_hashes", {}).get(
                    "coupled-evidence.json"
                ),
            })
        evidence = "model_checked" if all_checked else "synthetic"
        return self._insert_item(project_id, "scenario_package", direction, "frozen",
                                 content, evidence, actor)

    def _test_request(self, project_id: str, request: ItemRequest, actor: Actor) -> dict:
        _forbid(actor, {"airport", "admin"}, "test_request")
        package_id = _normalize_uuid(request.scenario_package_id or "", "scenario_package_id")
        package = self.get_item(project_id, package_id)
        if package["type"] != "scenario_package":
            raise HTTPException(status_code=422, detail="scenario_package_id is not a package")
        tolerances = self.pilot.get_tolerances(project_id)
        if not tolerances or not tolerances["locked"]:
            raise HTTPException(status_code=409, detail="acceptance_criteria_not_locked")
        content = {
            "question": _clean(request.question, "question"),
            "component": _clean(request.component, "component"),
            "scenario_package": {"id": package_id, "content_sha256": package["content_sha256"]},
            "acceptance_criteria": {"sha256": tolerances["sha256"],
                                    "locked_at": tolerances["locked_at"]},
            "note": request.note.strip(),
            "notice": NOTICE,
        }
        return self._insert_item(project_id, "test_request", "airport_to_lab", "proposed",
                                 content, "assumption", actor)

    def _lab_result(self, project_id: str, request: ItemRequest, actor: Actor) -> dict:
        _forbid(actor, {"lab", "admin"}, "lab_result")
        test_id = _normalize_uuid(request.test_request_id or "", "test_request_id")
        test = self.get_item(project_id, test_id)
        if test["type"] != "test_request":
            raise HTTPException(status_code=422, detail="test_request_id is not a test_request")
        if test["status"] not in {"accepted", "scheduled", "done"}:
            raise HTTPException(status_code=409, detail="test_request not accepted")
        if not request.flexlab_run_id and not request.pilot_assessment_id:
            raise HTTPException(
                status_code=422, detail="flexlab_run_id or pilot_assessment_id required"
            )
        levels: list[str] = []
        content: dict = {"test_request": {"id": test_id,
                                          "content_sha256": test["content_sha256"]},
                         "flexlab": None, "pilot_assessment": None,
                         "summary": (request.summary or "").strip(), "notice": NOTICE}
        if request.flexlab_run_id:
            record = self._flexlab(_normalize_uuid(request.flexlab_run_id, "flexlab_run_id"))
            analysis = record.analysis.model_dump(mode="json") if record.analysis else None
            content["flexlab"] = {
                "run_id": record.run_id,
                "state": record.state,
                "source": record.source,
                "verdict": analysis["verdict"] if analysis else None,
                "analysis_sha256": content_hash(analysis) if analysis else None,
                "source_sha256": record.source_sha256,
                "comparison_key": record.comparison_key,
            }
            levels.append(flexlab_evidence(record))
        if request.pilot_assessment_id:
            assessment_id = _normalize_uuid(request.pilot_assessment_id, "pilot_assessment_id")
            assessment = next((a for a in self.pilot.list_assessments(project_id)
                               if a["id"] == assessment_id), None)
            if assessment is None:
                raise HTTPException(status_code=404, detail="pilot assessment not found")
            content["pilot_assessment"] = {
                "id": assessment_id,
                "validity_status": assessment["validity_status"],
                "evaluation_kind": assessment["evaluation_kind"],
                "assessment_sha256": content_hash(assessment),
            }
            levels.append(assessment_evidence(assessment))
        evidence = max(levels, key=EVIDENCE_LEVELS.index)
        return self._insert_item(project_id, "lab_result", "lab_to_airport", "reported",
                                 content, evidence, actor, test_request_id=test_id)

    def create_item(self, project_id: str, request: ItemRequest, actor: Actor) -> dict:
        self.pilot.get_project(project_id)
        if request.type == "scenario_package":
            return self._scenario_package(project_id, request, actor)
        if request.type == "test_request":
            return self._test_request(project_id, request, actor)
        return self._lab_result(project_id, request, actor)

    def transition(self, project_id: str, item_id: str, request: TransitionRequest,
                   actor: Actor) -> dict:
        _forbid(actor, {"lab", "admin"}, "transition")
        reason = request.reason.strip()
        if request.to == "rejected" and not reason:
            raise HTTPException(status_code=422, detail="reason required for rejection")
        with self.pilot._connect() as connection:
            row = self._item_row(connection, project_id, item_id)
            if row["type"] != "test_request":
                raise HTTPException(status_code=409, detail="only test_request has a workflow")
            if request.to not in TRANSITIONS[row["status"]]:
                raise HTTPException(
                    status_code=409,
                    detail=f"invalid transition {row['status']} -> {request.to}",
                )
            if request.to == "done":
                result = connection.execute(
                    "SELECT 1 FROM exchange_items WHERE type = 'lab_result' "
                    "AND test_request_id = ? LIMIT 1", (item_id,),
                ).fetchone()
                if result is None:
                    raise HTTPException(status_code=409, detail="done requires a lab_result")
            connection.execute(
                "UPDATE exchange_items SET status = ?, status_reason = ?, updated_at = ? "
                "WHERE id = ?",
                (request.to, reason or None, self.pilot._now(), item_id),
            )
            self._audit(connection, project_id, "test_request_transition", item_id, actor,
                        {"from": row["status"], "to": request.to, "reason": reason or None})
        return self.get_item(project_id, item_id)

    # ---- Kommentare -------------------------------------------------------------
    def add_comment(self, project_id: str, item_id: str, request: CommentRequest,
                    actor: Actor) -> dict:
        _forbid(actor, EXCHANGE_ROLES, "comment")
        payload = {"id": str(uuid4()), "item_id": item_id, "project_id": project_id,
                   "text": _clean(request.text, "text"), "created_by": actor.model_dump(),
                   "created_at": self.pilot._now()}
        with self.pilot._connect() as connection:
            self._item_row(connection, project_id, item_id)
            connection.execute(
                "INSERT INTO exchange_comments(id, item_id, project_id, text, created_by_json, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (payload["id"], item_id, project_id, payload["text"],
                 _canonical(payload["created_by"]), payload["created_at"]),
            )
            self._audit(connection, project_id, "comment_added", payload["id"], actor,
                        {"item_id": item_id,
                         "text_sha256": hashlib.sha256(payload["text"].encode()).hexdigest()})
        return payload

    def list_comments(self, project_id: str, item_id: str | None = None) -> list[dict]:
        with self.pilot._connect() as connection:
            self._project(connection, project_id)
            if item_id:
                self._item_row(connection, project_id, item_id)
                rows = connection.execute(
                    "SELECT * FROM exchange_comments WHERE item_id = ? ORDER BY created_at, id",
                    (item_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM exchange_comments WHERE project_id = ? "
                    "ORDER BY created_at, id", (project_id,),
                ).fetchall()
        return [{"id": row["id"], "item_id": row["item_id"], "project_id": row["project_id"],
                 "text": row["text"], "created_by": json.loads(row["created_by_json"]),
                 "created_at": row["created_at"]} for row in rows]

    def audit(self, project_id: str) -> list[dict]:
        entries = []
        for entry in self.pilot.list_audit(project_id):
            if not entry["action"].startswith("exchange_"):
                continue
            details = entry["details"]
            entries.append({**entry, "actor": details.get("actor"), "role": details.get("role")})
        return entries

    # ---- Lastprofil -------------------------------------------------------------
    def profile(self, project_id: str, item_id: str, run_id: str | None,
                metric: str) -> dict:
        item = self.get_item(project_id, item_id)
        if item["type"] != "scenario_package":
            raise HTTPException(status_code=409, detail="profile requires a scenario_package")
        run_ids = [run["run_id"] for run in item["content"]["runs"]]
        if not run_ids:
            raise HTTPException(status_code=409, detail="scenario_package has no run")
        run_id = run_id or run_ids[0]
        if run_id not in run_ids:
            raise HTTPException(status_code=422, detail="run_id is not part of the package")
        frozen_hash = next(run["evidence_sha256"] for run in item["content"]["runs"]
                           if run["run_id"] == run_id)
        rows, provenance, _ = _verified_coupled_series(self.base_dir, run_id, metric)
        if frozen_hash and provenance["artifact_sha256"] != frozen_hash:
            raise HTTPException(status_code=409, detail="run evidence changed since package")
        from datetime import datetime, timedelta

        points = []
        for end_text, value in rows:
            end = datetime.fromisoformat(end_text.replace("Z", "+00:00"))
            start = (end - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
            points.append((start, end_text, round(float(value), 6)))
        output = StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["interval_start_utc", "interval_end_utc", "power_kw"])
        writer.writerows(points)
        text = output.getvalue()
        return {
            "item_id": item_id, "run_id": run_id, "metric": metric, "unit": "kW",
            "interval_min": 1, "timezone": "UTC",
            "sample_semantics": "mean_power_over_interval",
            "source_artifact_sha256": provenance["artifact_sha256"],
            "points": [{"start_utc": s, "end_utc": e, "power_kw": v} for s, e, v in points],
            "csv": text,
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "notice": NOTICE,
        }

    # ---- Paket ----------------------------------------------------------------
    def package(self, project_id: str) -> bytes:
        items = self.list_items(project_id)
        files: dict[str, bytes] = {
            "project.json": _canonical(self.pilot.get_project(project_id)).encode(),
            "items.json": _canonical(items).encode(),
            "comments.json": _canonical(self.list_comments(project_id)).encode(),
            "links.json": _canonical(self.list_links(project_id)).encode(),
            "audit.json": _canonical(self.audit(project_id)).encode(),
            "README.txt": (NOTICE + "\nEvidenz: PASS nur ueber Pilot-Holdout-Bewertung.\n"
                           ).encode(),
        }
        profile_errors = {}
        for item in items:
            if item["type"] != "scenario_package":
                continue
            for run in item["content"]["runs"]:
                try:
                    profile = self.profile(project_id, item["id"], run["run_id"],
                                           "ground_charging_kw")
                except HTTPException as exc:
                    profile_errors[f"{item['id']}/{run['run_id']}"] = str(exc.detail)
                    continue
                files[f"profiles/{item['id']}-{run['run_id']}.csv"] = profile["csv"].encode()
        manifest: dict = {
            "files": {name: hashlib.sha256(data).hexdigest()
                      for name, data in sorted(files.items())},
            "items": {item["id"]: {"content_sha256": item["content_sha256"],
                                   "hash_valid": item["hash_valid"]} for item in items},
            "profile_errors": profile_errors,
        }
        manifest["manifest_sha256"] = content_hash(manifest)
        files["manifest.json"] = _canonical(manifest).encode()
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        return buffer.getvalue()

    # ---- Lagebild ---------------------------------------------------------------
    def situation(self, project_id: str) -> dict:
        self.pilot.get_project(project_id)
        candidates = {link["ref_id"] for link in self.list_links(project_id)
                      if link["kind"] == "coupled_run"}
        for item in self.list_items(project_id, "scenario_package"):
            candidates.update(run["run_id"] for run in item["content"]["runs"])
        best = None
        for run_id in sorted(candidates):
            try:
                record = self._run_record(run_id)
            except HTTPException:
                continue
            if record.status.state.value != "completed" or not self._is_coupled(record):
                continue
            key = record.status.end_ts.isoformat() if record.status.end_ts else ""
            if best is None or key > best[0]:
                best = (key, record)
        if best is None:
            return empty_situation("no_completed_coupled_run")
        return build_situation(self.base_dir, best[1])


def resolve_actor(request: Request, header_role: str | None) -> Actor:
    access = getattr(request.app.state, "instance_access", None)
    if access is not None and access.config.enabled:
        principal = getattr(request.state, "instance_principal", None)
        if principal is None:
            raise HTTPException(status_code=401, detail="authentication_required")
        return Actor(user=principal.username, role=principal.exchange_role, source="account")
    if header_role is None or not header_role.strip():
        return Actor(user=None, role="admin", source="demo_default")
    role = header_role.strip().lower()
    if role not in EXCHANGE_ROLES:
        raise HTTPException(status_code=422, detail="X-Exchange-Role must be airport|lab|admin")
    return Actor(user=None, role=role, source="demo_header")


def create_router(storage, lab_service, plans, base_dir: Path | None = None) -> APIRouter:
    pilot = EvidenceStore(base_dir or storage.base_dir)
    store = ExchangeStore(pilot, storage, lab_service, plans)
    router = APIRouter(prefix="/api/v1", tags=["Airport Energy Check: Austausch (read-only)"])
    role_header = Header(default=None, alias="X-Exchange-Role")

    def pid(project_id: str) -> str:
        return _normalize_uuid(project_id, "project_id")

    def iid(item_id: str) -> str:
        return _normalize_uuid(item_id, "item_id")

    @router.get("/exchange/whoami")
    def whoami(request: Request, x_exchange_role: str | None = role_header) -> dict:
        actor = resolve_actor(request, x_exchange_role)
        access = getattr(request.app.state, "instance_access", None)
        return {"role": actor.role, "user": actor.user, "source": actor.source,
                "auth_enabled": bool(access and access.config.enabled),
                "can_write": actor.role in EXCHANGE_ROLES}

    @router.get("/projects/{project_id}/links")
    def list_links(project_id: str) -> list[dict]:
        return store.list_links(pid(project_id))

    @router.post("/projects/{project_id}/links", status_code=201)
    def add_link(project_id: str, body: LinkRequest, request: Request,
                 x_exchange_role: str | None = role_header) -> dict:
        return store.add_link(pid(project_id), body, resolve_actor(request, x_exchange_role))

    @router.get("/projects/{project_id}/overview")
    def overview(project_id: str) -> dict:
        return store.overview(pid(project_id))

    @router.get("/projects/{project_id}/situation")
    def situation(project_id: str) -> dict:
        return store.situation(pid(project_id))

    @router.get("/projects/{project_id}/exchange")
    def list_items(
        project_id: str,
        type: Literal["scenario_package", "test_request", "lab_result"] | None = None,  # noqa: A002
    ) -> list[dict]:
        return store.list_items(pid(project_id), type)

    @router.post("/projects/{project_id}/exchange", status_code=201)
    def create_item(project_id: str, body: ItemRequest, request: Request,
                    x_exchange_role: str | None = role_header) -> dict:
        return store.create_item(pid(project_id), body, resolve_actor(request, x_exchange_role))

    @router.get("/projects/{project_id}/exchange/{item_id}")
    def get_item(project_id: str, item_id: str) -> dict:
        return store.get_item(pid(project_id), iid(item_id))

    @router.post("/projects/{project_id}/exchange/{item_id}/transition")
    def transition(project_id: str, item_id: str, body: TransitionRequest, request: Request,
                   x_exchange_role: str | None = role_header) -> dict:
        return store.transition(pid(project_id), iid(item_id), body,
                                resolve_actor(request, x_exchange_role))

    @router.get("/projects/{project_id}/exchange/{item_id}/comments")
    def list_comments(project_id: str, item_id: str) -> list[dict]:
        return store.list_comments(pid(project_id), iid(item_id))

    @router.post("/projects/{project_id}/exchange/{item_id}/comments", status_code=201)
    def add_comment(project_id: str, item_id: str, body: CommentRequest, request: Request,
                    x_exchange_role: str | None = role_header) -> dict:
        return store.add_comment(pid(project_id), iid(item_id), body,
                                 resolve_actor(request, x_exchange_role))

    metric_query = Query(default="ground_charging_kw", pattern="^(ground_charging_kw|"
                         "grid_import_kw|parking_kw)$")

    @router.get("/projects/{project_id}/exchange/{item_id}/profile.json")
    def profile_json(project_id: str, item_id: str, run_id: str | None = None,
                     metric: str = metric_query) -> dict:
        payload = store.profile(pid(project_id), iid(item_id), run_id, metric)
        payload.pop("csv")
        return payload

    @router.get("/projects/{project_id}/exchange/{item_id}/profile.csv")
    def profile_csv(project_id: str, item_id: str, run_id: str | None = None,
                    metric: str = metric_query) -> Response:
        payload = store.profile(pid(project_id), iid(item_id), run_id, metric)
        return Response(payload["csv"], media_type="text/csv", headers={
            "Content-Disposition":
                f'attachment; filename="lastprofil-{payload["run_id"]}-{metric}.csv"',
            "X-Profile-Sha256": payload["sha256"],
            "X-Profile-Unit": "kW",
            "X-Source-Artifact-Sha256": payload["source_artifact_sha256"],
        })

    @router.get("/projects/{project_id}/exchange-audit")
    def exchange_audit(project_id: str) -> list[dict]:
        return store.audit(pid(project_id))

    @router.get("/projects/{project_id}/exchange-package")
    def exchange_package(project_id: str) -> Response:
        normalized = pid(project_id)
        return Response(store.package(normalized), media_type="application/zip", headers={
            "Content-Disposition":
                f'attachment; filename="airport-energy-check-{normalized}.zip"'})

    @router.get("/library/scenarios")
    def library_scenarios() -> list[dict]:
        return library.list_scenarios(storage)

    @router.post("/library/scenarios/{scenario_id}/adopt", status_code=201)
    def adopt(scenario_id: str, body: AdoptRequest, request: Request,
              x_exchange_role: str | None = role_header) -> dict:
        data, _ = library.scenario_file(scenario_id)
        item = ItemRequest(
            type="scenario_package",
            title=data.get("metadata", {}).get("case_name") or scenario_id,
            scenario_id=scenario_id,
            note=body.note,
        )
        return store.create_item(pid(body.project_id), item,
                                 resolve_actor(request, x_exchange_role))

    return router
