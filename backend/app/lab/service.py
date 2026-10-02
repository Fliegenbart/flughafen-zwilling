from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, RLock
from uuid import UUID, uuid4

from ..storage import FileStorage
from ..workers import SerialWorker
from .analysis import analyze, parse_csv
from .catalog import CASES
from .models import ImportRequest, RunRecord, RunRequest, Sample
from .report import html_report, trace_csv
from .simulator import simulate

logger = logging.getLogger("flexlab")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LabService:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "lab" / "runs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.stopping = Event()
        self.worker = SerialWorker("lab-worker", self.execute)
        self.started = False
        source_root = Path(__file__).resolve().parents[1]
        digest = hashlib.sha256()
        for path in sorted(source_root.rglob("*.py")):
            digest.update(str(path.relative_to(source_root)).encode())
            digest.update(path.read_bytes())
        self.source_hash = digest.hexdigest()

    def directory(self, run_id: str) -> Path:
        try:
            if str(UUID(run_id)) != run_id:
                raise ValueError("noncanonical UUID")
        except (ValueError, AttributeError) as exc:
            raise LookupError("Run nicht gefunden") from exc
        return self.root / run_id

    def save(self, record: RunRecord):
        with self.lock:
            FileStorage._write_json(
                self.directory(record.run_id) / "record.json", record.model_dump(mode="json")
            )

    def get(self, run_id: str) -> RunRecord:
        with self.lock:
            path = self.directory(run_id) / "record.json"
            if not path.is_file():
                raise LookupError("Run nicht gefunden")
            return RunRecord.model_validate(FileStorage._read_json(path))

    def list(self) -> list[RunRecord]:
        with self.lock:
            records = []
            for path in self.root.glob("*/record.json"):
                try:
                    records.append(self.get(path.parent.name))
                except (ValueError, LookupError, OSError):
                    logger.exception("lab_record_unreadable path=%s", path.name)
            return sorted(records, key=lambda record: record.created_ts, reverse=True)[:500]

    def start(self):
        with self.lock:
            if self.started:
                return
            self.started = True
            self.stopping.clear()
            pending = []
            # Scan all records, not only the 500 visible history entries.
            for path in self.root.glob("*/record.json"):
                record = self.get(path.parent.name)
                if record.state not in ("queued", "running"):
                    continue
                record.state = "queued"
                record.progress = 0
                record.start_ts = record.end_ts = record.error = None
                record.analysis = None
                record.comparison_key = None
                record.artifacts = []
                record.recovery_count += 1
                record.last_recovered_ts = now()
                for name in ("trace.json", "trace.csv", "report.html"):
                    (path.parent / name).unlink(missing_ok=True)
                self.save(record)
                pending.append(record.run_id)
            self.worker.start()
            for run_id in pending:
                self.worker.enqueue(run_id)

    def stop(self):
        self.stopping.set()
        self.worker.stop()

    def _create(self, payload, source: str) -> RunRecord:
        with self.lock:
            if sum(r.state in ("queued", "running") for r in self.list()) >= 10:
                raise RuntimeError(
                    "Maximal zehn offene Tests. Bitte zuerst abschliessen oder abbrechen."
                )
            run_id = str(uuid4())
            self.directory(run_id).mkdir()
            name = next(case["name"] for case in CASES if case["id"] == payload.case_id)
            record = RunRecord(
                run_id=run_id,
                source=source,
                case_id=payload.case_id,
                label=payload.label.strip() or name,
                bench=payload.bench,
                criteria=payload.criteria,
                created_ts=now(),
                build_commit=os.environ.get("TWIN_BUILD_GIT_COMMIT", "unknown"),
                build_source_sha256=self.source_hash,
            )
            return record

    def create_simulation(self, payload: RunRequest) -> RunRecord:
        with self.lock:
            record = self._create(payload, "simulation")
            record.request = payload
            self.save(record)
            if self.started:
                self.worker.enqueue(record.run_id)
            return record

    def create_import(self, payload: ImportRequest) -> RunRecord:
        parse_csv(payload.csv_text)  # Reject invalid input before persisting a job.
        with self.lock:
            record = self._create(payload, "csv_import")
            record.filename = Path(payload.filename.replace("\\", "/")).name
            record.source_sha256 = hashlib.sha256(payload.csv_text.encode("utf-8")).hexdigest()
            (self.directory(record.run_id) / "source.csv").write_bytes(
                payload.csv_text.encode("utf-8")
            )
            self.save(record)
            if self.started:
                self.worker.enqueue(record.run_id)
            return record

    def trace(self, run_id: str) -> list[Sample]:
        with self.lock:
            self.get(run_id)
            path = self.directory(run_id) / "trace.json"
            return (
                [Sample.model_validate(p) for p in json.loads(path.read_text())]
                if path.exists()
                else []
            )

    def _save_trace(self, run_id: str, trace: list[Sample]):
        with self.lock:
            path = self.directory(run_id) / "trace.json"
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps([point.model_dump() for point in trace]), encoding="utf-8"
            )
            temporary.replace(path)

    def cancel(self, run_id: str) -> RunRecord:
        with self.lock:
            record = self.get(run_id)
            if record.state in ("queued", "running"):
                record.state = "cancelled"
                record.end_ts = now()
                record.artifacts = []
                self.save(record)
                logger.info("lab_cancelled run_id=%s", run_id)
            return record

    def execute(self, run_id: str):
        try:
            with self.lock:
                record = self.get(run_id)
                if record.state == "cancelled" or self.stopping.is_set():
                    return
                record.state = "running"
                record.start_ts = now()
                record.build_source_sha256 = self.source_hash
                record.build_commit = os.environ.get("TWIN_BUILD_GIT_COMMIT", "unknown")
                self.save(record)
            logger.info("lab_started run_id=%s source=%s", run_id, record.source)
            trace: list[Sample] = []
            if record.request:
                for point in simulate(record.request):
                    if self.stopping.is_set() or self.get(run_id).state == "cancelled":
                        return
                    trace.append(point)
                    if int(point.ts_s) % 10 == 0:
                        with self.lock:
                            current = self.get(run_id)
                            if current.state == "cancelled":
                                return
                            current.progress = point.ts_s / record.request.duration_s
                            self._save_trace(run_id, trace)
                            self.save(current)
                    if self.stopping.wait(1 / record.request.playback_speed):
                        return
            else:
                raw = (self.directory(run_id) / "source.csv").read_bytes()
                if hashlib.sha256(raw).hexdigest() != record.source_sha256:
                    raise ValueError("Importdatei wurde nach dem Anlegen veraendert (SHA256)")
                trace = parse_csv(raw.decode("utf-8"))
            analysis = analyze(trace, record.criteria, record.case_id)
            with self.lock:
                current = self.get(run_id)
                if current.state == "cancelled" or self.stopping.is_set():
                    return
                current.analysis = analysis
                current.comparison_key = comparison_key(current, trace)
                current.state = "completed"
                current.progress = 1
                current.end_ts = now()
                current.artifacts = ["record.json", "trace.csv", "report.html"] + (
                    ["source.csv"] if current.source == "csv_import" else []
                )
                self._save_trace(run_id, trace)
                (self.directory(run_id) / "trace.csv").write_text(
                    trace_csv(trace), encoding="utf-8"
                )
                (self.directory(run_id) / "report.html").write_text(
                    html_report(current, trace), encoding="utf-8"
                )
                self.save(current)
            logger.info("lab_completed run_id=%s verdict=%s", run_id, analysis.verdict)
        except Exception as exc:
            logger.exception("lab_failed run_id=%s", run_id)
            with self.lock:
                record = self.get(run_id)
                if record.state != "cancelled" and not self.stopping.is_set():
                    record.state = "failed"
                    record.error = str(exc)
                    record.end_ts = now()
                    self.save(record)

    def artifact(self, run_id: str, name: str) -> Path:
        record = self.get(run_id)
        if record.state != "completed" or name not in record.artifacts:
            raise LookupError("Artefakt nicht verfuegbar")
        path = self.directory(run_id) / name
        if not path.is_file():
            raise LookupError("Artefakt nicht gefunden")
        return path

    def compare(self, baseline_id: str, candidate_id: str):
        baseline, candidate = self.get(baseline_id), self.get(candidate_id)
        if (
            not baseline.analysis
            or not candidate.analysis
            or baseline.state != "completed"
            or candidate.state != "completed"
        ):
            raise ValueError("Beide Laeufe muessen abgeschlossen und ausgewertet sein")
        if not baseline.comparison_key or baseline.comparison_key != candidate.comparison_key:
            raise ValueError(
                "Nicht vergleichbar: Testfall, Pruefstand, Kriterien oder "
                "Soll-/Limit-Zeitverlauf unterscheiden sich"
            )
        base_metrics = baseline.analysis.metrics.model_dump()
        cand_metrics = candidate.analysis.metrics.model_dump()
        deltas = {
            key: round(cand_metrics[key] - base_metrics[key], 6)
            if cand_metrics[key] is not None and base_metrics[key] is not None
            else None
            for key in base_metrics
        }
        return {
            "baseline_id": baseline_id,
            "candidate_id": candidate_id,
            "deltas": deltas,
            "note": (
                "Beobachtete Differenzen; kein kausaler Wirksamkeitsnachweis. "
                "Datenqualitaet beider Laeufe beachten."
            ),
        }


def comparison_key(record: RunRecord, trace: list[Sample]) -> str:
    payload = {
        "analysis_method_version": "flexlab_metrics_v1",
        "case_id": record.case_id,
        "bench": {
            key: getattr(record.bench, key)
            for key in ("name", "min_power_kw", "max_power_kw", "grid_limit_kw")
        },
        "criteria": record.criteria.model_dump(),
        "commands": [[p.ts_s, p.setpoint_kw, p.limit_kw] for p in trace],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
