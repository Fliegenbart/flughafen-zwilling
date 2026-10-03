from __future__ import annotations

import asyncio
import hashlib
from datetime import date
from threading import Lock

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from .flightplan import MAX_PDF_BYTES, FlightPlanSnapshot, parse_pages
from .flightplan_pdf import extract_pages
from .flightplan_store import FlightPlanStore, flight_plan_csv

UPLOAD_TIMEOUT_SEC = 15


async def read_upload(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_PDF_BYTES:
            raise HTTPException(status_code=413, detail="PDF darf maximal 6 MiB gross sein")
        body.extend(chunk)
    return bytes(body)


def load_snapshot(store: FlightPlanStore, snapshot_id: str) -> FlightPlanSnapshot:
    try:
        return store.get(snapshot_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=409, detail="Gespeicherter Flugplan ungueltig") from exc


def create_router(store: FlightPlanStore) -> APIRouter:
    router = APIRouter(prefix="/api/v1/munich/flight-plans", tags=["Manueller MUC-Flugplan"])
    importing = Lock()

    @router.get("")
    def list_plans() -> list[dict]:
        try:
            return store.list()
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=409, detail="Gespeicherter Flugplan ungueltig") from exc

    @router.post("", status_code=201, response_model=FlightPlanSnapshot)
    async def import_plan(request: Request, service_date: date) -> FlightPlanSnapshot:
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/pdf":
            raise HTTPException(status_code=415, detail="PDF als application/pdf hochladen")
        if not importing.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="Ein PDF-Import laeuft bereits")
        try:
            try:
                pdf = await asyncio.wait_for(read_upload(request), timeout=UPLOAD_TIMEOUT_SEC)
            except asyncio.TimeoutError as exc:
                raise HTTPException(
                    status_code=408, detail="PDF-Upload hat das Zeitlimit erreicht",
                ) from exc
            try:
                pages = await run_in_threadpool(extract_pages, pdf)
                snapshot = await run_in_threadpool(
                    parse_pages, pages, service_date, hashlib.sha256(pdf).hexdigest(),
                )
                return store.save(snapshot)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            importing.release()

    @router.get("/{snapshot_id}", response_model=FlightPlanSnapshot)
    def get_plan(snapshot_id: str) -> FlightPlanSnapshot:
        return load_snapshot(store, snapshot_id)

    @router.get("/{snapshot_id}/export.csv")
    def export_csv(snapshot_id: str) -> Response:
        snapshot = load_snapshot(store, snapshot_id)
        return Response(
            flight_plan_csv(snapshot), media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="muc-{snapshot.service_date}.csv"',
            },
        )

    return router
