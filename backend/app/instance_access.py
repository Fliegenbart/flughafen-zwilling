"""Optional, single-instance access control for a dedicated Airport pilot."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$")
_ROLES = {"viewer", "operator"}
# Fachrollen fuer den Projektaustausch (Airport Energy Check). Basisrolle bleibt
# viewer/operator; die Fachrolle liegt in einer eigenen Tabelle (rueckwaertskompatibel).
EXCHANGE_ROLES = {"airport", "lab", "admin"}
# Pfade, auf die airport/lab ohne operator-Basisrolle schreiben duerfen.
_EXCHANGE_WRITE_PREFIXES = ("/api/v1/projects/", "/api/v1/library/")
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_NO_STORE = {"Cache-Control": "no-store"}
# Fehlversuchs-Grenzen. Zaehler liegen im Prozessspeicher und gelten nur mit
# genau einem uvicorn-Worker (--workers 1), siehe docs/PILOT_OPERATIONS.md.
_WINDOW_SECONDS = 300
_IP_LIMIT = 20
_USER_FREE_ATTEMPTS = 5
_USER_BASE_LOCK = 15
_USER_MAX_LOCK = 300
_GLOBAL_THROTTLE_FROM = 100
_GLOBAL_MAX_DELAY = 2.0


def _backoff_seconds(failures: int) -> int:
    """Sperrdauer nach dem n-ten Fehlversuch je IP+Nutzer (n >= 5)."""
    steps = max(0, failures - _USER_FREE_ATTEMPTS)
    return min(_USER_MAX_LOCK, _USER_BASE_LOCK * (2**min(steps, 10)))
_OPEN_PATHS = {
    "/api/v1/health",
    "/api/v1/status",
    "/api/v1/auth/login",
    "/api/v1/auth/session",
}


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return min(max(value, minimum), maximum)


@dataclass(frozen=True)
class AccessConfig:
    enabled: bool
    cookie_secure: bool
    session_ttl_seconds: int
    allowed_origins: frozenset[str]

    @classmethod
    def from_environment(cls) -> AccessConfig:
        origins = frozenset(
            value.strip().rstrip("/")
            for value in os.getenv("TWIN_ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        )
        return cls(
            enabled=_env_bool("TWIN_REQUIRE_AUTH", False),
            # A customer instance must opt out explicitly for a local HTTP-only test.
            cookie_secure=_env_bool("TWIN_COOKIE_SECURE", True),
            session_ttl_seconds=_env_int("TWIN_SESSION_TTL_SECONDS", 43_200, 300, 604_800),
            allowed_origins=origins,
        )


@dataclass(frozen=True)
class Principal:
    username: str
    role: str
    exchange_role: str | None = None


def default_exchange_role(base_role: str) -> str | None:
    """Bestehende Konten: operator -> admin, viewer -> nur lesen."""
    return "admin" if base_role == "operator" else None


class AccessStore:
    """SQLite-backed credentials and sessions for one dedicated deployment."""

    def __init__(self, base_dir: Path, config: AccessConfig) -> None:
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.database_path = self.base_dir / "access.sqlite3"
        self.config = config
        self._attempts: dict[str, deque[float]] = {}
        self._ip_attempts: dict[str, deque[float]] = {}
        self._global_attempts: deque[float] = deque()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('viewer', 'operator')),
                    created_at INTEGER NOT NULL,
                    disabled_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    username TEXT NOT NULL REFERENCES users(username),
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
                CREATE TABLE IF NOT EXISTS user_exchange_roles (
                    username TEXT PRIMARY KEY REFERENCES users(username),
                    exchange_role TEXT NOT NULL
                        CHECK(exchange_role IN ('airport', 'lab', 'admin'))
                );
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    occurred_at INTEGER NOT NULL,
                    username TEXT,
                    event TEXT NOT NULL,
                    detail TEXT NOT NULL
                );
                """
            )
        os.chmod(self.database_path, 0o600)
        for suffix in ("-wal", "-shm"):
            sidecar = self.database_path.with_name(self.database_path.name + suffix)
            if sidecar.exists():
                os.chmod(sidecar, 0o600)

    @staticmethod
    def _password_hash(password: str) -> str:
        if not isinstance(password, str) or len(password) < 12:
            raise ValueError("Password must contain at least 12 characters")
        salt = secrets.token_bytes(16)
        derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
        return "scrypt$16384$8$1${}${}".format(
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(derived).decode("ascii"),
        )

    @staticmethod
    def _verify_password(password: str, stored: str) -> bool:
        try:
            algorithm, *parts = stored.split("$")
            if algorithm == "scrypt" and len(parts) == 5:
                n, r, p, encoded_salt, encoded_digest = parts
                expected = base64.urlsafe_b64decode(encoded_digest)
                actual = hashlib.scrypt(
                    password.encode("utf-8"),
                    salt=base64.urlsafe_b64decode(encoded_salt),
                    n=int(n),
                    r=int(r),
                    p=int(p),
                    dklen=len(expected),
                )
                return hmac.compare_digest(actual, expected)
            if algorithm == "pbkdf2_sha256" and len(parts) == 3:
                iterations, encoded_salt, encoded_digest = parts
                expected = base64.urlsafe_b64decode(encoded_digest)
                actual = hashlib.pbkdf2_hmac(
                    "sha256",
                    password.encode("utf-8"),
                    base64.urlsafe_b64decode(encoded_salt),
                    int(iterations),
                    dklen=len(expected),
                )
                return hmac.compare_digest(actual, expected)
        except (ValueError, TypeError, binascii.Error):
            return False
        return False

    def _audit(self, username: str | None, event: str, detail: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO audit_log(occurred_at, username, event, detail) VALUES (?, ?, ?, ?)",
                (int(time.time()), username, event, detail[:500]),
            )

    def create_user(self, username: str, password: str, role: str) -> None:
        if not _USERNAME.fullmatch(username):
            raise ValueError("Username must be 3-64 characters from A-Z, 0-9, ., _, or -")
        if role not in _ROLES | EXCHANGE_ROLES:
            raise ValueError("Role must be viewer, operator, airport, lab or admin")
        base_role = role if role in _ROLES else ("operator" if role == "admin" else "viewer")
        password_hash = self._password_hash(password)
        try:
            with self._connect() as connection:
                connection.execute(
                    "INSERT INTO users(username, password_hash, role, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (username, password_hash, base_role, int(time.time())),
                )
                if role in EXCHANGE_ROLES:
                    connection.execute(
                        "INSERT INTO user_exchange_roles(username, exchange_role) VALUES (?, ?)",
                        (username, role),
                    )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Username already exists") from exc
        self._audit(username, "user_created", "role=" + role)

    @staticmethod
    def _attempt_bucket(buckets: dict[str, deque[float]], key: str) -> deque[float]:
        if key not in buckets:
            if len(buckets) >= 1024:
                buckets.pop(next(iter(buckets)))
            buckets[key] = deque()
        return buckets[key]

    def global_delay(self) -> float:
        """Verzoegerung (Sekunden) bei vielen Fehlversuchen insgesamt; nie eine Sperre."""
        now = time.time()
        while self._global_attempts and self._global_attempts[0] <= now - _WINDOW_SECONDS:
            self._global_attempts.popleft()
        excess = len(self._global_attempts) - _GLOBAL_THROTTLE_FROM
        if excess < 0:
            return 0.0
        return min(_GLOBAL_MAX_DELAY, 0.25 * (1 + excess // 20))

    def login(
        self,
        username: str,
        password: str,
        rate_key: str,
        ip_key: str,
    ) -> tuple[str | None, Principal | None, int]:
        now = time.time()
        # Global gibt es keine harte Sperre mehr: ein Angreifer koennte sonst alle
        # berechtigten Nutzer aussperren. Die Route drosselt nur (global_delay).
        while self._global_attempts and self._global_attempts[0] <= now - _WINDOW_SECONDS:
            self._global_attempts.popleft()
        ip_attempts = self._attempt_bucket(self._ip_attempts, ip_key)
        while ip_attempts and ip_attempts[0] <= now - _WINDOW_SECONDS:
            ip_attempts.popleft()
        if len(ip_attempts) >= _IP_LIMIT:
            retry_after = max(1, int(_WINDOW_SECONDS - (now - ip_attempts[0])))
            return None, None, retry_after
        # Sperre nur je IP+Nutzer, mit kurzem exponentiellem Backoff (15 s .. 5 min).
        attempts = self._attempt_bucket(self._attempts, rate_key)
        while attempts and attempts[0] <= now - _WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= _USER_FREE_ATTEMPTS:
            lock = _backoff_seconds(len(attempts))
            remaining = lock - (now - attempts[-1])
            if remaining > 0:
                return None, None, max(1, int(remaining + 0.999))

        with self._connect() as connection:
            row = connection.execute(
                "SELECT users.username, users.password_hash, users.role, "
                "user_exchange_roles.exchange_role FROM users "
                "LEFT JOIN user_exchange_roles ON user_exchange_roles.username = users.username "
                "WHERE users.username = ? AND users.disabled_at IS NULL",
                (username,),
            ).fetchone()
        password_hash = (
            row["password_hash"] if row else self._password_hash("invalid-password-padding")
        )
        valid = isinstance(password, str) and self._verify_password(password, password_hash)
        if not row or not valid:
            attempts.append(now)
            ip_attempts.append(now)
            self._global_attempts.append(now)
            self._audit(
                username if _USERNAME.fullmatch(username) else None,
                "login_failed",
                "rate_key=" + rate_key,
            )
            return None, None, 0

        self._attempts.pop(rate_key, None)
        token = secrets.token_urlsafe(32)
        token_hash = _token_hash(token)
        principal = Principal(
            username=row["username"],
            role=row["role"],
            exchange_role=row["exchange_role"] or default_exchange_role(row["role"]),
        )
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(now),))
            connection.execute(
                "INSERT INTO sessions(token_hash, username, created_at, expires_at, last_seen_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    token_hash,
                    principal.username,
                    int(now),
                    int(now) + self.config.session_ttl_seconds,
                    int(now),
                ),
            )
        self._audit(principal.username, "login_succeeded", "rate_key=" + rate_key)
        return token, principal, 0

    def principal_for_token(self, token: str | None) -> Principal | None:
        if not token:
            return None
        now = int(time.time())
        token_hash = _token_hash(token)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.username, users.role, user_exchange_roles.exchange_role
                FROM sessions
                JOIN users ON users.username = sessions.username
                LEFT JOIN user_exchange_roles
                    ON user_exchange_roles.username = users.username
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                    AND users.disabled_at IS NULL
                """,
                (token_hash, now),
            ).fetchone()
            if row:
                connection.execute(
                    "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (now, token_hash)
                )
        if not row:
            return None
        return Principal(
            username=row["username"],
            role=row["role"],
            exchange_role=row["exchange_role"] or default_exchange_role(row["role"]),
        )

    def logout(self, token: str | None, username: str | None, detail: str) -> None:
        if token:
            with self._connect() as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),)
                )
        if username:
            self._audit(username, "logout", detail)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user(base_dir: Path, username: str, password: str, role: str) -> None:
    """Create a named user in the dedicated instance access database."""
    AccessStore(Path(base_dir), AccessConfig.from_environment()).create_user(
        username, password, role
    )


def _client_key(request: Request, username: str) -> str:
    return _client_ip(request) + ":" + username[:64]


def _client_ip(request: Request) -> str:
    # Hinter dem Proxy setzt uvicorn (--proxy-headers --forwarded-allow-ips=<Proxy-Netz>)
    # request.client auf die echte Client-IP; sonst waere es die Proxy-Adresse.
    return request.client.host if request.client else "unknown"


async def _login_payload(request: Request) -> Any:
    """Read a JSON body with a hard cap even when HTTP uses chunked framing."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > 8192:
            raise ValueError("login_payload_too_large")
        chunks.append(chunk)
    try:
        return json.loads(b"".join(chunks).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("invalid_login_payload") from exc


def _response(status_code: int, detail: str, **headers: str) -> JSONResponse:
    response_headers = dict(_NO_STORE)
    response_headers.update(headers)
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers=response_headers,
    )


