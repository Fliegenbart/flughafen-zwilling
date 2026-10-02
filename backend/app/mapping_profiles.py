from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .models import AdapterConfig, MappingProfile


class MappingProfileError(Exception):
    """Raised when mapping profiles cannot be loaded or resolved."""


PROFILES_DIR = Path(__file__).resolve().parent / "profiles"


@lru_cache(maxsize=1)
def _load_profile_map() -> dict[str, MappingProfile]:
    profiles: dict[str, MappingProfile] = {}
    for path in sorted(PROFILES_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            profile = MappingProfile.model_validate(payload)
            profiles[profile.id] = profile
        except Exception as exc:  # pragma: no cover - defensive against invalid operator files
            raise MappingProfileError(f"Invalid mapping profile file '{path.name}': {exc}") from exc
    return profiles


def list_profiles() -> list[MappingProfile]:
    return list(_load_profile_map().values())


def get_profile(profile_id: str) -> MappingProfile:
    profile = _load_profile_map().get(profile_id)
    if not profile:
        raise MappingProfileError(f"Mapping profile '{profile_id}' not found")
    return profile


def resolve_adapter_config(config: AdapterConfig) -> AdapterConfig:
    if not config.profile:
        return config

    profile = get_profile(config.profile)
    profile_adapter = profile.adapters.get(config.name)
    if not profile_adapter:
        return config

    merged_mapping = {**profile_adapter.mapping, **config.mapping}
    merged_endpoint = config.endpoint or profile_adapter.endpoint
    return config.model_copy(update={"mapping": merged_mapping, "endpoint": merged_endpoint})
