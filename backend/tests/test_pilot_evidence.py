from __future__ import annotations

import hashlib
import json
import sys
import time
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.models import ModelPack, RunRecord, RunRequest, RunState, RunStatus, RunSummary, ScenarioDefinition
from app.main import create_app
from app.munich.flightplan_store import FlightPlanStore
from app.pilot import router as pilot_router
from app.pilot.router import create_router
from app.storage import FileStorage
from test_coupled_world import schedule


def app_client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    app.include_router(create_router(tmp_path))
    return TestClient(app)


def project(client: TestClient, name: str = "Gate power comparison") -> dict:
    response = client.post(
        "/api/v1/pilot/projects",
        json={
            "name": name,
            "decision": "Assess model agreement before a read-only SIL review.",
            "scope": "One bounded airport measurement series; no actuation.",
            "acceptance_note": "Thresholds are frozen per assessment.",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def csv_rows(*rows: tuple[str, str, str]) -> str:
    return "timestamp,measured_kw,model_kw\n" + "\n".join(
        ",".join(row) for row in rows
    ) + "\n"


def import_csv(
    client: TestClient,
    project_id: str,
    role: str,
    csv_text: str,
    **overrides: str,
):
    body = {
        "filename": "source.csv",
        "csv_text": csv_text,
        "role": role,
        "measurement_boundary": "Read-only exported active-power samples in kW.",
        "source_note": "Synthetic test data only.",
    }
    body.update(overrides)
    return client.post(f"/api/v1/pilot/projects/{project_id}/imports", json=body)


def test_projects_are_persistent_and_strictly_separated(tmp_path):
    with app_client(tmp_path) as client:
        first = project(client, "First")
        second = project(client, "Second")
        imported = import_csv(
            client,
            first["id"],
            "calibration",
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "10", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
                ("2026-10-04T08:02:00+00:00", "14", "13"),
            ),
        )
        assert imported.status_code == 201, imported.text
        assert client.get(f"/api/v1/pilot/projects/{first['id']}/imports").json()[0]["id"] == imported.json()["id"]
        assert client.get(f"/api/v1/pilot/projects/{second['id']}/imports").json() == []

    with app_client(tmp_path) as client:
        assert client.get(f"/api/v1/pilot/projects/{first['id']}").json()["name"] == "First"
        assert client.get("/api/v1/pilot/projects").json() == [first, second]


def test_import_reports_invalid_quality_for_nonfinite_timezone_order_and_gap(tmp_path):
    with app_client(tmp_path) as client:
        item = project(client)
        cases = [
            csv_rows(
                ("2026-10-04T08:00:00", "10", "11"),
                ("2026-10-04T08:01:00", "12", "12"),
            ),
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "nan", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
            ),
            csv_rows(
                ("2026-10-04T08:01:00+00:00", "10", "11"),
                ("2026-10-04T08:00:00+00:00", "12", "12"),
            ),
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "10", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
                ("2026-10-04T08:04:00+00:00", "14", "13"),
            ),
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "10", "11"),
                ("2026-10-04T08:00:00+00:00", "12", "12"),
            ),
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
            ),
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "inf", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
            ),
        ]
        for source in cases:
            response = import_csv(client, item["id"], "lab", source)
            assert response.status_code == 422, response.text
            payload = response.json()
            assert payload["quality"]["state"] == "invalid"
            assert payload["quality"]["issues"]
            assert payload["quality"]["sha256"] == hashlib.sha256(source.encode()).hexdigest()

        # Signed power is permitted and documented as a directional convention.
        signed = import_csv(
            client,
            item["id"],
            "lab",
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "-10", "-11"),
                ("2026-10-04T08:01:00+00:00", "-12", "-12"),
            ),
        )
        assert signed.status_code == 201, signed.text
        assert signed.json()["quality"]["state"] == "valid"


