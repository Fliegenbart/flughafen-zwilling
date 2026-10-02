from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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


    @staticmethod
    def load() -> "Settings":
        raw_data_dir = os.getenv("TWIN_DATA_DIR", "data")
        raw_origins = os.getenv(
            "TWIN_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
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
            influx_token=os.getenv("INFLUX_TOKEN", "dev_token_12345"),
        )
