from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    allowed_origins: list[str]
    log_level: str
    build_git_commit: str
    influx_url: str
    influx_org: str
    influx_bucket: str
    influx_token: str
    grafana_base_url: str
    enable_playbook_synth: bool
    playbook_budget_sec_default: int
    playbook_budget_sec_max: int
    playbook_max_active_jobs: int


    @staticmethod
    def load() -> "Settings":
        raw_data_dir = os.getenv("TWIN_DATA_DIR", "data")
        raw_origins = os.getenv(
            "TWIN_ALLOWED_ORIGINS",
            (
                "http://localhost:5173,http://127.0.0.1:5173,"
                "http://localhost:5174,http://127.0.0.1:5174,"
                "http://localhost:5175,http://127.0.0.1:5175,"
                "http://localhost:5176,http://127.0.0.1:5176,"
                "http://localhost:3000,http://127.0.0.1:3000"
            ),
        )
        origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
        if not origins:
            origins = ["http://localhost:5173"]

        return Settings(
            data_dir=Path(raw_data_dir).resolve(),
            allowed_origins=origins,
            log_level=os.getenv("TWIN_LOG_LEVEL", "INFO").upper(),
            build_git_commit=os.getenv("TWIN_BUILD_GIT_COMMIT", ""),
            influx_url=os.getenv("INFLUX_URL", "http://influxdb:8086"),
            influx_org=os.getenv("INFLUX_ORG", "eon-lab"),
            influx_bucket=os.getenv("INFLUX_BUCKET", "hil-telemetry"),
            influx_token=os.getenv("INFLUX_TOKEN", ""),
            grafana_base_url=os.getenv("TWIN_GRAFANA_BASE_URL", "http://127.0.0.1:3000").strip(),
            enable_playbook_synth=_env_bool("TWIN_ENABLE_PLAYBOOK_SYNTH", False),
            playbook_budget_sec_default=max(1, int(os.getenv("TWIN_PLAYBOOK_BUDGET_SEC_DEFAULT", "60"))),
            playbook_budget_sec_max=max(1, int(os.getenv("TWIN_PLAYBOOK_BUDGET_SEC_MAX", "120"))),
            playbook_max_active_jobs=max(1, int(os.getenv("TWIN_PLAYBOOK_MAX_ACTIVE_JOBS", "1"))),
        )
