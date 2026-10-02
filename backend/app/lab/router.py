from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from .catalog import catalog
from .models import ImportRequest, RunRecord, RunRequest
from .report import comparison_report, trace_csv
from .service import LabService
from .simulator import simulate


def create_router(service: LabService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/lab", tags=["FlexLab Workbench (read-only)"])

    @router.get("/catalog")
    def get_catalog():
        return catalog()

    @router.get("/template.csv")
    def template():
        return Response(
            "ts_s,power_kw,setpoint_kw,limit_kw\n0,20,20,80\n1,20,20,80\n",
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="flexlab-template.csv"'},
        )

    @router.get("/example.csv")
    def example():
        return Response(
            trace_csv(list(simulate(RunRequest(duration_s=180)))),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="flexlab-example-simulated.csv"'},
        )

    @router.get("/runs", response_model=list[RunRecord])
    def history():
        return service.list()

    @router.post("/runs", response_model=RunRecord, status_code=202)
    def create(payload: RunRequest):
        try:
            return service.create_simulation(payload)
        except RuntimeError as exc:
            raise HTTPException(429, str(exc)) from exc

    @router.post("/imports", response_model=RunRecord, status_code=202)
    def import_csv(payload: ImportRequest):
        try:
            return service.create_import(payload)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(429, str(exc)) from exc

    @router.get("/compare")
    def compare(baseline_id: str, candidate_id: str):
        try:
            return service.compare(baseline_id, candidate_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get("/compare/report.html")
    def compare_report(baseline_id: str, candidate_id: str):
        try:
            comparison = service.compare(baseline_id, candidate_id)
            report = comparison_report(
                service.get(baseline_id), service.get(candidate_id), comparison
            )
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return Response(
            report,
            media_type="text/html",
            headers={
                "Content-Disposition": 'attachment; filename="flexlab-compare.html"',
                "Content-Security-Policy": (
                    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
                ),
            },
        )

    @router.get("/runs/{run_id}", response_model=RunRecord)
    def record(run_id: str):
        try:
            return service.get(run_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.get("/runs/{run_id}/trace")
    def trace(run_id: str):
        try:
            return service.trace(run_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.post("/runs/{run_id}/cancel", response_model=RunRecord)
    def cancel(run_id: str):
        try:
            return service.cancel(run_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.get("/runs/{run_id}/artifacts/{name}")
    def artifact(run_id: str, name: str, inline: bool = False):
        try:
            path = service.artifact(run_id, name)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        media = {
            "report.html": "text/html",
            "record.json": "application/json",
            "trace.csv": "text/csv",
            "source.csv": "text/csv",
        }[name]
        return FileResponse(
            path,
            media_type=media,
            filename=f"flexlab-{run_id}-{name}",
            content_disposition_type="inline" if inline and name == "report.html" else "attachment",
            headers={
                "Content-Security-Policy": (
                    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
                    "base-uri 'none'; form-action 'none'"
                )
            },
        )

    return router
