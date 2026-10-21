"""Vorschau fuer die Live-Regler: genau, schnell genug, speichert nichts."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from make_live_power_fixture import busy_day  # noqa: E402
from test_pilot_evidence import project  # noqa: E402
from test_variants import AIRPORT, client  # noqa: E402,F401

from app.exchange.live import PreviewRequest  # noqa: E402
from app.exchange.variants import VariantChanges, apply_changes  # noqa: E402
from app.munich.coupled_models import CoupledConfig, PowerConfig  # noqa: E402
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
    assert base["kpis"]["departures_total"] > 300
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


def test_preview_zero_storage_explicitly_deactivates_a_battery_baseline():
    base = CoupledConfig(power=PowerConfig(
        battery_capacity_kwh=2000,
        battery_power_kw=1000,
        battery_initial_soc_pct=50,
        battery_grid_charge_below_kw=2800,
    ))

    changes = PreviewRequest(storage_kwh=0).changes()
    config, _, varied = apply_changes(
        base, "uncontrolled", VariantChanges.model_validate(changes), 1440,
    )

    assert changes == {"storage_kwh": 0}
    assert config.power.battery_capacity_kwh == 0
    assert config.power.battery_power_kw == 0
    assert config.power.battery_initial_soc_pct == config.power.battery_reserve_pct
    assert config.power.battery_grid_charge_below_kw is None
    assert varied["power.battery_capacity_kwh"] == 0
