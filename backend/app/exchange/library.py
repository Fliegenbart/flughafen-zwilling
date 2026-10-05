"""Szenario-Bibliothek: die acht synthetischen Flughafen-Faelle fuer eine Galerie."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from fastapi import HTTPException

SCENARIO_ID = re.compile(r"^airport_case_0[1-8]_[a-z_]+_v1$")
_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"

# Allgemeinverstaendliche Texte (deutsch) je Fall; Kennzahlen kommen aus Laeufen.
TEXTS: dict[str, tuple[str, str]] = {
    "airport_case_01_spitzenwelle_v1": (
        "Deutlich mehr Ankuenfte und Abfluege als ueblich, dazu sind einige "
        "Abstellpositionen blockiert.",
        "Zeigt, ob Gates und Abfertigung eine Verkehrsspitze abfangen.",
    ),
    "airport_case_02_guillotine_v1": (
        "Gates, Start- und Landeslots und Personal brechen gleichzeitig stark ein.",
        "Haertetest: wie schnell kippt der Betrieb, wenn alles zugleich knapp wird?",
    ),
    "airport_case_03_wetter_kompression_v1": (
        "Schlechtes Wetter verringert die Slots auf der Bahn und verlaengert die "
        "Abfertigung, leichte Enteisung inklusive.",
        "Zeigt, wie sich Wetter auf Puenktlichkeit und Standzeiten auswirkt.",
    ),
    "airport_case_04_gepaeckstau_v1": (
        "Die Gepaeckanlage staut, die Sicherheitskontrolle wird langsamer und es "
        "kommen mehr Flugzeuge an.",
        "Zeigt, ob ein Engpass im Gepaeck die Abfluege verzoegert.",
    ),
    "airport_case_05_personalengpass_v1": (
        "Ein Drittel des Bodenpersonals fehlt, einige Gates sind blockiert.",
        "Zeigt, wie stark fehlendes Personal die Abfertigung bremst.",
    ),
    "airport_case_06_sicherheitswelle_v1": (
        "Die Sicherheitskontrolle braucht deutlich laenger, etwas Personal fehlt.",
        "Zeigt, ob Verzoegerungen an der Kontrolle bis zum Abflug durchschlagen.",
    ),
    "airport_case_07_enteisungsfenster_v1": (
        "Flugzeuge muessen enteist werden, das Wetter schraenkt die Bahn zusaetzlich ein.",
        "Zeigt, wie viel Puffer ein Enteisungsfenster im Umlauf kostet.",
    ),
    "airport_case_08_schwarzstart_v1": (
        "Der Betrieb startet aus einem schweren Stoerungszustand und wird "
        "schrittweise wieder hochgefahren.",
        "Zeigt, wie lange die Erholung nach einem schweren Ausfall dauert.",
    ),
}

METRIC_KEYS = (
    "otp_rate_pct",
    "avg_turnaround_min",
    "gate_utilization_avg_pct",
    "delay_avg_min",
    "completed_departures",
    "delayed_departures",
)


def library_dir() -> Path:
    override = os.getenv("TWIN_SCENARIO_LIBRARY_DIR")
    return Path(override) if override else _DEFAULT_DIR


def _load(path: Path) -> tuple[dict, str]:
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def scenario_file(scenario_id: str) -> tuple[dict, str]:
    if not SCENARIO_ID.fullmatch(scenario_id) or scenario_id not in TEXTS:
        raise HTTPException(status_code=404, detail="library scenario not found")
    path = library_dir() / f"{scenario_id}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="library scenario not found")
    return _load(path)


def _latest_metrics(storage, scenario_id: str) -> dict:
    empty = {"source": "none", "run_id": None, **{key: None for key in METRIC_KEYS}}
    if storage is None:
        return empty
    best = None
    try:
        records = storage.list_runs()
    except Exception:  # Bibliothek bleibt lesbar, auch wenn ein Lauf defekt ist.
        return empty
    for record in records:
        if (
            record.status.scenario_id != scenario_id
            or record.status.state.value != "completed"
            or record.summary is None
            or record.summary.airport_kpis is None
        ):
            continue
        key = record.status.end_ts.isoformat() if record.status.end_ts else ""
        if best is None or key > best[0]:
            best = (key, record)
    if best is None:
        return empty
    kpis = best[1].summary.airport_kpis.model_dump(mode="json")
    return {
        "source": "latest_completed_run",
        "run_id": best[1].status.run_id,
        **{key: kpis.get(key) for key in METRIC_KEYS},
    }


def list_scenarios(storage) -> list[dict]:
    result = []
    for scenario_id in sorted(TEXTS):
        path = library_dir() / f"{scenario_id}.json"
        if not path.is_file():
            continue
        data, sha256 = _load(path)
        summary, key_message = TEXTS[scenario_id]
        meta = data.get("metadata", {})
        result.append(
            {
                "id": scenario_id,
                "title": meta.get("case_name") or scenario_id,
                "summary": summary,
                "key_message": key_message,
                "metrics": _latest_metrics(storage, scenario_id),
                "targets": [
                    {key: item.get(key) for key in ("name", "metric", "op", "threshold")}
                    for item in data.get("expected_assertions", [])
                ],
                "duration_s": data.get("duration_ms", 0) / 1000,
                "data_status": "synthetic",
                "source_data_status": meta.get("data_status"),
                "sha256": sha256,
            }
        )
    return result
