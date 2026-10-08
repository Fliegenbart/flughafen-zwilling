"""Projekt-Lagebild aus einem abgeschlossenen, gepruefte gekoppelten Run (UTC, kW)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from ..pilot.router import _verified_coupled_series

SERIES_BIN_MIN = 15
DEPARTURE_BIN_MIN = 30
LIMIT_TOLERANCE_KW = 0.5


def day_rows(series, day_minutes: int) -> list[dict]:
    """Zeilen des Verkehrstags (Intervall [minute-1, minute) liegt in 0..day_minutes).

    Vorlauf vor Mitternacht (Fahrzeuge laden sich auf) und Nachlauf liegen ausserhalb der
    Tageskurve, die Kunden sehen. Alles, was den Tag beschreibt, geht durch diese Funktion.
    """
    return [r for r in series if 0 <= int(r["minute"]) - 1 < day_minutes]


def limit_rows(series, day_minutes: int) -> list[dict]:
    """Zeilen des Verkehrstags, in denen der Netzbezug an der Grenze des Anschlusses liegt."""
    return [r for r in day_rows(series, day_minutes)
            if r["effective_grid_cap_kw"] > 0
            and r["grid_import_kw"] >= r["effective_grid_cap_kw"] - LIMIT_TOLERANCE_KW]


def minutes_at_limit(series, day_minutes: int) -> int:
    return len(limit_rows(series, day_minutes))


def _utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def empty_situation(reason: str) -> dict:
    return {
        "available": False,
        "run_id": None,
        "policy": None,
        "day_start_utc": None,
        "interval_min": SERIES_BIN_MIN,
        "series": [],
        "departures": [],
        "bottleneck_windows": [],
        "answer": {
            "bottleneck": None,
            "minutes_at_limit": None,
            "peak_kw": None,
            "delayed_departures": None,
            "departures_total": None,
            "cause_shares_pct": None,
        },
        "evidence_level": None,
        "reason": reason,
    }


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def build_situation(base_dir, record) -> dict:
    run_id = record.status.run_id
    try:
        _, _, frozen = _verified_coupled_series(base_dir, run_id, "grid_import_kw")
        evidence = json.loads(frozen["coupled-evidence.json"])
    except HTTPException as exc:
        return empty_situation(f"run_not_verified: {exc.detail}")
    origin = datetime.fromisoformat(evidence["day_start_utc"].replace("Z", "+00:00"))
    day_minutes = int(evidence.get("day_minutes") or 1440)
    bins: dict[int, dict[str, list[float]]] = {}
    for row in evidence["series"]:
        minute = int(row["minute"])  # Intervallende, Intervall [minute-1, minute)
        start = minute - 1
        index = start // SERIES_BIN_MIN
        bucket = bins.setdefault(index, {"grid": [], "cap": [], "pv": [], "charging": []})
        grid = float(row["grid_import_kw"])
        cap = float(row["effective_grid_cap_kw"])
        bucket["grid"].append(grid)
        bucket["cap"].append(cap)
        bucket["pv"].append(float(row["pv_kw"]))
        bucket["charging"].append(float(row["ground_charging_kw"]) + float(row["parking_kw"]))
    series = [
        {
            "start_utc": _utc(origin + timedelta(minutes=index * SERIES_BIN_MIN)),
            "end_utc": _utc(origin + timedelta(minutes=(index + 1) * SERIES_BIN_MIN)),
            "grid_import_kw": _mean(values["grid"]),
            "grid_limit_kw": _mean(values["cap"]),
            "pv_kw": _mean(values["pv"]),
            "charging_kw": _mean(values["charging"]),
        }
        for index, values in sorted(bins.items())
    ]
    # Fenster, Minutenzahl und Spitze beschreiben nur den Verkehrstag (day_rows), die Summe der
    # Fenster ist deshalb immer answer.minutes_at_limit.
    peak = max((float(r["grid_import_kw"]) for r in day_rows(evidence["series"], day_minutes)),
               default=0.0)
    at_limit = limit_rows(evidence["series"], day_minutes)
    windows: list[dict] = []
    for row in at_limit:
        start, grid = int(row["minute"]) - 1, float(row["grid_import_kw"])
        if windows and windows[-1]["_end"] == start:
            windows[-1]["_end"] = start + 1
            windows[-1]["peak_kw"] = max(windows[-1]["peak_kw"], round(grid, 3))
        else:
            windows.append({"_start": start, "_end": start + 1, "peak_kw": round(grid, 3)})
    bottleneck_windows = [
        {
            "start_utc": _utc(origin + timedelta(minutes=item["_start"])),
            "end_utc": _utc(origin + timedelta(minutes=item["_end"])),
            "minutes": item["_end"] - item["_start"],
            "peak_kw": item["peak_kw"],
        }
        for item in windows
    ]
    departure_bins: dict[int, list[int]] = {}
    delayed = 0
    for departure in evidence.get("departures", []):
        index = int(departure["published_min"]) // DEPARTURE_BIN_MIN
        bucket = departure_bins.setdefault(index, [0, 0])
        bucket[0] += 1
        if not departure.get("ready_on_time"):
            bucket[1] += 1
            delayed += 1
    departures = [
        {
            "start_utc": _utc(origin + timedelta(minutes=index * DEPARTURE_BIN_MIN)),
            "end_utc": _utc(origin + timedelta(minutes=(index + 1) * DEPARTURE_BIN_MIN)),
            "count": counts[0],
            "delayed": counts[1],
        }
        for index, counts in sorted(departure_bins.items())
    ]
    kpis = record.summary.coupled_kpis if record.summary else None
    energy_wait = float(kpis.energy_wait_total_min) if kpis else 0.0
    resource_wait = float(kpis.resource_wait_total_min) if kpis else 0.0
    total_wait = energy_wait + resource_wait
    shares = (
        {
            "energy": round(energy_wait / total_wait * 100, 1),
            "resource": round(resource_wait / total_wait * 100, 1),
        }
        if total_wait > 0
        else {"energy": 0.0, "resource": 0.0}
    )
    return {
        "available": True,
        "run_id": run_id,
        "policy": evidence.get("policy"),
        "day_start_utc": _utc(origin),
        "interval_min": SERIES_BIN_MIN,
        "series": series,
        "departures": departures,
        "bottleneck_windows": bottleneck_windows,
        "answer": {
            "bottleneck": evidence.get("bottleneck") or (kpis.bottleneck if kpis else None),
            "minutes_at_limit": len(at_limit),
            "peak_kw": round(peak, 3),
            "delayed_departures": delayed,
            "departures_total": len(evidence.get("departures", [])),
            "cause_shares_pct": shares,
        },
        "evidence_level": "model_checked",
        "data_status": "synthetic_assumptions_uncalibrated",
        "artifact_sha256": record.build_meta.get("result_artifact_hashes", {}).get(
            "coupled-evidence.json"
        ),
        "reason": None,
    }
