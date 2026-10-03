"""Bounded PDF text extraction; the child never executes PDF actions or fetches URLs."""
from __future__ import annotations

import json
import subprocess
import sys
from io import BytesIO
from pathlib import Path


def extract_pages(pdf: bytes) -> list[str]:
    from .flightplan import MAX_PDF_BYTES, FlightPlanError

    if len(pdf) > MAX_PDF_BYTES:
        raise FlightPlanError("PDF groesser als 6 MiB")
    if not pdf.startswith(b"%PDF-"):
        raise FlightPlanError("Keine PDF-Datei")
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--extract"],
            input=pdf, capture_output=True, timeout=30, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise FlightPlanError("PDF-Import hat das Zeitlimit erreicht (30 Sekunden)") from exc
    if result.returncode != 0:
        raise FlightPlanError(
            "PDF nicht lesbar, passwortgeschuetzt oder Ressourcenlimit erreicht. "
            "Offizielles Saisonflugplan-PDF verwenden.",
        )
    try:
        pages = json.loads(result.stdout)
        if not isinstance(pages, list) or not all(isinstance(p, str) for p in pages):
            raise ValueError("invalid extractor response")
    except (ValueError, UnicodeDecodeError) as exc:
        raise FlightPlanError("PDF-Extraktion lieferte keine gueltigen Seiten") from exc
    return pages


def _child() -> None:
    # Resource limits protect the single backend process from compressed or malformed PDFs.
    if sys.platform == "linux":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    from pypdf import PdfReader

    raw = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
    if len(raw) > 6 * 1024 * 1024:
        raise ValueError("PDF too large")
    reader = PdfReader(BytesIO(raw))  # Blank-password public PDF encryption is supported.
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("password required")
    if not 1 <= len(reader.pages) <= 160:
        raise ValueError("page limit exceeded")
    pages = []
    chars = 0
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout")
        chars += len(text)
        if chars > 2_000_000:
            raise ValueError("text limit exceeded")
        pages.append(text)
    sys.stdout.write(json.dumps(pages))


if __name__ == "__main__":
    _child()
