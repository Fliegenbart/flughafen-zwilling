"""Steckbrief eines echten Flughafens fuer das Elektrifizierungsmodell.

Je Flughafen eine Datei unter data/airports/<IATA>.json. Jede Zahl, die das Modell treibt,
traegt eine Begruendung mit oeffentlichen Quellen. Was nicht belegt ist, steht dort als Annahme.
Die Flotte bemisst scripts/size_airport_fleets.py aus dem Modell selbst (nicht aus Schaetzungen).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Umgebungsvariable nur fuer Tests und Vorbereitung ausserhalb des Repositorys.
AIRPORTS_DIR = Path(os.environ.get("TWIN_AIRPORTS_DIR")
                    or Path(__file__).resolve().parent / "data" / "airports")
FLEET_KINDS = ("bus", "baggage_tractor", "pushback_tug", "gpu")


class Basis(BaseModel):
    """Woher ein Wert kommt: kurze Begruendung in eigenen Worten und oeffentliche Quellen."""
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=10, max_length=900)
    sources: list[str] = Field(default_factory=list, max_length=8)
    assumption: bool = False

    @field_validator("sources")
    @classmethod
    def https_only(cls, value: list[str]) -> list[str]:
        if any(not s.startswith("https://") for s in value):
            raise ValueError("Quellen als https-Adressen")
        return value


class Fact(BaseModel):
    """Eine Zeile im Steckbrief der Kundenseite."""
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=2, max_length=60)
    value: str = Field(min_length=1, max_length=200)
    source: str = Field(pattern=r"^https://")


class FleetSizing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicles: dict[str, int]
    chargers: dict[str, int]
    basis: Basis


class AirportSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Z]{3}$")
    name: str = Field(min_length=2, max_length=40)
    full_name: str = Field(min_length=2, max_length=90)
    as_of: str = Field(pattern=r"^20\d\d-\d\d$")
    departures_per_day: float = Field(gt=0, le=2000)
    departures_basis: Basis
    departures_by_hour: list[float] = Field(min_length=24, max_length=24)
    arrivals_by_hour: list[float] = Field(min_length=24, max_length=24)
    profile_basis: Basis
    coverage_pct: dict[str, float]
    coverage_basis: Basis
    electric_share_now_pct: float | None = Field(default=None, ge=0, le=100)
    electric_share_basis: Basis
    parking_sessions_per_day: int = Field(ge=0, le=2000)
    parking_basis: Basis
    reserve_kw_public: float | None = Field(default=None, gt=0, le=200000)
    reserve_basis: Basis | None = None
    facts: list[Fact] = Field(min_length=3, max_length=10)
    # Erst nach scripts/size_airport_fleets.py vorhanden.
    fleet: FleetSizing | None = None

    @field_validator("departures_by_hour", "arrivals_by_hour")
    @classmethod
    def weights(cls, value: list[float]) -> list[float]:
        if any(w < 0 for w in value) or sum(value) <= 0:
            raise ValueError("Stundengewichte muessen >= 0 sein und zusammen > 0")
        return value

    @field_validator("coverage_pct")
    @classmethod
    def coverage(cls, value: dict[str, float]) -> dict[str, float]:
        if set(value) != set(FLEET_KINDS) or any(not 0 <= v <= 100 for v in value.values()):
            raise ValueError(f"Abdeckung fuer genau {FLEET_KINDS} in Prozent")
        return value

    @model_validator(mode="after")
    def reserve_needs_basis(self) -> AirportSpec:
        if (self.reserve_kw_public is None) != (self.reserve_basis is None):
            raise ValueError("Oeffentliche Reserve nur mit Begruendung")
        return self


@lru_cache(maxsize=32)
def load_spec(airport: str) -> AirportSpec:
    path = AIRPORTS_DIR / f"{airport}.json"
    if not path.is_file() or not airport.isalpha():
        raise KeyError(airport)
    return AirportSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))


def available_airports() -> list[str]:
    return sorted(p.stem for p in AIRPORTS_DIR.glob("*.json"))


def public_airports() -> list[dict]:
    """Was die Kundenseite ueber jeden Flughafen zeigt: Fakten mit Quellen und Modellannahmen.
    Nur Flughaefen mit bemessener Flotte und gerechneter Tabelle sind waehlbar."""
    from .electrification_atlas import load_atlas

    out = []
    for airport in available_airports():
        try:
            spec = load_spec(airport)
        except (KeyError, ValueError):
            # Eine fehlerhafte Datei darf die Liste der anderen Flughaefen nicht verhindern.
            continue
        if spec.fleet is None or load_atlas(airport) is None:
            continue
        out.append(spec.model_dump(mode="json"))
    return out