def _same_origin(request: Request, config: AccessConfig) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return False
    origin = origin.rstrip("/")
    host = request.headers.get("host")
    request_origin = f"{request.url.scheme}://{host}" if host else ""
    return origin == request_origin or origin in config.allowed_origins


def install_instance_access(app: FastAPI, base_dir: Path) -> None:
    """Install optional dedicated-instance access control on a FastAPI app.

    This is intentionally not tenant aware. Every database belongs to exactly one
    customer deployment and is stored below that deployment's runtime directory.
    """
    config = AccessConfig.from_environment()
    store = AccessStore(Path(base_dir), config)
    app.state.instance_access = store

    @app.post("/api/v1/auth/login", include_in_schema=False)
    async def login(request: Request) -> JSONResponse:
        if not config.enabled:
            return _response(404, "auth_disabled")
        if request.headers.get("origin") and not _same_origin(request, config):
            return _response(403, "csrf_origin_rejected")
        content_length = request.headers.get("content-length", "0")
        if content_length.isdigit() and int(content_length) > 8192:
            return _response(413, "login_payload_too_large")
        try:
            payload = await _login_payload(request)
        except ValueError as exc:
            return _response(413 if str(exc) == "login_payload_too_large" else 400, str(exc))
        username = payload.get("username") if isinstance(payload, dict) else None
        password = payload.get("password") if isinstance(payload, dict) else None
        if not isinstance(username, str) or not isinstance(password, str):
            return _response(400, "invalid_login_payload")
        delay = store.global_delay()
        if delay:
            await asyncio.sleep(delay)
        token, principal, retry_after = store.login(
            username,
            password,
            _client_key(request, username),
            _client_ip(request),
        )
        if retry_after:
            return _response(429, "too_many_login_attempts", **{"Retry-After": str(retry_after)})
        if not token or not principal:
            return _response(401, "invalid_credentials")
        response = JSONResponse(
            {"authenticated": True, "user": principal.username, "role": principal.role},
            headers=_NO_STORE,
        )
        response.set_cookie(
            "twin_session",
            token,
            max_age=config.session_ttl_seconds,
            httponly=True,
            samesite="strict",
            secure=config.cookie_secure,
            path="/",
        )
        return response

    @app.get("/api/v1/auth/session", include_in_schema=False)
    async def session(request: Request) -> JSONResponse:
        principal = (
            store.principal_for_token(request.cookies.get("twin_session"))
            if config.enabled
            else None
        )
        return JSONResponse(
            {
                "enabled": config.enabled,
                "authenticated": bool(principal),
                "user": principal.username if principal else None,
                "role": principal.role if principal else None,
            },
            headers=_NO_STORE,
        )

    @app.post("/api/v1/auth/logout", include_in_schema=False)
    async def logout(request: Request) -> JSONResponse:
        principal = getattr(request.state, "instance_principal", None)
        store.logout(
            request.cookies.get("twin_session"),
            principal.username if principal else None,
            _client_key(request, ""),
        )
        response = JSONResponse({"authenticated": False}, headers=_NO_STORE)
        response.delete_cookie("twin_session", path="/")
        return response

    @app.middleware("http")
    async def instance_access(request: Request, call_next):
        if not config.enabled or request.method == "OPTIONS" or request.url.path in _OPEN_PATHS:
            return await call_next(request)

        principal = store.principal_for_token(request.cookies.get("twin_session"))
        request.state.instance_principal = principal
        if not principal:
            return _response(401, "authentication_required")
        if request.method not in _SAFE_METHODS:
            if not _same_origin(request, config):
                store._audit(principal.username, "csrf_rejected", request.url.path)
                return _response(403, "csrf_origin_rejected")
            exchange_write = principal.exchange_role in EXCHANGE_ROLES and (
                request.url.path.startswith(_EXCHANGE_WRITE_PREFIXES)
            )
            if (
                request.url.path != "/api/v1/auth/logout"
                and principal.role != "operator"
                and not exchange_write
            ):
                store._audit(principal.username, "write_rejected", request.url.path)
                return _response(403, "operator_role_required")
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        if request.method not in _SAFE_METHODS and response.status_code < 400:
            store._audit(
                principal.username,
                "mutation_completed",
                f"path={request.url.path} status={response.status_code}",
            )
        return response