def test_user_supplied_model_run_id_cannot_unlock_assessment_pass(tmp_path):
    with app_client(tmp_path) as client:
        item = project(client)
        calibration = import_csv(
            client,
            item["id"],
            "calibration",
            csv_rows(
                ("2026-10-04T08:00:00+00:00", "10", "11"),
                ("2026-10-04T08:01:00+00:00", "12", "12"),
            ),
            model_run_id="11111111-1111-4111-8111-111111111111",
        ).json()
        overlap = import_csv(
            client,
            item["id"],
            "holdout",
            csv_rows(
                ("2026-10-04T08:01:00+00:00", "10", "10"),
                ("2026-10-04T08:02:00+00:00", "12", "12"),
            ),
        )
        assert overlap.status_code == 422
        assert "calibration_holdout_overlap" in overlap.json()["quality"]["issues"]

        assessment = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={
                "import_id": calibration["id"],
                "mae_max_kw": 1.0,
                "energy_error_max_pct": 10.0,
            },
        )
        assert assessment.status_code == 201, assessment.text
        payload = assessment.json()
        assert payload["validity_status"] == "NOT_EVALUABLE"
        assert payload["version"] == "pilot-assessment-v1"
        # Toleranzen kommen nur noch aus der eingefrorenen Projektfestlegung.
        assert payload["thresholds"]["mae_max_kw"] is None
        assert payload["evaluation_kind"] == "calibration_fit"
        assert "tolerances_not_frozen" in payload["not_evaluable_reasons"]
        assert payload["metrics"]["time_weighted_mae_kw"] == 0.5
        assert payload["metrics"]["energy_error_pct"] == 4.545455
        assert "model_provenance_not_server_verified" in payload["not_evaluable_reasons"]

        unreferenced = import_csv(
            client,
            item["id"],
            "lab",
            csv_rows(
                ("2026-10-04T09:00:00+00:00", "10", "11"),
                ("2026-10-04T09:01:00+00:00", "12", "12"),
            ),
        ).json()
        not_evaluable = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": unreferenced["id"], "mae_max_kw": 1.0, "energy_error_max_pct": 10.0},
        ).json()
        assert not_evaluable["validity_status"] == "NOT_EVALUABLE"
        assert "model_provenance_unverified" in not_evaluable["not_evaluable_reasons"]

        assessments = client.get(f"/api/v1/pilot/projects/{item['id']}/assessments")
        assert [item["id"] for item in assessments.json()] == [item["id"] for item in [payload, not_evaluable]]
        audit = client.get(f"/api/v1/pilot/projects/{item['id']}/audit")
        assert [entry["action"] for entry in audit.json()] == [
            "project_created", "import_created", "import_created", "assessment_created", "import_created", "assessment_created",
        ]


