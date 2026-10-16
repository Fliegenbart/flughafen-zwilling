"""Read-only, integrity-checked profiles for local browser diagnostics."""
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException

from . import router as pilot


def create_router(base_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/api/v1/runs", tags=["measurement-profile"])

    @router.get("/{run_id}/measurement-profile")
    def profile(
        run_id: UUID,
        metric: Literal["grid_import_kw", "ground_charging_kw", "parking_kw"] = "grid_import_kw",
    ) -> dict:
        rows, provenance, files = pilot._verified_coupled_series(base_dir, run_id.hex, metric)
        previous = None
        for timestamp, value in rows:
            instant = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if value < 0 or (previous is not None and (instant - previous).total_seconds() != 60):
                raise HTTPException(
                    status_code=409,
                    detail="profile requires consecutive nonnegative minute means",
                )
            previous = instant
        record = json.loads(files["run.json"])
        changes = record["scenario_snapshot"].get("metadata", {}).get("changes", {})
        study = None
        if (
            isinstance(changes, dict)
            and isinstance(changes.get("solution"), str)
            and changes["solution"] in {"direct", "managed", "managed_storage"}
            and all(
                isinstance(changes.get(key), (int, float)) and math.isfinite(changes[key])
                for key in ("electric_share_pct", "grid_import_limit_kw")
            )
        ):
            study = {key: changes.get(key) for key in (
                "solution", "electric_share_pct", "grid_import_limit_kw",
            )}
        return {
            "run_id": run_id.hex,
            "metric": metric,
            "unit": "kW",
            "interval_seconds": 60,
            "sample_semantics": "interval_end_mean",
            "evidence_level": "model_checked",
            "points": [{"timestamp": ts, "model_kw": value} for ts, value in rows],
            "provenance": provenance,
            "study": study,
            "notice": "Simulation only. Not measured data, hardware commands or validation.",
        }

    return router
