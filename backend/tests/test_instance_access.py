from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.instance_access import create_user, install_instance_access


def _app(tmp_path: Path, monkeypatch, enabled: bool = True) -> FastAPI:
    monkeypatch.setenv("TWIN_REQUIRE_AUTH", "true" if enabled else "false")
    monkeypatch.setenv("TWIN_COOKIE_SECURE", "false")
    monkeypatch.setenv("TWIN_ALLOWED_ORIGINS", "https://operator.example.test")
    app = FastAPI()

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/status")
    def status() -> dict[str, str]:
        return {"status": "ready"}

    @app.get("/api/v1/ready")
    def ready() -> dict[str, str]:
        return {"status": "ready"}

    @app.get("/api/v1/scenarios")
    def scenarios() -> dict[str, bool]:
        return {"read": True}

    @app.post("/api/v1/scenarios")
    def create_scenario() -> dict[str, bool]:
        return {"written": True}

    @app.post("/api/v1/projects/{project_id}/situation/preview")
    def preview(project_id: str) -> dict[str, bool]:
        return {"computed": True}

    @app.get("/metrics")
    def metrics() -> dict[str, bool]:
        return {"private": True}

    install_instance_access(app, tmp_path)
    return app


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def test_auth_is_off_by_default_for_local_synthetic_demo(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch, enabled=False)
    client = TestClient(app)

    assert client.get("/api/v1/scenarios").status_code == 200
    session = client.get("/api/v1/auth/session")
    assert session.json() == {"enabled": False, "authenticated": False, "user": None, "role": None}


def test_auth_protects_api_docs_and_metrics_but_not_health_or_status(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    client = TestClient(app)

    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/status").status_code == 200
    assert client.get("/api/v1/ready").status_code == 401
    assert client.get("/api/v1/scenarios").status_code == 401
    assert client.get("/metrics").status_code == 401
    assert client.get("/docs").status_code == 401


def test_viewer_can_read_but_cannot_mutate_and_operator_needs_same_origin_csrf(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    create_user(tmp_path, "viewer", "correct horse battery staple", "viewer")
    create_user(tmp_path, "operator", "another correct horse battery staple", "operator")

    viewer = TestClient(app)
    _login(viewer, "viewer", "correct horse battery staple")
    assert viewer.get("/api/v1/auth/session").json() == {
        "enabled": True,
        "authenticated": True,
        "user": "viewer",
        "role": "viewer",
    }
    assert viewer.get("/api/v1/scenarios").status_code == 200
    assert viewer.post("/api/v1/scenarios", headers={"Origin": "http://testserver"}).status_code == 403

    operator = TestClient(app)
    _login(operator, "operator", "another correct horse battery staple")
    assert operator.post("/api/v1/scenarios").status_code == 403
    assert operator.post("/api/v1/scenarios", headers={"Origin": "https://attacker.example"}).status_code == 403
    assert operator.post("/api/v1/scenarios", headers={"Origin": "http://testserver"}).status_code == 200
    connection = sqlite3.connect(tmp_path / "access.sqlite3")
    audit_row = connection.execute(
        "SELECT username, event, detail FROM audit_log WHERE event = 'mutation_completed'"
    ).fetchone()
    connection.close()
    assert audit_row == ("operator", "mutation_completed", "path=/api/v1/scenarios status=200")
    assert "HttpOnly" in operator.post(
        "/api/v1/auth/login", json={"username": "operator", "password": "another correct horse battery staple"}
    ).headers["set-cookie"]


def test_preview_post_is_a_read_for_viewers_without_mutation_audit(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    create_user(tmp_path, "viewer", "correct horse battery staple", "viewer")
    path = "/api/v1/projects/p1/situation/preview"
    same_origin = {"Origin": "http://testserver"}

    assert TestClient(app).post(path, headers=same_origin).status_code == 401
    viewer = TestClient(app)
    _login(viewer, "viewer", "correct horse battery staple")
    assert viewer.post(path, headers=same_origin).json() == {"computed": True}
    # Die Origin-Pruefung gilt weiter; andere Schreibwege bleiben fuer Lesekonten gesperrt.
    assert viewer.post(path).status_code == 403
    assert viewer.post(path, headers={"Origin": "https://attacker.example"}).status_code == 403
    assert viewer.post(f"{path}/x", headers=same_origin).status_code == 403
    assert viewer.post("/api/v1/scenarios", headers=same_origin).status_code == 403

    connection = sqlite3.connect(tmp_path / "access.sqlite3")
    rows = connection.execute(
        "SELECT event, detail FROM audit_log "
        "WHERE event IN ('mutation_completed', 'write_rejected') ORDER BY rowid"
    ).fetchall()
    connection.close()
    # Die Vorschau steht nicht im Pruefprotokoll; abgewiesen wurden nur die echten Schreibwege.
    assert rows == [
        ("write_rejected", "/api/v1/projects/p1/situation/preview/x"),
        ("write_rejected", "/api/v1/scenarios"),
    ]


def test_failed_login_is_rate_limited_and_audit_does_not_store_password(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    create_user(tmp_path, "operator", "another correct horse battery staple", "operator")
    client = TestClient(app)

    for _ in range(5):
        assert client.post("/api/v1/auth/login", json={"username": "operator", "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "operator", "password": "wrong"}).status_code == 429

    database = (tmp_path / "access.sqlite3").read_bytes()
    assert b"another correct horse battery staple" not in database
    assert b"wrong" not in database


def test_ip_rate_limit_blocks_username_floods(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    client = TestClient(app)

    for index in range(20):
        response = client.post(
            "/api/v1/auth/login",
            json={"username": f"user{index:02d}", "password": "wrong password"},
        )
        assert response.status_code == 401
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "new-user", "password": "wrong password"},
    ).status_code == 429


def test_global_failures_only_throttle_and_never_lock_out_legitimate_users(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    create_user(tmp_path, "operator", "another correct horse battery staple", "operator")
    store = app.state.instance_access
    for index in range(150):
        token, _, retry = store.login("operator", "wrong", f"10.0.{index}.1:operator", f"10.0.{index}.1")
        assert token is None and retry == 0
    assert store.global_delay() > 0
    token, principal, retry = store.login(
        "operator", "another correct horse battery staple", "10.9.9.9:operator", "10.9.9.9"
    )
    assert retry == 0 and token and principal and principal.username == "operator"


def test_user_lock_is_per_ip_and_short_with_exponential_backoff(tmp_path, monkeypatch) -> None:
    import app.instance_access as access

    app = _app(tmp_path, monkeypatch)
    create_user(tmp_path, "operator", "another correct horse battery staple", "operator")
    store = app.state.instance_access
    clock = [1_000_000.0]
    monkeypatch.setattr(access.time, "time", lambda: clock[0])
    for _ in range(5):
        assert store.login("operator", "wrong", "1.1.1.1:operator", "1.1.1.1")[2] == 0
    assert store.login("operator", "wrong", "1.1.1.1:operator", "1.1.1.1")[2] == 15
    # Ein anderer Client ist von der Sperre des Angreifers nicht betroffen.
    assert store.login(
        "operator", "another correct horse battery staple", "2.2.2.2:operator", "2.2.2.2"
    )[0]
    clock[0] += 16
    assert store.login("operator", "wrong", "1.1.1.1:operator", "1.1.1.1")[2] == 0
    assert store.login("operator", "wrong", "1.1.1.1:operator", "1.1.1.1")[2] == 30
    clock[0] += 31
    assert store.login(
        "operator", "another correct horse battery staple", "1.1.1.1:operator", "1.1.1.1"
    )[0]
