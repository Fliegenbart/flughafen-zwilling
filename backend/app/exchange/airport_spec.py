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
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Umgebungsvariable nur fuer Tests und Vorbereitung ausserhalb des Repositorys.
AIRPORTS_DIR = Path(os.environ.get("TWIN_AIRPORTS_DIR")
                    or Path(__file__).resolve().parent / "data" / "airports")
FLEET_KINDS = ("bus", "baggage_tractor", "pushback_tug", "gpu")
# Ladevorgaenge je Ladepunkt und Tag, wenn der Flughafen keine Zahl nennt (Recherche 10/2026:
# AC in Gaeste- und Urlaubsparkhaeusern rund 0,2 Reisende + 0,1 Tagesgaeste, Schnelllader 1,5).
AC_SESSIONS_PER_POINT = 0.3
AC_GROUPS = (("traveler", 2 / 3), ("day", 1 / 3))
DC_SESSIONS_PER_POINT = 1.5


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


class ParkingPoints(BaseModel):
    """Oeffentliche Ladepunkte an einem Standort, die am Netz des Flughafens haengen."""
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=2, max_length=80)
    kind: Literal["ac", "dc"]
    count: int = Field(ge=1, le=2000)
    # Leistung je Ladevorgang: AC hoechstens 11 kW (Bordlader), Schnelllader 75 kW.
    kw: float = Field(gt=0, le=400)
    # Gemessene Ladevorgaenge je Tag; ohne Angabe gilt die Zahl je Ladepunkt (siehe oben).
    sessions_per_day: float | None = Field(default=None, ge=0, le=2000)
    # Hoechste Standzeit am Ladepunkt (Zeitgrenze oder Blockiergebuehr des Betreibers).
    max_dwell_min: int | None = Field(default=None, ge=15, le=1440)

    def groups(self) -> list[tuple[str, float]]:
        """Ladevorgaenge je Tag und Nutzergruppe (noch nicht gerundet)."""
        if self.kind == "dc":
            return [("dc", self.sessions_per_day if self.sessions_per_day is not None
                     else self.count * DC_SESSIONS_PER_POINT)]
        total = (self.sessions_per_day if self.sessions_per_day is not None
                 else self.count * AC_SESSIONS_PER_POINT)
        return [(group, total * share) for group, share in AC_GROUPS]


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
    parking_points: list[ParkingPoints] = Field(default_factory=list, max_length=12)
    # Nur Passagierfluege je Ortsstunde, wo nachts viel Fracht fliegt (fuer das Parkhaus).
    passenger_departures_by_hour: list[float] | None = Field(default=None, min_length=24,
                                                             max_length=24)
    passenger_arrivals_by_hour: list[float] | None = Field(default=None, min_length=24,
                                                           max_length=24)
    reserve_kw_public: float | None = Field(default=None, gt=0, le=200000)
    reserve_basis: Basis | None = None
    facts: list[Fact] = Field(min_length=3, max_length=10)
    # Erst nach scripts/size_airport_fleets.py vorhanden.
    fleet: FleetSizing | None = None

    @field_validator("departures_by_hour", "arrivals_by_hour", "passenger_departures_by_hour",
                     "passenger_arrivals_by_hour")
    @classmethod
    def weights(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and (any(w < 0 for w in value) or sum(value) <= 0):
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
        if sum(n for *_, n in self.parking_sessions()) != self.parking_sessions_per_day:
            raise ValueError("parking_sessions_per_day passt nicht zu den Ladepunkten")
        return self

    def parking_sessions(self) -> list[tuple[int, str, int]]:
        """(Standort, Nutzergruppe, ganze Ladevorgaenge je Tag), nach groessten Resten gerundet."""
        raw = [(i, group, n) for i, point in enumerate(self.parking_points)
               for group, n in point.groups()]
        counts = [int(n) for *_, n in raw]
        missing = round(sum(n for *_, n in raw)) - sum(counts)
        for k in sorted(range(len(raw)), key=lambda k: (-(raw[k][2] - counts[k]), k))[:missing]:
            counts[k] += 1
        return [(i, group, n) for (i, group, _), n in zip(raw, counts) if n]


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
