"""Vorschau fuer die Live-Regler: genau, schnell genug, speichert nichts."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from test_pilot_evidence import project  # noqa: E402
from test_variants import AIRPORT, client  # noqa: E402,F401

from app.exchange.demo_day import busy_day  # noqa: E402
from app.munich.flightplan_store import FlightPlanStore  # noqa: E402


def _busy_project(client, tmp_path):  # noqa: F811
    plan = FlightPlanStore(tmp_path).save(busy_day())
    pid = project(client)["id"]
    assert client.post(f"/api/v1/projects/{pid}/links", headers=AIRPORT, json={
        "kind": "flight_plan_snapshot", "ref_id": plan.snapshot_id}).status_code == 201
    return pid


def test_preview_is_exact_fast_and_stores_nothing(client, tmp_path):  # noqa: F811
    pid = _busy_project(client, tmp_path)
    runs_before = client.get("/api/v1/runs").json()
    started = time.perf_counter()
    base = client.post(f"/api/v1/projects/{pid}/situation/preview", json={}).json()
    elapsed = time.perf_counter() - started
    assert base["preview"] is True and base["changes"] == {}
    assert base["day_minutes"] == 1440 and len(base["requested_kw"]) > 1440
    assert base["kpis"]["departures_total"] == 205
    assert elapsed < 2.5, f"Vorschau zu langsam: {elapsed:.2f} s"
    # Mehr Anschluss: nichts fehlt mehr; weniger Anschluss: mehr Verspaetungen.
    more = client.post(f"/api/v1/projects/{pid}/situation/preview",
                       json={"grid_import_limit_kw": 4500}).json()
    less = client.post(f"/api/v1/projects/{pid}/situation/preview",
                       json={"grid_import_limit_kw": 3000}).json()
    assert more["power"]["grid_import_limit_kw"] == 4500
    assert less["kpis"]["delayed_departures"] >= base["kpis"]["delayed_departures"]
    assert more["kpis"]["delayed_departures"] <= base["kpis"]["delayed_departures"]
    battery = client.post(f"/api/v1/projects/{pid}/situation/preview",
                          json={"storage_kwh": 2000, "storage_kw": 1000}).json()
    assert battery["power"]["battery_capacity_kwh"] == 2000
    assert client.get("/api/v1/runs").json() == runs_before  # nichts gespeichert


def test_preview_rejects_nonsense(client, tmp_path):  # noqa: F811
    pid = _busy_project(client, tmp_path)
    url = f"/api/v1/projects/{pid}/situation/preview"
    assert client.post(url, json={"pv_factor": 9}).status_code == 422
    assert client.post(url, json={"storage_kw": 500}).status_code == 422
    assert client.post(url, json={"unbekannt": 1}).status_code == 422


def test_preview_under_crisis_shows_the_assumption_and_hurts(client, tmp_path):  # noqa: F811
    pid = _busy_project(client, tmp_path)
    url = f"/api/v1/projects/{pid}/situation/preview"
    base = client.post(url, json={}).json()
    assert base["crisis"] is None
    crisis = client.post(url, json={"crisis": "airport_case_07_enteisungsfenster_v1"}).json()
    assert crisis["crisis"]["name"] == "Enteisung"
    assert crisis["crisis"]["assumption"].startswith("Kälte")
    # Die Stoerung senkt den Anschluss zwischen 05 und 09 Uhr: mindestens so viel Rueckstau.
    cap = crisis["grid_cap_kw"]
    start = crisis["start_min"]
    assert min(cap) < base["power"]["grid_import_limit_kw"]
    assert cap[5 * 60 - start] < base["power"]["grid_import_limit_kw"]
    assert client.post(url, json={"crisis": "quatsch"}).status_code == 422
    # Mit Aenderung kombinierbar: gleicher Krisenfall, mehr Anschluss.
    fixed = client.post(url, json={"crisis": "airport_case_07_enteisungsfenster_v1",
                                   "grid_import_limit_kw": 5500}).json()
    assert fixed["power"]["grid_import_limit_kw"] == 5500


def test_preview_reports_limit_minutes_unserved_load_and_charging_rule(client, tmp_path):  # noqa: F811
    pid = _busy_project(client, tmp_path)
    url = f"/api/v1/projects/{pid}/situation/preview"
    base = client.post(url, json={}).json()
    k = base["kpis"]
    at_limit = sum(1 for cap, imp in zip(base["grid_cap_kw"], base["grid_import_kw"])
                   if cap > 0 and imp >= cap - 0.5)
    assert k["minutes_at_limit"] == at_limit and at_limit > 0
    assert k["background_unserved_kwh"] >= 0
    assert base["policy"] == "uncontrolled"
    rule = client.post(url, json={"charging_policy": "mission_priority"}).json()
    assert rule["policy"] == "mission_priority"
    assert rule["changes"] == {"charging_policy": "mission_priority"}
    assert client.post(url, json={"charging_policy": "egal"}).status_code == 422


def test_preview_basis_carries_the_fleet_for_the_browser(client, tmp_path):  # noqa: F811
    """Der Browser rechnet die Ladenachfrage mit diesen Weltdaten nach (liveFleet.ts)."""
    pid = _busy_project(client, tmp_path)
    base = client.post(f"/api/v1/projects/{pid}/situation/preview", json={}).json()
    fleet = base["fleet"]
    assert fleet["charging_efficiency"] == base["power"]["charging_efficiency"]
    kinds = {"bus", "baggage_tractor", "pushback_tug", "gpu"}
    assert {c["kind"] for c in fleet["classes"]} == kinds
    for cls in fleet["classes"]:
        assert cls["release_min"] == sorted(cls["release_min"])
        assert cls["mission_min"] > 0 and cls["mission_kwh"] > 0
    assert len(fleet["parking"]) == 200
    # Trafogrenzen je Sektor (kVA x Leistungsfaktor), nicht nur die Summe.
    power = base["power"]
    assert power["apron_limit_kw"] + power["parking_limit_kw"] == power["charging_limit_kw"]
    # Eine Variante liefert die Flotte ihrer eigenen Welt (hier: zusaetzliche Fahrzeuge).
    more = client.post(f"/api/v1/projects/{pid}/situation/preview",
                       json={"extra_vehicles": {"gpu": 3}}).json()
    gpu = next(c for c in more["fleet"]["classes"] if c["kind"] == "gpu")
    gpu_before = next(c for c in fleet["classes"] if c["kind"] == "gpu")
    assert gpu["vehicles"] == gpu_before["vehicles"] + 3
