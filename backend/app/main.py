from __future__ import annotations

import json
import csv
from io import StringIO
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi import Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import RedirectResponse
from fastapi.responses import StreamingResponse
from prometheus_client import make_asgi_app

from .config import Settings
from .mapping_profiles import MappingProfileError, get_profile, list_profiles
from .models import (
    CapabilitiesResponse,
    HealthResponse,
    MappingProfile,
    ModelPack,
    PlaybookRecord,
    PlaybookRequest,
    PlaybookStatus,
    ReadyResponse,
    RunRecord,
    RunRequest,
    RunState,
    SafetyResponse,
    RunStatus,
    ScenarioDefinition,
    TelemetrySliceResponse,
)
from .playbook_service import PlaybookError, PlaybookService
from .run_service import RunService
from .storage import FileStorage, StorageError
from .workers import WorkerManager
from .lab.router import create_router as create_lab_router
from .lab.service import LabService
from .munich.router import create_router as create_munich_router
from .munich.flightplan_router import create_router as create_flightplan_router
from .munich.flightplan_store import FlightPlanStore
from .munich.coupled_router import create_router as create_coupled_router

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
    playbook_service = PlaybookService(storage, settings, service)
    workers = WorkerManager(
        enqueue_runs_for_recovery=service.recover_pending_runs,
        enqueue_playbooks_for_recovery=(playbook_service.recover_pending_jobs if settings.enable_playbook_synth else lambda: []),
        run_handler=service.execute_run,
        playbook_handler=playbook_service.execute_job,
    )
    playbook_service.set_run_dispatcher(workers.enqueue_run)
    workers.start()
    workers.recover_pending()
    lab_service = LabService(storage.base_dir)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        lab_service.start()
        report = storage.readiness_report()
        profile_count = len(list_profiles())
        logger.info(
            "startup_check_ok data_dir=%s profile_count=%s origins=%s",
            report["data_dir"],
            profile_count,
            ",".join(settings.allowed_origins),
        )
        yield
        lab_service.stop()
        workers.stop()

    app = FastAPI(
        title="Airport Twin Core + FlexLab API",
        version="1.0.0",
        description="Flughafen-Stresstests und separate FlexLab-Messdatenauswertung. Lokale Demo ohne reale Anlagensteuerung.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(create_lab_router(lab_service))
    flight_plans = FlightPlanStore(storage.base_dir)
    app.include_router(create_flightplan_router(flight_plans))
    app.include_router(create_munich_router(service, workers.enqueue_run, flight_plans))
    app.include_router(create_coupled_router(service, workers.enqueue_run, flight_plans))

    @app.get("/api/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/docs", status_code=307)

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

    @app.get("/api/v1/capabilities", response_model=CapabilitiesResponse)
    def capabilities() -> CapabilitiesResponse:
        return CapabilitiesResponse(
            playbook_synth_enabled=settings.enable_playbook_synth,
            telemetry_stream_enabled=bool(settings.influx_token),
            grafana_base_url=settings.grafana_base_url or None,
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

    app.state.run_worker = workers.run_worker
    app.state.playbook_worker = workers.playbook_worker

    @app.post("/api/v1/runs", response_model=RunStatus)
    def create_run(payload: RunRequest) -> RunStatus:
        try:
            status = service.queue_run(payload)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        workers.enqueue_run(status.run_id)
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

    @app.get("/api/v1/runs/{run_id}/artifacts/{artifact_name}")
    def get_run_artifact(run_id: str, artifact_name: str) -> FileResponse:
        allowed = {
            "record.json": ("run.json", "application/json"),
            "report.json": ("report.json", "application/json"),
            "report.pdf": ("report.pdf", "application/pdf"),
            "telemetry.jsonl": ("telemetry.jsonl", "application/x-ndjson"),
            "charging.csv": ("charging.csv", "text/csv"),
            "missions.csv": ("missions.csv", "text/csv"),
            "departures.csv": ("departures.csv", "text/csv"),
            "vehicles.csv": ("vehicles.csv", "text/csv"),
            "parking.csv": ("parking.csv", "text/csv"),
            "coupled-evidence.json": ("coupled-evidence.json", "application/json"),
        }
        try:
            if artifact_name not in allowed or UUID(run_id).hex != run_id:
                raise StorageError("Artifact not found")
            record = service.get_run_record(run_id)
            if artifact_name != "record.json" and record.status.state != RunState.completed:
                raise StorageError("Completed artifact not available")
            filename, media_type = allowed[artifact_name]
            run_dir = storage.runs_dir / run_id
            path = (run_dir / filename).resolve()
            if path.parent != run_dir.resolve() or not path.is_file():
                raise StorageError("Artifact not found")
        except (StorageError, ValueError) as exc:
            raise HTTPException(status_code=404, detail="Artifact not found") from exc
        return FileResponse(path, media_type=media_type, filename=f"{run_id}-{artifact_name}")

    @app.get("/api/v1/runs/{run_id}/telemetry-slice", response_model=TelemetrySliceResponse)
    def get_run_telemetry_slice(
        run_id: str,
        cursor: int = Query(default=0, ge=0),
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> TelemetrySliceResponse:
        try:
            return service.get_run_telemetry_slice(run_id, cursor=cursor, limit=limit)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

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

    @app.post("/api/v1/playbook-jobs", response_model=PlaybookStatus)
    def create_playbook_job(payload: PlaybookRequest) -> PlaybookStatus:
        if not settings.enable_playbook_synth:
            raise HTTPException(status_code=404, detail="playbook_synth_disabled")
        try:
            status = playbook_service.queue_job(payload)
        except (StorageError, PlaybookError) as exc:
            detail = str(exc)
            if "not found" in detail:
                raise HTTPException(status_code=404, detail=detail) from exc
            if "max_active_jobs" in detail:
                raise HTTPException(status_code=429, detail=detail) from exc
            raise HTTPException(status_code=400, detail=detail) from exc

        workers.enqueue_playbook(status.job_id)
        return status

    @app.get("/api/v1/playbook-jobs", response_model=list[PlaybookStatus])
    def list_playbook_jobs() -> list[PlaybookStatus]:
        if not settings.enable_playbook_synth:
            raise HTTPException(status_code=404, detail="playbook_synth_disabled")
        return playbook_service.list_statuses()

    @app.get("/api/v1/playbook-jobs/{job_id}", response_model=PlaybookStatus)
    def get_playbook_job_status(job_id: str) -> PlaybookStatus:
        if not settings.enable_playbook_synth:
            raise HTTPException(status_code=404, detail="playbook_synth_disabled")
        try:
            return playbook_service.get_status(job_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/v1/playbook-jobs/{job_id}/record", response_model=PlaybookRecord)
    def get_playbook_job_record(job_id: str) -> PlaybookRecord:
        if not settings.enable_playbook_synth:
            raise HTTPException(status_code=404, detail="playbook_synth_disabled")
        try:
            return playbook_service.get_record(job_id)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/v1/playbook-jobs/{job_id}/artifacts/{artifact_name}")
    def get_playbook_job_artifact(job_id: str, artifact_name: str) -> FileResponse:
        if not settings.enable_playbook_synth:
            raise HTTPException(status_code=404, detail="playbook_synth_disabled")
        try:
            path = playbook_service.get_artifact_path(job_id, artifact_name)
        except StorageError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        media_type = "application/octet-stream"
        if artifact_name.endswith(".json"):
            media_type = "application/json"
        elif artifact_name.endswith(".csv"):
            media_type = "text/csv"
        elif artifact_name.endswith(".md"):
            media_type = "text/markdown"

        return FileResponse(path, media_type=media_type, filename=artifact_name)

    app.mount("/metrics", make_asgi_app())

    return app


app = create_app()
