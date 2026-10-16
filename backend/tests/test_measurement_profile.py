import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.pilot import router as pilot_router
from test_pilot_evidence import persisted_coupled_run

RUN = "55555555555555558555555555555555"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "false")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        yield client


def seed(tmp_path, monkeypatch):
    persisted_coupled_run(tmp_path, RUN, [
        {"minute": m, "grid_import_kw": 100 + m, "ground_charging_kw": m,
         "parking_kw": 5} for m in range(1, 61)
    ])
    monkeypatch.setattr(pilot_router, "_run_safety_audit", lambda *_: {
        k: True for k in ("fingerprint_match", "artifact_hashes_match",
                          "report_consistent_match", "reports_hashed")
    })


def test_verified_profile_is_read_only_and_interval_end(client, tmp_path, monkeypatch):
    seed(tmp_path, monkeypatch)
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    response = client.get(f"/api/v1/runs/{RUN}/measurement-profile?metric=ground_charging_kw")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["metric"] == "ground_charging_kw"
    assert body["unit"] == "kW"
    assert body["sample_semantics"] == "interval_end_mean"
    assert body["interval_seconds"] == 60
    assert len(body["points"]) == 60
    assert body["points"][0]["model_kw"] == 1
    assert body["points"][0]["timestamp"].endswith("00:01:00Z")
    assert len(body["provenance"]["artifact_sha256"]) == 64
    assert body["evidence_level"] == "model_checked"
    assert {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before


def test_profile_fails_closed(client, tmp_path, monkeypatch):
    assert client.get(f"/api/v1/runs/{RUN}/measurement-profile").status_code == 404
    seed(tmp_path, monkeypatch)
    assert client.get(f"/api/v1/runs/{RUN}/measurement-profile?metric=voltage").status_code == 422
    assert client.get("/api/v1/runs/not-a-run/measurement-profile").status_code == 422
    monkeypatch.setattr(pilot_router, "_run_safety_audit", lambda *_: {})
    assert client.get(f"/api/v1/runs/{RUN}/measurement-profile").status_code == 409


def test_profile_keeps_instance_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "true")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.get(f"/api/v1/runs/{RUN}/measurement-profile").status_code == 401


def test_tampered_evidence_is_not_exported(client, tmp_path, monkeypatch):
    seed(tmp_path, monkeypatch)
    from app.storage import FileStorage
    path = FileStorage(tmp_path).run_dir(RUN) / "coupled-evidence.json"
    evidence = json.loads(path.read_text())
    evidence["series"][0]["grid_import_kw"] = 999
    path.write_text(json.dumps(evidence))
    assert client.get(f"/api/v1/runs/{RUN}/measurement-profile").status_code == 409


def test_practice_file_cannot_enter_formal_measurement_flow():
    text = "timestamp,measured_kw,data_kind\n2026-10-04T00:01:00Z,106,synthetic_exercise\n"
    parsed = pilot_router._inspect_csv(text, text.encode())
    assert "unexpected_column" in parsed["issues"]
