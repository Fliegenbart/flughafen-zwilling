"""Airport Energy Check: Projektaustausch Flughafen <-> Lab (Rollen, Workflow, Hash, Evidenz)."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import time
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.exchange.router import content_hash
from app.instance_access import create_user
from app.main import create_app
from app.munich.flightplan_store import FlightPlanStore
from app.pilot import router as pilot_router
from test_coupled_world import schedule
from test_pilot_evidence import import_csv, persisted_coupled_run, project

AIRPORT = {"X-Exchange-Role": "airport"}
LAB = {"X-Exchange-Role": "lab"}
RUN_ID = "55555555555555558555555555555555"
ORIGIN = datetime(2026, 10, 4, tzinfo=timezone.utc)


@pytest.fixture
def safe_run(monkeypatch):
    monkeypatch.setattr(
        pilot_router,
        "_run_safety_audit",
        lambda _s, _r: {k: True for k in (
            "fingerprint_match", "artifact_hashes_match", "report_consistent_match",
            "reports_hashed",
        )},
    )


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "false")
    with TestClient(create_app(data_dir=tmp_path)) as test_client:
        yield test_client


def _series(minutes=range(1, 62)):
    return [
        {"minute": m, "grid_import_kw": 100.0 if 10 <= m < 20 else 50.0 + m % 3,
         "effective_grid_cap_kw": 100.0, "pv_kw": 5.0, "ground_charging_kw": 20.0 + m,
         "parking_kw": 1.0}
        for m in minutes
    ]


def _persist_rich_run(tmp_path, run_id=RUN_ID):
    sha = persisted_coupled_run(tmp_path, run_id, _series())
    # Abfluege ergaenzen (Artefakt + Hash neu schreiben).
    from app.storage import FileStorage

    storage = FileStorage(tmp_path)
    path = storage.run_dir(run_id) / "coupled-evidence.json"
    data = json.loads(path.read_bytes())
    data["departures"] = [
        {"published_min": 5, "ready_on_time": True},
        {"published_min": 25, "ready_on_time": False},
        {"published_min": 40, "ready_on_time": True},
    ]
    data["bottleneck"] = "energy"
    raw = json.dumps(data, separators=(",", ":")).encode()
    path.write_bytes(raw)
    record = storage.get_run_record(run_id)
    record.build_meta["result_artifact_hashes"] = {
        "coupled-evidence.json": hashlib.sha256(raw).hexdigest()
    }
    storage.save_run_record(record)
    assert sha
    return run_id


def _package(client, pid, run_ids=(), headers=AIRPORT, **extra):
    body = {"type": "scenario_package", "title": "Spitzenwelle", "scenario_id":
            "airport_case_01_spitzenwelle_v1", "run_ids": list(run_ids), **extra}
    return client.post(f"/api/v1/projects/{pid}/exchange", json=body, headers=headers)


def _lock(client, pid):
    response = client.put(
        f"/api/v1/pilot/projects/{pid}/tolerances",
        json={"mae_max_kw": 5, "energy_error_max_pct": 10, "lock": True},
    )
    assert response.status_code == 200, response.text


def _request(client, pid, package_id, headers=AIRPORT):
    return client.post(f"/api/v1/projects/{pid}/exchange", headers=headers, json={
        "type": "test_request", "question": "Haelt der Ladepunkt die Welle?",
        "component": "Bus-Ladepunkt 150 kW", "scenario_package_id": package_id,
    })


def _flexlab_run(client):
    content = client.get("/api/v1/lab/example.csv").text
    run_id = client.post("/api/v1/lab/imports", json={
        "csv_text": content, "filename": "example.csv", "label": "Pruefstand"}).json()["run_id"]
    for _ in range(300):
        record = client.get(f"/api/v1/lab/runs/{run_id}").json()
        if record["state"] in ("completed", "failed"):
            return record
        time.sleep(0.01)
    raise AssertionError("FlexLab run did not finish")


def test_whoami_demo_default_admin_and_header(client):
    assert client.get("/api/v1/exchange/whoami").json()["role"] == "admin"
    assert client.get("/api/v1/exchange/whoami", headers=LAB).json()["source"] == "demo_header"
    assert client.get("/api/v1/exchange/whoami", headers={"X-Exchange-Role": "root"}
                      ).status_code == 422


def test_scenario_package_hash_direction_and_frozen_content(client, tmp_path, safe_run):
    pid = project(client)["id"]
    run_id = _persist_rich_run(tmp_path)
    created = _package(client, pid, [run_id], parameters={"grid_kw": 2800})
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["direction"] == "airport_to_lab" and item["status"] == "frozen"
    assert item["content_sha256"] == content_hash(item["content"]) and item["hash_valid"]
    assert item["content"]["scenario"]["file_sha256"]
    assert item["evidence_level"] == "model_checked"
    assert "Freigabe separat" in item["notice"]
    # Airport darf keine Lab->Flughafen-Pakete senden.
    assert _package(client, pid, direction="lab_to_airport").status_code == 403
    lab = _package(client, pid, headers=LAB).json()
    assert lab["direction"] == "lab_to_airport" and lab["evidence_level"] == "synthetic"
    assert _package(client, pid, scenario_id=None).status_code == 422
    # Inhalt ist per Trigger eingefroren.
    store_db = tmp_path / "pilot" / "pilot_evidence.sqlite3"
    import sqlite3

    connection = sqlite3.connect(store_db)
    with pytest.raises(sqlite3.DatabaseError):
        connection.execute("UPDATE exchange_items SET content_json = '{}' WHERE id = ?",
                           (item["id"],))
    connection.close()


def test_profile_export_is_kw_utc_and_hashed(client, tmp_path, safe_run):
    pid = project(client)["id"]
    run_id = _persist_rich_run(tmp_path)
    item = _package(client, pid, [run_id]).json()
    response = client.get(f"/api/v1/projects/{pid}/exchange/{item['id']}/profile.csv")
    assert response.status_code == 200, response.text
    assert response.headers["x-profile-unit"] == "kW"
    assert hashlib.sha256(response.content).hexdigest() == response.headers["x-profile-sha256"]
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert list(rows[0]) == ["interval_start_utc", "interval_end_utc", "power_kw"]
    assert rows[0]["interval_start_utc"] == "2026-10-04T00:00:00Z"
    assert rows[0]["interval_end_utc"] == "2026-10-04T00:01:00Z"
    assert float(rows[0]["power_kw"]) == 21.0  # ground_charging_kw, Minute 1, unveraendert kW
    assert all(r["interval_end_utc"].endswith("Z") for r in rows)
    grid = client.get(f"/api/v1/projects/{pid}/exchange/{item['id']}/profile.json",
                      params={"metric": "grid_import_kw"}).json()
    assert grid["unit"] == "kW" and grid["timezone"] == "UTC"
    assert grid["points"][10]["power_kw"] == 100.0
    assert client.get(f"/api/v1/projects/{pid}/exchange/{item['id']}/profile.csv",
                      params={"metric": "soc_pct"}).status_code == 422
    empty = _package(client, pid).json()
    assert client.get(f"/api/v1/projects/{pid}/exchange/{empty['id']}/profile.csv"
                      ).status_code == 409


def test_test_request_workflow_roles_and_locked_criteria(client, tmp_path):
    pid = project(client)["id"]
    package = _package(client, pid).json()
    assert _request(client, pid, package["id"]).status_code == 409  # Kriterien nicht gesperrt
    _lock(client, pid)
    assert _request(client, pid, package["id"], headers=LAB).status_code == 403
    request = _request(client, pid, package["id"]).json()
    assert request["status"] == "proposed"
    assert request["content"]["acceptance_criteria"]["sha256"]
    url = f"/api/v1/projects/{pid}/exchange/{request['id']}/transition"
    assert client.post(url, json={"to": "accepted"}, headers=AIRPORT).status_code == 403
    assert client.post(url, json={"to": "scheduled"}, headers=LAB).status_code == 409
    assert client.post(url, json={"to": "accepted"}, headers=LAB).json()["status"] == "accepted"
    assert client.post(url, json={"to": "scheduled"}, headers=LAB).json()["status"] == "scheduled"
    assert client.post(url, json={"to": "done"}, headers=LAB).status_code == 409  # ohne Ergebnis
    second = _request(client, pid, package["id"]).json()
    url2 = f"/api/v1/projects/{pid}/exchange/{second['id']}/transition"
    assert client.post(url2, json={"to": "rejected"}, headers=LAB).status_code == 422
    rejected = client.post(url2, json={"to": "rejected", "reason": "Pruefstand belegt"},
                           headers=LAB).json()
    assert rejected["status"] == "rejected" and rejected["status_reason"] == "Pruefstand belegt"
    assert client.post(url2, json={"to": "accepted"}, headers=LAB).status_code == 409
    audit = client.get(f"/api/v1/projects/{pid}/exchange-audit").json()
    transitions = [a for a in audit if a["action"] == "exchange_test_request_transition"]
    assert [a["role"] for a in transitions] == ["lab", "lab", "lab"]
    assert all(a["entry_hash"] for a in audit)


def test_lab_result_flexlab_pass_is_not_empirical_pass(client):
    pid = project(client)["id"]
    _lock(client, pid)
    package = _package(client, pid).json()
    request = _request(client, pid, package["id"]).json()
    flexlab = _flexlab_run(client)
    assert flexlab["analysis"]["verdict"] == "pass"
    body = {"type": "lab_result", "test_request_id": request["id"],
            "flexlab_run_id": flexlab["run_id"], "summary": "gehalten"}
    url = f"/api/v1/projects/{pid}/exchange"
    assert client.post(url, json=body, headers=LAB).status_code == 409  # noch proposed
    tr = f"/api/v1/projects/{pid}/exchange/{request['id']}/transition"
    client.post(tr, json={"to": "accepted"}, headers=LAB)
    assert client.post(url, json=body, headers=AIRPORT).status_code == 403
    # Client darf weder Verdict noch Evidenz setzen.
    assert client.post(url, json={**body, "evidence_level": "empirical_pass"},
                       headers=LAB).status_code == 422
    result = client.post(url, json=body, headers=LAB)
    assert result.status_code == 201, result.text
    payload = result.json()
    assert payload["content"]["flexlab"]["verdict"] == "pass"
    assert len(payload["content"]["flexlab"]["analysis_sha256"]) == 64
    assert payload["evidence_level"] == "empirical_open"
    assert payload["links"]["test_request_id"] == request["id"]
    client.post(tr, json={"to": "scheduled"}, headers=LAB)
    assert client.post(tr, json={"to": "done"}, headers=LAB).json()["status"] == "done"
    comment = client.post(f"/api/v1/projects/{pid}/exchange/{payload['id']}/comments",
                          json={"text": "Danke"}, headers=AIRPORT)
    assert comment.status_code == 201
    assert client.get(f"/api/v1/projects/{pid}/exchange/{payload['id']}/comments"
                      ).json()[0]["created_by"]["role"] == "airport"


def test_lab_result_empirical_pass_only_via_holdout_assessment(client, tmp_path, safe_run):
    pid = project(client)["id"]
    _lock(client, pid)
    ids = {}
    for role, run_id, minutes in (
        ("calibration", RUN_ID, range(1, 62)),
        ("holdout", "66666666666666668666666666666666", range(101, 162)),
    ):
        series = [{"minute": m, "grid_import_kw": 100.0 + m % 3} for m in minutes]
        persisted_coupled_run(tmp_path, run_id, series)
        text = "timestamp,measured_kw\n" + "".join(
            f"{(ORIGIN + timedelta(minutes=m)).isoformat().replace('+00:00', 'Z')},100.5\n"
            for m in minutes)
        source = import_csv(client, pid, role, text, sample_semantics="interval_end_mean")
        assert source.status_code == 201, source.text
        replay = client.post(f"/api/v1/pilot/projects/{pid}/replays", json={
            "import_id": source.json()["id"], "run_id": run_id, "metric": "grid_import_kw"})
        assert replay.status_code == 201, replay.text
        ids[role] = client.post(f"/api/v1/pilot/projects/{pid}/assessments",
                                json={"import_id": replay.json()["id"]}).json()
    assert ids["holdout"]["validity_status"] == "PASS"
    package = _package(client, pid).json()
    request = _request(client, pid, package["id"]).json()
    client.post(f"/api/v1/projects/{pid}/exchange/{request['id']}/transition",
                json={"to": "accepted"}, headers=LAB)
    url = f"/api/v1/projects/{pid}/exchange"
    levels = {}
    for role, assessment in ids.items():
        levels[role] = client.post(url, headers=LAB, json={
            "type": "lab_result", "test_request_id": request["id"],
            "pilot_assessment_id": assessment["id"]}).json()["evidence_level"]
    assert levels == {"calibration": "empirical_open", "holdout": "empirical_pass"}
    overview = client.get(f"/api/v1/projects/{pid}/overview").json()
    kinds = {e["ref_id"]: e["evidence_level"] for e in overview["elements"]
             if e["kind"] == "pilot_assessment"}
    assert kinds[ids["holdout"]["id"]] == "empirical_pass"


def test_links_overview_and_package_hashes(client, tmp_path, safe_run):
    pid = project(client)["id"]
    run_id = _persist_rich_run(tmp_path)
    url = f"/api/v1/projects/{pid}/links"
    assert client.post(url, json={"kind": "coupled_run", "ref_id": run_id},
                       headers=AIRPORT).status_code == 201
    assert client.post(url, json={"kind": "coupled_run", "ref_id": run_id}).status_code == 409
    assert client.post(url, json={"kind": "coupled_run", "ref_id": "a" * 32}).status_code == 404
    assert client.post(url, json={"kind": "flight_plan_snapshot", "ref_id": "b" * 64}
                       ).status_code == 404
    flexlab = _flexlab_run(client)
    assert client.post(url, json={"kind": "flexlab_run", "ref_id": flexlab["run_id"]}
                       ).status_code == 201
    item = _package(client, pid, [run_id]).json()
    overview = client.get(f"/api/v1/projects/{pid}/overview").json()
    by_kind = {e["kind"]: e for e in overview["elements"]}
    assert by_kind["coupled_run"]["evidence_level"] == "model_checked"
    assert by_kind["flexlab_run"]["evidence_level"] == "empirical_open"
    assert by_kind["flexlab_run"]["verdict"] == "pass"
    assert overview["evidence_summary"]["empirical_pass"] == 0
    archive = zipfile.ZipFile(io.BytesIO(
        client.get(f"/api/v1/projects/{pid}/exchange-package").content))
    manifest = json.loads(archive.read("manifest.json"))
    for name, digest in manifest["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    assert manifest["items"][item["id"]]["content_sha256"] == item["content_sha256"]
    assert f"profiles/{item['id']}-{run_id}.csv" in manifest["files"]
    body = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    assert content_hash(body) == manifest["manifest_sha256"]


def test_situation_empty_and_aggregated(client, tmp_path, safe_run):
    pid = project(client)["id"]
    empty = client.get(f"/api/v1/projects/{pid}/situation").json()
    assert empty["available"] is False and empty["series"] == []
    assert empty["answer"]["peak_kw"] is None
    run_id = _persist_rich_run(tmp_path)
    client.post(f"/api/v1/projects/{pid}/links", json={"kind": "coupled_run", "ref_id": run_id})
    situation = client.get(f"/api/v1/projects/{pid}/situation").json()
    assert situation["available"] is True and situation["interval_min"] == 15
    first = situation["series"][0]
    assert first["start_utc"] == "2026-10-04T00:00:00Z"
    assert first["end_utc"] == "2026-10-04T00:15:00Z"
    assert len(situation["series"]) == 5  # 61 Minuten -> 5 Viertelstunden
    assert situation["bottleneck_windows"] == [{
        "start_utc": "2026-10-04T00:09:00Z", "end_utc": "2026-10-04T00:19:00Z",
        "minutes": 10, "peak_kw": 100.0}]
    answer = situation["answer"]
    assert answer["minutes_at_limit"] == 10 and answer["peak_kw"] == 100.0
    assert answer["delayed_departures"] == 1 and answer["departures_total"] == 3
    assert answer["bottleneck"] == "energy"
    assert [d["count"] for d in situation["departures"]] == [2, 1]
    assert situation["evidence_level"] == "model_checked"


def test_library_lists_eight_cases_and_adopts(client):
    scenarios = client.get("/api/v1/library/scenarios").json()
    assert len(scenarios) == 8
    assert all(s["data_status"] == "synthetic" and s["summary"] for s in scenarios)
    assert scenarios[0]["metrics"]["otp_rate_pct"] is None
    pid = project(client)["id"]
    adopted = client.post("/api/v1/library/scenarios/airport_case_02_guillotine_v1/adopt",
                          json={"project_id": pid}, headers=AIRPORT)
    assert adopted.status_code == 201, adopted.text
    assert adopted.json()["content"]["scenario"]["scenario_id"] == (
        "airport_case_02_guillotine_v1")
    assert client.post("/api/v1/library/scenarios/nope/adopt",
                       json={"project_id": pid}).status_code == 404


def test_real_coupled_run_profile_and_situation(client, tmp_path):
    plan = FlightPlanStore(tmp_path).save(schedule())
    runs = client.post("/api/v1/munich/coupled-comparisons",
                       json={"flight_plan_snapshot_id": plan.snapshot_id}).json()["runs"]
    run_id = runs[0]["run_id"]
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if client.get(f"/api/v1/runs/{run_id}").json()["state"] in {"completed", "failed"}:
            break
        time.sleep(0.05)
    pid = project(client)["id"]
    item = _package(client, pid, [run_id], scenario_id=None,
                    flight_plan_snapshot_id=plan.snapshot_id).json()
    assert item["content"]["flight_plan"]["content_sha256"] == plan.content_sha256
    profile = client.get(f"/api/v1/projects/{pid}/exchange/{item['id']}/profile.json").json()
    assert profile["unit"] == "kW" and profile["points"]
    situation = client.get(f"/api/v1/projects/{pid}/situation").json()
    assert situation["available"] is True, situation
    assert situation["answer"]["departures_total"] >= 1


def test_account_roles_enforced_server_side(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "true")
    monkeypatch.setenv("TWIN_COOKIE_SECURE", "false")
    create_user(tmp_path, "airportuser", "correct horse battery staple", "airport")
    create_user(tmp_path, "labuser", "correct horse battery staple", "lab")
    create_user(tmp_path, "olduser", "correct horse battery staple", "viewer")
    create_user(tmp_path, "operator", "correct horse battery staple", "operator")
    origin = {"Origin": "http://testserver"}
    with TestClient(create_app(data_dir=tmp_path)) as admin:
        admin.post("/api/v1/auth/login", json={"username": "operator",
                                                "password": "correct horse battery staple"})
        pid = admin.post("/api/v1/pilot/projects", headers=origin, json={
            "name": "P", "decision": "d", "scope": "s", "acceptance_note": "a"}).json()["id"]
        assert admin.get("/api/v1/exchange/whoami").json()["role"] == "admin"
    clients = {}
    for name in ("airportuser", "labuser", "olduser"):
        c = TestClient(create_app(data_dir=tmp_path))
        c.post("/api/v1/auth/login", json={"username": name,
                                           "password": "correct horse battery staple"})
        clients[name] = c
    # Header wird bei aktivem Login ignoriert.
    assert clients["airportuser"].get("/api/v1/exchange/whoami", headers=LAB
                                      ).json()["role"] == "airport"
    body = {"type": "scenario_package", "title": "x",
            "scenario_id": "airport_case_01_spitzenwelle_v1"}
    url = f"/api/v1/projects/{pid}/exchange"
    assert clients["olduser"].post(url, json=body, headers=origin).status_code == 403
    created = clients["airportuser"].post(url, json=body, headers={**origin, **LAB})
    assert created.status_code == 201 and created.json()["direction"] == "airport_to_lab"
    assert created.json()["created_by"]["user"] == "airportuser"
    # Fachrolle lab darf nicht in fremde Bereiche schreiben.
    assert clients["labuser"].post("/api/v1/pilot/projects", headers=origin, json={
        "name": "P", "decision": "d", "scope": "s", "acceptance_note": "a"}).status_code == 403
    assert clients["labuser"].post(url, json=body, headers=origin).json()["direction"] == (
        "lab_to_airport")