def test_evidence_package_contains_raw_sources_and_verifiable_manifest(tmp_path):
    with app_client(tmp_path) as client:
        item = project(client)
        source = csv_rows(
            ("2026-10-04T08:00:00+00:00", "10", "11"),
            ("2026-10-04T08:01:00+00:00", "12", "12"),
        )
        imported = import_csv(client, item["id"], "lab", source).json()
        package = client.get(f"/api/v1/pilot/projects/{item['id']}/package")
        assert package.status_code == 200
        assert package.headers["content-type"].startswith("application/zip")
        with zipfile.ZipFile(BytesIO(package.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert archive.read(f"imports/{imported['id']}.csv").decode() == source
            assert "read-only" in archive.read("README.md").decode().lower()
            for filename, digest in manifest["files"].items():
                assert hashlib.sha256(archive.read(filename)).hexdigest() == digest
            unsigned = {key: value for key, value in manifest.items() if key != "manifest_sha256"}
            assert hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == manifest["manifest_sha256"]


def persisted_coupled_run(base_dir: Path, run_id: str, series: list[dict]) -> str:
    storage = FileStorage(base_dir)
    scenario = ScenarioDefinition(
        id="coupled-replay-scenario",
        version="1",
        domain="airport_coupled_v1",
        duration_ms=120_000,
        tick_ms=60_000,
    )
    model = ModelPack(id="coupled-replay-model", site_profile="munich_coupled_reference_v1")
    record = RunRecord(
        status=RunStatus(
            run_id=run_id,
            state=RunState.completed,
            progress=100,
            scenario_id=scenario.id,
            model_pack_id=model.id,
            seed=42,
            realtime_mode="sil",
        ),
        request=RunRequest(scenario_id=scenario.id, model_pack_id=model.id, seed=42),
        scenario_snapshot=scenario,
        model_pack_snapshot=model,
        summary=RunSummary(
            freq_nadir_hz=0,
            volt_nadir_v=0,
            blackout_ms=0,
            switch_time_ms=0,
            final_soc_pct=0,
            io_latency_p99_ms=0,
            telemetry_hash="fixture",
            domain="airport_coupled_v1",
        ),
    )
    artifact = json.dumps({
        "day_start_utc": "2026-10-04T00:00:00+00:00",
        "series": series,
    }, separators=(",", ":")).encode()
    path = storage.run_dir(run_id) / "coupled-evidence.json"
    path.write_bytes(artifact)
    record.build_meta["result_artifact_hashes"] = {"coupled-evidence.json": hashlib.sha256(artifact).hexdigest()}
    storage.save_run_record(record)
    return hashlib.sha256(artifact).hexdigest()


def test_server_derived_replay_requires_exact_utc_alignment_and_can_pass(tmp_path, monkeypatch):
    run_id = "22222222222242228222222222222222"
    artifact_hash = persisted_coupled_run(tmp_path, run_id, [
        {"minute": 1, "grid_import_kw": 11.0},
        {"minute": 2, "grid_import_kw": 12.0},
    ])
    monkeypatch.setattr(
        pilot_router,
        "_run_safety_audit",
        lambda _storage, _run_id: {
            "fingerprint_match": True,
            "artifact_hashes_match": True,
            "report_consistent_match": True,
            "reports_hashed": True,
        },
    )
    with app_client(tmp_path) as client:
        item = project(client)
        source_text = csv_rows(
            ("2026-10-04T00:01:00+00:00", "10", "999"),
            ("2026-10-04T00:02:00+00:00", "12", "999"),
        )
        default_semantics = import_csv(client, item["id"], "calibration", source_text).json()
        mismatch = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": default_semantics["id"], "run_id": run_id, "metric": "grid_import_kw"},
        )
        assert mismatch.status_code == 409
        source = import_csv(
            client, item["id"], "lab", source_text, sample_semantics="interval_end_mean",
        ).json()
        response = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": source["id"], "run_id": run_id, "metric": "grid_import_kw"},
        )
        assert response.status_code == 201, response.text
        replay = response.json()
        assert replay["source_import_id"] == source["id"]
        assert replay["model_provenance"]["model_column_status"] == "server_verified_coupled_replay"
        assert replay["replay"]["artifact_sha256"] == artifact_hash
        assert replay["replay"]["alignment"] == "exact_full_series_interval_end_utc"
        assert (tmp_path / "pilot" / "imports" / f"{source['id']}.csv").read_text() == source_text
        assert "2026-10-04T00:01:00Z,10,11" in (
            tmp_path / "pilot" / "imports" / f"{replay['id']}.csv"
        ).read_text()

        assessment = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": replay["id"], "mae_max_kw": 1.0, "energy_error_max_pct": 10.0},
        )
        assert assessment.status_code == 201, assessment.text
        # Laborrolle, zwei Zeilen, keine Vorabtoleranzen: frueher PASS, jetzt nie.
        assert assessment.json()["validity_status"] == "NOT_EVALUABLE"
        assert {"role_not_holdout", "tolerances_not_frozen"} <= set(
            assessment.json()["not_evaluable_reasons"]
        )

        package = client.get(f"/api/v1/pilot/projects/{item['id']}/package")
        assert package.status_code == 200
        with zipfile.ZipFile(BytesIO(package.content)) as archive:
            provenance = json.loads(archive.read(f"replays/{replay['id']}/provenance.json"))
            frozen_record = archive.read(f"replays/{replay['id']}/run.json")
            frozen_evidence = archive.read(f"replays/{replay['id']}/coupled-evidence.json")
            assert hashlib.sha256(frozen_record).hexdigest() == provenance["frozen_files"]["run.json"]
            assert hashlib.sha256(frozen_evidence).hexdigest() == provenance["frozen_files"]["coupled-evidence.json"]
            assert provenance["run_artifact_hashes"]["coupled-evidence.json"] == artifact_hash

        shifted = import_csv(
            client,
            item["id"],
            "lab",
            csv_rows(
                ("2026-10-04T00:01:00+02:00", "10", "0"),
                ("2026-10-04T00:02:00+02:00", "12", "0"),
            ),
        ).json()
        rejected = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": shifted["id"], "run_id": run_id, "metric": "grid_import_kw"},
        )
        assert rejected.status_code == 409
        fabricated = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={
                "import_id": source["id"],
                "run_id": "33333333333343338333333333333333",
                "metric": "grid_import_kw",
            },
        )
        assert fabricated.status_code == 404
        (tmp_path / "runs" / run_id / "coupled-evidence.json").write_text("tampered")
        tampered = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": source["id"], "run_id": run_id, "metric": "grid_import_kw"},
        )
        assert tampered.status_code == 409


