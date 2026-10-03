from __future__ import annotations

import csv
import re
from io import StringIO
from pathlib import Path
from threading import Lock

from ..storage import FileStorage
from .flightplan import FlightPlanSnapshot, verify_snapshot


class FlightPlanStore:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "munich" / "flight_plans"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()

    def _path(self, snapshot_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", snapshot_id):
            raise LookupError("Flugplan nicht gefunden")
        return self.root / (snapshot_id + ".json")

    def get(self, snapshot_id: str) -> FlightPlanSnapshot:
        path = self._path(snapshot_id)
        if not path.is_file():
            raise LookupError("Flugplan nicht gefunden")
        snapshot = FlightPlanSnapshot.model_validate(FileStorage._read_json(path))
        verify_snapshot(snapshot)
        if snapshot.snapshot_id != snapshot_id:
            raise ValueError("Flugplan-ID widerspricht Snapshot")
        return snapshot

    def save(self, snapshot: FlightPlanSnapshot) -> FlightPlanSnapshot:
        verify_snapshot(snapshot)
        with self.lock:
            path = self._path(snapshot.snapshot_id)
            if path.is_file():
                return self.get(snapshot.snapshot_id)
            FileStorage._write_json(path, snapshot.model_dump(mode="json"))
        return snapshot

    def list(self) -> list[dict]:
        # One backend process and bounded local pilot storage, no shared concurrent filesystem.
        result = [self.get(path.stem).model_dump(mode="json", exclude={"rows", "hourly_counts"})
                  for path in self.root.glob("*.json")]
        return sorted(result, key=lambda p: (p["service_date"], p["imported_at"]), reverse=True)


def flight_plan_csv(snapshot: FlightPlanSnapshot) -> str:
    output = StringIO(newline="")
    columns = ["entry_id", "direction", "flight_number", "airline", "counterpart_iata",
               "terminal", "scheduled_local", "scheduled_utc", "source_pages",
               "possible_shared_group", "service_date", "source_data_date", "timezone",
               "source_pdf_sha256", "content_sha256", "parser_version", "evidence_level"]
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for row in snapshot.rows:
        payload = row.model_dump()
        payload["source_pages"] = ";".join(map(str, row.source_pages))
        for key in ("service_date", "source_data_date", "timezone", "source_pdf_sha256",
                    "content_sha256", "parser_version", "evidence_level"):
            payload[key] = getattr(snapshot, key)
        # Imported airline text is untrusted. CSV formula injection must not survive export.
        for key, value in payload.items():
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                payload[key] = "'" + value
        writer.writerow(payload)
    return output.getvalue()
