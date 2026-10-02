from __future__ import annotations

import json
import csv
from io import StringIO
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from prometheus_client import make_asgi_app

from .config import Settings
from .mapping_profiles import MappingProfileError, get_profile, list_profiles
from .models import (
    HealthResponse,
    MappingProfile,
    ModelPack,
    ReadyResponse,
    RunRecord,
    RunRequest,
    SafetyResponse,
    RunStatus,
    ScenarioDefinition,
)
from .run_service import RunService
from .storage import FileStorage, StorageError

logger = logging.getLogger("twin_core.main")


def _configure_logging(level: str) -> None:
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def create_app(data_dir: Path | None = None) -> FastAPI:
    settings = Settings.load()
    _configure_logging(settings.log_level)

    storage = FileStorage(data_dir or settings.data_dir)
    service = RunService(storage, settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        report = storage.readiness_report()
        profile_count = len(list_profiles())
        logger.info(
            "startup_check_ok data_dir=%s profile_count=%s origins=%s",
            report["data_dir"],
            profile_count,
            ",".join(settings.allowed_origins),
        )
        yield

    app = FastAPI(
        title="Kasernen EMS Twin Core Service",
        version="0.1.0",
        description="Deterministic digital twin API for HIL/SIL testing",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    @app.get("/api/v1/ready", response_model=ReadyResponse)
    def ready() -> ReadyResponse:
        try:
            report = storage.readiness_report()
            profile_count = len(list_profiles())
        except (StorageError, MappingProfileError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        checks = {
            "write_ok": bool(report.get("write_ok")),
            "profiles_loaded": profile_count > 0,
            "watchdog_config_loaded": True,
        }
        return ReadyResponse(
            data_dir=report["data_dir"],
            profile_count=profile_count,
            checks=checks,
        )

    @app.post("/api/v1/scenarios", response_model=ScenarioDefinition)
    def create_scenario(payload: ScenarioDefinition) -> ScenarioDefinition:
        return service.create_scenario(payload)

    @app.get("/api/v1/scenarios", response_model=list[ScenarioDefinition])
    def list_scenarios() -> list[ScenarioDefinition]:
        return service.list_scenarios()

    @app.get("/api/v1/mapping-profiles", response_model=list[MappingProfile])
    def list_mapping_profiles() -> list[MappingProfile]:
        return list_profiles()

    @app.get("/api/v1/mapping-profiles/{profile_id}", response_model=MappingProfile)
    def get_mapping_profile(profile_id: str) -> MappingProfile:
        try:
            return get_profile(profile_id)
        except MappingProfileError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/v1/scenarios/{scenario_id}", response_model=ScenarioDefinition)
    def get_scenario(scenario_id: str) -> ScenarioDefinition:
        try:
            return service.get_scenario(scenario_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/v1/model-packs", response_model=ModelPack)
    def create_model_pack(payload: ModelPack) -> ModelPack:
        return service.create_model_pack(payload)

    @app.get("/api/v1/model-packs", response_model=list[ModelPack])
    def list_model_packs() -> list[ModelPack]:
        return service.list_model_packs()

    @app.get("/api/v1/model-packs/{model_pack_id}", response_model=ModelPack)
    def get_model_pack(model_pack_id: str) -> ModelPack:
        try:
            return service.get_model_pack(model_pack_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/v1/runs", response_model=RunStatus)
    def create_run(payload: RunRequest, background_tasks: BackgroundTasks) -> RunStatus:
        try:
            status = service.queue_run(payload)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        background_tasks.add_task(service.execute_run, status.run_id)
        return status

    @app.get("/api/v1/runs", response_model=list[RunStatus])
    def list_runs() -> list[RunStatus]:
        return service.list_runs()

    @app.get("/api/v1/runs/{run_id}", response_model=RunStatus)
    def get_run_status(run_id: str) -> RunStatus:
        try:
            return service.get_run_status(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/v1/runs/{run_id}/record", response_model=RunRecord)
    def get_run_record(run_id: str) -> RunRecord:
        try:
            return service.get_run_record(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/v1/runs/{run_id}/telemetry")
    def get_run_telemetry(run_id: str) -> FileResponse:
        try:
            path = service.get_run_telemetry_path(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return FileResponse(path, media_type="application/x-ndjson", filename=f"{run_id}-telemetry.jsonl")

    @app.get("/api/v1/runs/{run_id}/telemetry.csv")
    def get_run_telemetry_csv(run_id: str) -> StreamingResponse:
        try:
            path = service.get_run_telemetry_path(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        def generate_csv() -> Iterator[bytes]:
            header = "ts,source,asset_id,metric,value,quality,unit,run_id\n"
            yield header.encode("utf-8")
            with path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    buffer = StringIO()
                    writer = csv.writer(buffer, lineterminator="\n")
                    writer.writerow(
                        [
                            row.get("ts", ""),
                            row.get("source", ""),
                            row.get("asset_id", ""),
                            row.get("metric", ""),
                            row.get("value", ""),
                            row.get("quality", ""),
                            row.get("unit", ""),
                            row.get("run_id", ""),
                        ]
                    )
                    yield buffer.getvalue().encode("utf-8")

        return StreamingResponse(
            generate_csv(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{run_id}-telemetry.csv"'},
        )

    @app.get("/api/v1/runs/{run_id}/safety", response_model=SafetyResponse)
    def get_run_safety(run_id: str) -> SafetyResponse:
        try:
            return service.get_run_safety(run_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    app.mount("/metrics", make_asgi_app())

    return app


app = create_app()