def test_sample_semantics_selects_interval_method_and_signed_cancellation_is_not_evaluable(tmp_path):
    source = csv_rows(
        ("2026-10-04T00:01:00+00:00", "10", "0"),
        ("2026-10-04T00:02:00+00:00", "10", "0"),
        ("2026-10-04T00:03:00+00:00", "10", "30"),
    )
    with app_client(tmp_path) as client:
        item = project(client)
        point = import_csv(client, item["id"], "calibration", source).json()
        right = import_csv(
            client, item["id"], "lab", source, sample_semantics="interval_end_mean",
        ).json()
        point_assessment = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": point["id"], "mae_max_kw": 100, "energy_error_max_pct": 100},
        ).json()
        right_assessment = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": right["id"], "mae_max_kw": 100, "energy_error_max_pct": 100},
        ).json()
        assert point["sample_semantics"] == "point_samples"
        assert right["sample_semantics"] == "interval_end_mean"
        assert point_assessment["metrics"]["time_weighted_mae_kw"] == 12.5
        assert right_assessment["metrics"]["time_weighted_mae_kw"] == 13.333333

        cancelling = import_csv(
            client,
            item["id"],
            "lab",
            csv_rows(
                ("2026-10-04T01:01:00+00:00", "10", "10"),
                ("2026-10-04T01:02:00+00:00", "-10", "-9"),
            ),
            sample_semantics="interval_end_mean",
        ).json()
        cancelled = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": cancelling["id"], "mae_max_kw": 100, "energy_error_max_pct": 100},
        ).json()
        assert cancelled["validity_status"] == "NOT_EVALUABLE"
        assert "measured_energy_signed_cancellation" in cancelled["not_evaluable_reasons"]
        assert cancelled["metrics"]["energy_error_pct"] is None


def test_replay_refuses_partial_coverage_and_negative_safety_receipt(tmp_path, monkeypatch):
    run_id = "44444444444444448444444444444444"
    persisted_coupled_run(tmp_path, run_id, [
        {"minute": 1, "parking_kw": 1.0},
        {"minute": 2, "parking_kw": 2.0},
        {"minute": 3, "parking_kw": 3.0},
    ])
    positive_receipt = {
        "fingerprint_match": True,
        "artifact_hashes_match": True,
        "report_consistent_match": True,
        "reports_hashed": True,
    }
    monkeypatch.setattr(pilot_router, "_run_safety_audit", lambda _storage, _run_id: positive_receipt)
    with app_client(tmp_path) as client:
        item = project(client)
        partial = import_csv(
            client,
            item["id"],
            "calibration",
            csv_rows(
                ("2026-10-04T00:01:00+00:00", "1", "0"),
                ("2026-10-04T00:02:00+00:00", "2", "0"),
            ),
        ).json()
        assert client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": partial["id"], "run_id": run_id, "metric": "parking_kw"},
        ).status_code == 409

        full = import_csv(
            client,
            item["id"],
            "lab",
            csv_rows(
                ("2026-10-04T00:01:00+00:00", "1", "0"),
                ("2026-10-04T00:02:00+00:00", "2", "0"),
                ("2026-10-04T00:03:00+00:00", "3", "0"),
            ),
        ).json()
        monkeypatch.setattr(
            pilot_router,
            "_run_safety_audit",
            lambda _storage, _run_id: {**positive_receipt, "reports_hashed": False},
        )
        rejected = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": full["id"], "run_id": run_id, "metric": "parking_kw"},
        )
        assert rejected.status_code == 409
        assert len(client.get(f"/api/v1/pilot/projects/{item['id']}/imports").json()) == 2


