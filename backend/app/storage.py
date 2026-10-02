from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Iterable

from .models import ModelPack, PlaybookRecord, RunRecord, ScenarioDefinition, TelemetrySample


class StorageError(Exception):
    """Raised when persistent storage operations fail."""


class FileStorage:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.scenarios_dir = self.base_dir / "scenarios"
        self.model_packs_dir = self.base_dir / "model_packs"
        self.runs_dir = self.base_dir / "runs"
        self.playbook_jobs_dir = self.base_dir / "playbook_jobs"
        self._lock = threading.Lock()
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self.scenarios_dir.mkdir(parents=True, exist_ok=True)
        self.model_packs_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.playbook_jobs_dir.mkdir(parents=True, exist_ok=True)

    def readiness_report(self) -> dict[str, str | bool]:
        self._ensure_dirs()
        probe = self.base_dir / ".readiness_probe"
        try:
            probe.write_text("ok\n", encoding="utf-8")
            probe.unlink()
        except Exception as exc:
            raise StorageError(f"Data directory is not writable: {self.base_dir}") from exc

        return {
            "data_dir": str(self.base_dir),
            "write_ok": True,
            "scenarios_dir_ok": self.scenarios_dir.exists(),
            "model_packs_dir_ok": self.model_packs_dir.exists(),
            "runs_dir_ok": self.runs_dir.exists(),
            "playbook_jobs_dir_ok": self.playbook_jobs_dir.exists(),
        }

    @staticmethod
    def _write_json(path: Path, payload: dict) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(path)

    @staticmethod
    def _read_json(path: Path, *, retries: int = 5, delay_s: float = 0.02) -> dict:
        last_exc: json.JSONDecodeError | OSError | None = None
        for attempt in range(retries):
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                last_exc = exc
                if attempt == retries - 1:
                    break
                time.sleep(delay_s)
        assert last_exc is not None
        raise last_exc

    def save_scenario(self, scenario: ScenarioDefinition) -> Path:
        path = self.scenarios_dir / f"{scenario.id}.json"
        with self._lock:
            self._write_json(path, scenario.model_dump(mode="json"))
        return path

    def get_scenario(self, scenario_id: str) -> ScenarioDefinition:
        path = self.scenarios_dir / f"{scenario_id}.json"
        if not path.exists():
            raise StorageError(f"Scenario '{scenario_id}' not found")
        data = self._read_json(path)
        return ScenarioDefinition.model_validate(data)

    def list_scenarios(self) -> list[ScenarioDefinition]:
        result = []
        for p in sorted(self.scenarios_dir.glob("*.json")):
            data = self._read_json(p)
            result.append(ScenarioDefinition.model_validate(data))
        return result

    def save_model_pack(self, model_pack: ModelPack) -> Path:
        path = self.model_packs_dir / f"{model_pack.id}.json"
        with self._lock:
            self._write_json(path, model_pack.model_dump(mode="json"))
        return path

    def get_model_pack(self, model_pack_id: str) -> ModelPack:
        path = self.model_packs_dir / f"{model_pack_id}.json"
        if not path.exists():
            raise StorageError(f"Model pack '{model_pack_id}' not found")
        data = self._read_json(path)
        return ModelPack.model_validate(data)

    def list_model_packs(self) -> list[ModelPack]:
        result = []
        for p in sorted(self.model_packs_dir.glob("*.json")):
            data = self._read_json(p)
            result.append(ModelPack.model_validate(data))
        return result

    def run_dir(self, run_id: str) -> Path:
        path = self.runs_dir / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_run_record(self, run_record: RunRecord) -> Path:
        run_dir = self.run_dir(run_record.status.run_id)
        run_path = run_dir / "run.json"
        with self._lock:
            self._write_json(run_path, run_record.model_dump(mode="json"))
        return run_path

    def get_run_record(self, run_id: str) -> RunRecord:
        run_path = self.runs_dir / run_id / "run.json"
        if not run_path.exists():
            raise StorageError(f"Run '{run_id}' not found")
        data = self._read_json(run_path)
        return RunRecord.model_validate(data)

    def save_telemetry(self, run_id: str, telemetry: Iterable[TelemetrySample]) -> Path:
        run_dir = self.run_dir(run_id)
        path = run_dir / "telemetry.jsonl"
        with self._lock:
            with path.open("w", encoding="utf-8") as f:
                for sample in telemetry:
                    f.write(json.dumps(sample.model_dump(mode="json"), sort_keys=True))
                    f.write("\n")
        return path

    def telemetry_path(self, run_id: str) -> Path:
        return self.runs_dir / run_id / "telemetry.jsonl"

    def save_run_report(self, run_id: str, report_data: dict) -> Path:
        run_dir = self.run_dir(run_id)
        report_path = run_dir / "report.json"
        with self._lock:
            self._write_json(report_path, report_data)
        return report_path

    def list_runs(self) -> list[RunRecord]:
        records = []
        for p in sorted(self.runs_dir.glob("*/run.json")):
            data = self._read_json(p)
            records.append(RunRecord.model_validate(data))
        return records

    def playbook_job_dir(self, job_id: str) -> Path:
        path = self.playbook_jobs_dir / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_playbook_record(self, record: PlaybookRecord) -> Path:
        job_dir = self.playbook_job_dir(record.status.job_id)
        path = job_dir / "record.json"
        with self._lock:
            self._write_json(path, record.model_dump(mode="json"))
        return path

    def get_playbook_record(self, job_id: str) -> PlaybookRecord:
        path = self.playbook_jobs_dir / job_id / "record.json"
        if not path.exists():
            raise StorageError(f"Playbook job '{job_id}' not found")
        data = self._read_json(path)
        return PlaybookRecord.model_validate(data)

    def list_playbook_records(self) -> list[PlaybookRecord]:
        records = []
        for p in sorted(self.playbook_jobs_dir.glob("*/record.json")):
            data = self._read_json(p)
            records.append(PlaybookRecord.model_validate(data))
        return records

    def playbook_artifact_path(self, job_id: str, artifact_name: str) -> Path:
        if "/" in artifact_name or "\\" in artifact_name:
            raise StorageError(f"Invalid artifact name '{artifact_name}'")
        path = self.playbook_jobs_dir / job_id / artifact_name
        if not path.exists():
            raise StorageError(f"Artifact '{artifact_name}' for playbook job '{job_id}' not found")
        return path