def test_interval_end_mean_overlap_uses_physical_interval_start_not_first_end(tmp_path):
    with app_client(tmp_path) as client:
        item = project(client)
        calibration = import_csv(
            client,
            item["id"],
            "calibration",
            csv_rows(
                ("2026-10-04T00:01:00+00:00", "10", "10"),
                ("2026-10-04T00:02:00+00:00", "11", "11"),
            ),
            sample_semantics="interval_end_mean",
        )
        assert calibration.status_code == 201, calibration.text
        # End timestamps do not overlap (00:02:00 < 00:02:30), but the holdout's
        # first one-minute interval starts at 00:01:30 and overlaps calibration.
        holdout = import_csv(
            client,
            item["id"],
            "holdout",
            csv_rows(
                ("2026-10-04T00:02:30+00:00", "12", "12"),
                ("2026-10-04T00:03:30+00:00", "13", "13"),
            ),
            sample_semantics="interval_end_mean",
        )
        assert holdout.status_code == 422
        assert "calibration_holdout_overlap" in holdout.json()["quality"]["issues"]


def test_real_coupled_run_replay_uses_hex_run_id_and_verified_safety(tmp_path, monkeypatch):
    monkeypatch.setenv("INFLUX_TOKEN", "")
    plan = FlightPlanStore(tmp_path).save(schedule())
    with TestClient(create_app(data_dir=tmp_path)) as client:
        comparison = client.post(
            "/api/v1/munich/coupled-comparisons",
            json={"flight_plan_snapshot_id": plan.snapshot_id},
        )
        assert comparison.status_code == 202, comparison.text
        run_id = comparison.json()["runs"][0]["run_id"]
        assert len(run_id) == 32 and "-" not in run_id
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            status = client.get(f"/api/v1/runs/{run_id}").json()
            if status["state"] in {"completed", "failed"}:
                break
            time.sleep(0.02)
        assert status["state"] == "completed", status
        safety = client.get(f"/api/v1/runs/{run_id}/safety").json()["audit"]
        assert all(safety[key] is True for key in (
            "fingerprint_match", "artifact_hashes_match", "report_consistent_match", "reports_hashed",
        ))
        evidence = client.get(f"/api/v1/runs/{run_id}/artifacts/coupled-evidence.json").json()
        origin = datetime.fromisoformat(evidence["day_start_utc"])
        csv_text = "timestamp,measured_kw\n" + "".join(
            f"{(origin + timedelta(minutes=int(row['minute']))).isoformat().replace('+00:00', 'Z')},"
            f"{row['grid_import_kw']}\n"
            for row in evidence["series"]
        )
        item = project(client, "Real coupled replay")
        source = import_csv(
            client,
            item["id"],
            "lab",
            csv_text,
            sample_semantics="interval_end_mean",
        )
        assert source.status_code == 201, source.text
        replay = client.post(
            f"/api/v1/pilot/projects/{item['id']}/replays",
            json={"import_id": source.json()["id"], "run_id": run_id, "metric": "grid_import_kw"},
        )
        assert replay.status_code == 201, replay.text
        assert replay.json()["replay"]["run_id"] == run_id
        assessment = client.post(
            f"/api/v1/pilot/projects/{item['id']}/assessments",
            json={"import_id": replay.json()["id"], "mae_max_kw": 0, "energy_error_max_pct": 0},
        )
        assert assessment.status_code == 201, assessment.text
        # Messreihe = Modellreihe: zirkulaer, kein PASS.
        assert assessment.json()["validity_status"] == "NOT_EVALUABLE"
        assert "circular" in assessment.json()["not_evaluable_reasons"]
