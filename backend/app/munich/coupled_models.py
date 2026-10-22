"""Explicit modelling assumptions, never an inferred FMG fleet or aircraft rotation."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Grenzen fuer alles, was von aussen kommt (Projekte, Varianten, Muenchen-Endpunkte). Nur die
# serverseitigen Flughafenmodelle (exchange/airport_model.py) rechnen in trusted_scale() groesser.
_TRUSTED_SCALE: ContextVar[bool] = ContextVar("trusted_scale", default=False)
LIMITS = {"vehicles": 200, "fleet_total": 300, "bus_chargers": 50, "transformer_kva": 20000,
          "battery_power_kw": 20000, "parking_sessions": 275, "missions": 10000,
          "parking_jobs": 825}
TRUSTED_LIMITS = {"vehicles": 1500, "fleet_total": 4000, "bus_chargers": 500,
                  "transformer_kva": 200000, "battery_power_kw": 200000,
                  "parking_sessions": 2000, "missions": 80000, "parking_jobs": 6000}


def limit(name: str) -> int:
    return (TRUSTED_LIMITS if _TRUSTED_SCALE.get() else LIMITS)[name]


@contextmanager
def trusted_scale() -> Iterator[None]:
    """Groessere Modelle nur fuer serverseitig erzeugte Flughafenwelten."""
    token = _TRUSTED_SCALE.set(True)
    try:
        yield
    finally:
        _TRUSTED_SCALE.reset(token)

# Szenario-/Summary-Domaene bleibt stabil; die Engine-Version beschreibt den Rechenweg.
COUPLED_DOMAIN = "airport_coupled_v1"
# v2: Parkhausfenster in Ortszeit (DST-sicher), Ladefrist je Fahrzeug, unabhaengige
# Energiebilanz, Grundlast-Warnungen und Bereitschaft je Klasse/Aufgabentyp.
ENGINE_VERSION = "airport_coupled_v2"
ELECTRIFICATION_ENGINE_VERSION = "airport_electrification_v1"
GRID_SIZING_ENGINE_VERSION = "airport_electrification_v2"
PREDICTIVE_ENGINE_VERSION = "airport_electrification_v3"
# v4: Ladeplanung mit Rueckkopplung auf den Ladestand und Planreserve, eingeschwungener Endstand
# (der letzte Tag muss sich selbst tragen), steuerbares Parkhaus, Speicher laedt aus der vollen
# freien Reserve. v3 bleibt fuer eingefrorene Laeufe unveraendert.
CYCLIC_ENGINE_VERSION = "airport_electrification_v4"
PLANNING_ENGINE_VERSIONS = (PREDICTIVE_ENGINE_VERSION, CYCLIC_ENGINE_VERSION)
LEGACY_ENGINE_VERSIONS = ("airport_coupled_v1",)
EngineVersion = Literal["airport_coupled_v1", "airport_coupled_v2", "airport_electrification_v1",
                        "airport_electrification_v2", "airport_electrification_v3",
                        "airport_electrification_v4"]
FleetKind = Literal["bus", "baggage_tractor", "pushback_tug", "gpu",
                    # Weitere Abfertigungsgeraete (Engine v4, Paket 3).
                    "belt_loader", "stairs", "loader", "catering", "lavatory", "water"]
Aircraft = Literal["narrow", "wide"]
CoupledPolicy = Literal["uncontrolled", "mission_priority", "lookahead"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class FleetSpec(StrictModel):
    kind: FleetKind
    vehicles: int = Field(default=20, ge=0)
    # None preserves the original all-electric v2 model and its serialized hashes.
    electric_vehicles: int | None = Field(default=None, ge=0,
                                         exclude_if=lambda value: value is None)
    chargers: int = Field(default=8, ge=0)
    battery_capacity_kwh: float = Field(default=300, gt=0, le=1000)
    initial_soc_pct: float = Field(default=50, ge=0, le=100)
    reserve_soc_pct: float = Field(default=10, ge=0, lt=100)
    charge_target_soc_pct: float = Field(default=85, gt=0, le=100)
    charger_kw: float = Field(default=80, gt=0, le=500)
    mission_energy_kwh: float = Field(default=8, gt=0, le=500)
    service_duration_min: int = Field(default=15, ge=1, le=120)
    return_min: int = Field(default=10, ge=0, le=120)
    departure_lead_min: int = Field(default=45, ge=1, le=180)
    departure_buffer_min: int = Field(default=10, ge=0, le=60)
    arrival_allowance_min: int = Field(default=30, ge=1, le=180)
    coverage_pct: float = Field(default=35, ge=0, le=100)
    # Engine v4 (alle optional, ohne Angabe wie bisher): welche Flugrichtung die Klasse bedient,
    # wie viele Fahrzeuge je Flug fahren und was fuer Grossraumflugzeuge anders ist.
    serves: Literal["both", "arrival", "departure"] | None = Field(
        default=None, exclude_if=lambda value: value is None)
    units_per_flight: int = Field(default=1, ge=1, le=6, exclude_if=lambda value: value == 1)
    wide_units_per_flight: int | None = Field(default=None, ge=0, le=8,
                                              exclude_if=lambda value: value is None)
    wide_mission_energy_kwh: float | None = Field(default=None, gt=0, le=500,
                                                  exclude_if=lambda value: value is None)
    wide_service_duration_min: int | None = Field(default=None, ge=1, le=240,
                                                  exclude_if=lambda value: value is None)
    wide_departure_lead_min: int | None = Field(default=None, ge=1, le=240,
                                                exclude_if=lambda value: value is None)
    wide_arrival_allowance_min: int | None = Field(default=None, ge=1, le=240,
                                                   exclude_if=lambda value: value is None)
    wide_coverage_pct: float | None = Field(default=None, ge=0, le=100,
                                            exclude_if=lambda value: value is None)
    # Reine Frachtfluege: Abdeckung der Klasse (z. B. 0 fuer Busse); ohne Angabe wie Passagiere.
    freight_coverage_pct: float | None = Field(default=None, ge=0, le=100,
                                               exclude_if=lambda value: value is None)

    def for_aircraft(self, aircraft: str, freight: bool = False,
                     ) -> tuple[float, int, int, int, int, float]:
        """(Energie, Servicezeit, Vorlauf Abflug, Zeitfenster Ankunft, Fahrzeuge je Flug,
        Abdeckung) fuer Schmal- oder Grossraumflugzeuge, Passagier- oder Frachtflug."""
        wide = aircraft == "wide"

        def pick(narrow, wide_value):
            return wide_value if wide and wide_value is not None else narrow
        coverage = pick(self.coverage_pct, self.wide_coverage_pct)
        if freight and self.freight_coverage_pct is not None:
            coverage = self.freight_coverage_pct
        return (pick(self.mission_energy_kwh, self.wide_mission_energy_kwh),
                pick(self.service_duration_min, self.wide_service_duration_min),
                pick(self.departure_lead_min, self.wide_departure_lead_min),
                pick(self.arrival_allowance_min, self.wide_arrival_allowance_min),
                pick(self.units_per_flight, self.wide_units_per_flight),
                coverage)

    @model_validator(mode="after")
    def validate_physics(self) -> FleetSpec:
        if max(self.vehicles, self.electric_vehicles or 0, self.chargers) > limit("vehicles"):
            raise ValueError(f"Hoechstens {limit('vehicles')} Fahrzeuge bzw. Ladepunkte je Klasse")
        if self.electric_vehicles is not None and self.electric_vehicles > self.vehicles:
            raise ValueError("Elektrofahrzeuge duerfen die Gesamtflotte nicht uebersteigen")
        if self.chargers > self.vehicles or (
            self.kind == "bus" and self.chargers > limit("bus_chargers")
        ):
            raise ValueError("Ladepunkte passen nicht zur modellierten Flotte/Referenzgrenze")
        if self.charge_target_soc_pct <= self.reserve_soc_pct:
            raise ValueError("Ladeziel muss oberhalb der Reserve liegen")
        if self.initial_soc_pct < self.reserve_soc_pct:
            raise ValueError("Flotten-Start-SOC liegt unter der Reserve")
        for aircraft in ("narrow", "wide"):
            energy, service, lead, allowance, _, _ = self.for_aircraft(aircraft)
            if energy > self.battery_capacity_kwh * (
                self.charge_target_soc_pct - self.reserve_soc_pct
            ) / 100:
                raise ValueError("Mission benoetigt mehr Energie als oberhalb der Reserve ladbar")
            if lead - self.departure_buffer_min < service:
                raise ValueError("Abflug-Servicefenster ist kuerzer als der angenommene Einsatz")
            if allowance < service:
                raise ValueError("Ankunfts-Servicefenster ist kuerzer als der angenommene Einsatz")
        return self


def default_fleets() -> list[FleetSpec]:
    return [
        FleetSpec(kind="bus"),
        FleetSpec(kind="baggage_tractor", vehicles=35, chargers=12,
                  battery_capacity_kwh=80, charger_kw=22, mission_energy_kwh=4,
                  service_duration_min=20, return_min=5, departure_lead_min=60,
                  departure_buffer_min=15, coverage_pct=100),
        FleetSpec(kind="pushback_tug", vehicles=10, chargers=4,
                  battery_capacity_kwh=150, charger_kw=80, mission_energy_kwh=6,
                  service_duration_min=10, return_min=10, departure_lead_min=20,
                  departure_buffer_min=0, coverage_pct=100),
        FleetSpec(kind="gpu", vehicles=35, chargers=10, battery_capacity_kwh=150,
                  charger_kw=50, mission_energy_kwh=20, service_duration_min=30,
                  return_min=5, departure_lead_min=60, departure_buffer_min=15,
                  coverage_pct=100),
    ]


ParkingGroupKind = Literal["traveler", "day", "dc"]


class ParkingGroup(StrictModel):
    """Eine Nutzergruppe im Parkhaus (Engine v4): Reisende mit Frist bis 24 h, Tagesgaeste mit
    Rueckkehr am selben Tag, Schnelllader (kurz, nie verschoben oder gedrosselt)."""
    group: ParkingGroupKind
    sessions: int = Field(ge=0)
    charger_kw: float = Field(gt=0, le=400)
    # Hoechste Standzeit am Ladepunkt (z. B. Blockiergebuehr oder Zeitgrenze des Betreibers).
    max_dwell_min: int | None = Field(default=None, ge=15, le=1440,
                                      exclude_if=lambda value: value is None)
    # Ankuenfte je Ortsstunde; ohne Angabe aus den Fluegen der Welt abgeleitet.
    arrival_by_hour: list[float] | None = Field(default=None, min_length=24, max_length=24,
                                                exclude_if=lambda value: value is None)


class PowerConfig(StrictModel):
    grid_import_limit_kw: float = Field(default=3500, ge=0, le=100000)
    grid_export_limit_kw: float = Field(default=2000, ge=0, le=100000)
    background_load_kw: float = Field(default=22000, ge=0, le=100000)
    chp_output_kw: float = Field(default=18000, ge=0, le=100000)
    pv_capacity_kwp: float = Field(default=7000, ge=0, le=100000)
    pv_peak_factor: float = Field(default=0.55, ge=0, le=1)
    apron_transformer_kva: float = Field(default=4500, gt=0)
    parking_transformer_kva: float = Field(default=2500, gt=0)
    power_factor: float = Field(default=0.95, ge=0.01, le=1)
    transformer_efficiency: float = Field(default=0.98, ge=0.5, le=1)
    charging_efficiency: float = Field(default=0.92, ge=0.01, le=1)
    battery_capacity_kwh: float = Field(default=0, ge=0, le=50000)
    battery_power_kw: float = Field(default=1000, ge=0)
    battery_initial_soc_pct: float = Field(default=50, ge=0, le=100)
    battery_reserve_pct: float = Field(default=10, ge=0, le=100)
    battery_efficiency: float = Field(default=0.95, ge=0.01, le=1)
    # Optional (Varianten): Speicher laedt zusaetzlich aus dem Netz, solange der Netzbezug
    # unter dieser Schwelle liegt. None = bisheriges Verhalten (nur PV/BHKW-Ueberschuss);
    # None wird nicht serialisiert, damit Welt-Hashes alter Laeufe gleich bleiben.
    battery_grid_charge_below_kw: float | None = Field(
        default=None, ge=0, le=100000, exclude_if=lambda value: value is None,
    )
    parking_sessions: int = Field(default=200, ge=0)
    parking_charger_kw: float = Field(default=11, gt=0, le=150)
    # Engine v4: Parkhaus nach Nutzergruppen; None = Standardaufteilung der parking_sessions.
    parking_groups: list[ParkingGroup] | None = Field(default=None, max_length=12,
                                                      exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def valid_storage(self) -> PowerConfig:
        if max(self.apron_transformer_kva, self.parking_transformer_kva) > limit("transformer_kva"):
            raise ValueError("Transformator ausserhalb der Modellgrenze")
        if self.battery_power_kw > limit("battery_power_kw"):
            raise ValueError("Speicherleistung ausserhalb der Modellgrenze")
        if self.parking_sessions > limit("parking_sessions"):
            raise ValueError("Zu viele Parkhaus-Ladevorgaenge fuer das Modell")
        if self.battery_initial_soc_pct < self.battery_reserve_pct:
            raise ValueError("Speicher-Start-SOC liegt unter der Reserve")
        if self.battery_grid_charge_below_kw is not None and (
            self.battery_capacity_kwh <= 0 or self.battery_power_kw <= 0
        ):
            raise ValueError("Netzladung des Speichers benoetigt Kapazitaet und Leistung")
        if self.parking_groups is not None and (
            sum(g.sessions for g in self.parking_groups) != self.parking_sessions
        ):
            raise ValueError("Parkhaus-Gruppen passen nicht zur Zahl der Ladevorgaenge")
        return self


class StressEvent(StrictModel):
    start_min: int = Field(ge=0, le=1500)
    end_min: int = Field(gt=0, le=1500)
    grid_import_limit_kw: float | None = Field(default=None, ge=0, le=100000)
    fleet_kind: FleetKind | None = None
    offline_chargers: int = Field(default=0, ge=0, le=200)

    @model_validator(mode="after")
    def valid_effect(self) -> StressEvent:
        if self.start_min >= self.end_min:
            raise ValueError("Stoerungsbeginn muss vor dem Ende liegen")
        if self.grid_import_limit_kw is None and not self.offline_chargers:
            raise ValueError("Stoerung hat keine Wirkung")
        if bool(self.offline_chargers) != bool(self.fleet_kind):
            raise ValueError("Ladepunktausfall benoetigt Fahrzeugklasse und Anzahl")
        return self


class CoupledConfig(StrictModel):
    power: PowerConfig = Field(default_factory=PowerConfig)
    fleets: list[FleetSpec] = Field(default_factory=default_fleets, min_length=1, max_length=10)
    warmup_min: int = Field(default=120, ge=0, le=240)
    drain_min: int = Field(default=240, ge=0, le=480)
    shared_group_policy: Literal["reject_unresolved", "independent_entries_assumption"] = (
        "reject_unresolved"
    )
    stress_events: list[StressEvent] = Field(default_factory=list, max_length=20)
    repeat_days: int = Field(default=1, ge=1, le=3, exclude_if=lambda value: value == 1)
    # Engine v4: Anteil der Fluege mit Grossraumflugzeug (zufaellig je Flug, fester Seed).
    widebody_share_pct: float = Field(default=0, ge=0, le=100,
                                      exclude_if=lambda value: value == 0)
    # Engine v4: Anteil Frachtfluege je Ortsstunde (0..1) und ihr Grossraumanteil.
    freight_share_by_hour: list[float] | None = Field(
        default=None, min_length=24, max_length=24, exclude_if=lambda value: value is None)
    freight_widebody_share_pct: float = Field(default=0, ge=0, le=100,
                                              exclude_if=lambda value: value == 0)

    @model_validator(mode="after")
    def unique_fleets(self) -> CoupledConfig:
        if self.freight_share_by_hour is not None and any(
                not 0 <= s <= 1 for s in self.freight_share_by_hour):
            raise ValueError("Frachtanteil je Stunde zwischen 0 und 1")
        if len({f.kind for f in self.fleets}) != len(self.fleets):
            raise ValueError("Fahrzeugklasse mehrfach definiert")
        if sum(f.vehicles for f in self.fleets) > limit("fleet_total"):
            raise ValueError(f"Maximal {limit('fleet_total')} modellierte Fahrzeuge")
        return self


class CoupledRequest(StrictModel):
    flight_plan_snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    seed: int = Field(default=42, ge=0, le=2147483647)
    config: CoupledConfig = Field(default_factory=CoupledConfig)


class Mission(StrictModel):
    mission_id: str = Field(pattern=r"^[a-z_]+-[a-f0-9]{16}$")
    source_entry_id: str = Field(pattern=r"^[a-f0-9]{16}$")
    kind: FleetKind
    direction: Literal["arrival", "departure"]
    published_min: int
    release_min: int
    deadline_min: int
    duration_min: int = Field(gt=0)
    return_min: int = Field(ge=0)
    energy_kwh: float = Field(gt=0)
    service_day: int = Field(default=0, ge=0, le=2, exclude_if=lambda value: value == 0)
    aircraft: Aircraft | None = Field(default=None, exclude_if=lambda value: value is None)
    freight: bool = Field(default=False, exclude_if=lambda value: not value)


class ParkingJob(StrictModel):
    id: str
    release_min: int
    deadline_min: int
    energy_kwh: float = Field(gt=0)
    charger_kw: float = Field(gt=0)
    # Engine v4: Nutzergruppe; "dc" (Schnelllader) wird nie verschoben oder gedrosselt.
    group: ParkingGroupKind | None = Field(default=None, exclude_if=lambda value: value is None)


class CoupledWorld(StrictModel):
    engine_version: EngineVersion = ENGINE_VERSION
    seed: int
    source_plan_sha256: str
    config: CoupledConfig
    day_start_utc: str
    day_minutes: int
    start_min: int
    end_min: int
    missions: list[Mission] = Field(min_length=1)
    parking_jobs: list[ParkingJob]
    warnings: list[str]
    world_hash: str

    @model_validator(mode="after")
    def bounded(self) -> CoupledWorld:
        if len(self.missions) > limit("missions") or len(self.parking_jobs) > limit("parking_jobs"):
            raise ValueError("Welt ausserhalb der Modellgrenzen")
        return self


class TaskReadiness(StrictModel):
    """Aufgabenbereitschaft je Fahrzeugklasse und Aufgabentyp (Ankunft/Abflug)."""
    kind: FleetKind
    direction: Literal["arrival", "departure"]
    mission_count: int = 0
    missions_on_time: int = 0
    missions_uncompleted: int = 0
    on_time_pct: float | None = None
    energy_wait_min: int = 0
    resource_wait_min: int = 0
    energy_wait_share_pct: float | None = None


class CoupledKpis(StrictModel):
    evidence_level: Literal["schedule_driven_assumptions_uncalibrated"] = (
        "schedule_driven_assumptions_uncalibrated"
    )
    published_entry_count: int = 0
    mission_count: int = 0
    missions_completed: int = 0
    missions_on_time: int = 0
    missions_uncompleted: int = 0
    mission_on_time_pct: float = 0
    completed_mission_delay_avg_min: float | None = None
    modeled_departure_count: int = 0
    departures_ready_on_time: int = 0
    departure_readiness_pct: float | None = None
    departure_deadline_violation_lower_bound_avg_min: float | None = None
    departures_uncompleted: int = 0
    energy_wait_total_min: int = 0
    resource_wait_total_min: int = 0
    fleet_initial_kwh: float = 0
    fleet_final_kwh: float = 0
    fleet_charged_kwh: float = 0
    fleet_consumed_kwh: float = 0
    fleet_energy_balance_error_kwh: float = 0
    fleet_reserve_violations: int = 0
    transformer_loss_kwh: float = 0
    model_horizon_hours: float = 0
    # Ab airport_coupled_v2; Defaults halten aeltere Summaries lesbar.
    storage_energy_balance_error_kwh: float = 0
    power_balance_check: Literal["bookkeeping_identity_not_independent"] = (
        "bookkeeping_identity_not_independent"
    )
    background_unserved_kwh: float = 0
    background_unserved_minutes: int = 0
    readiness_by_task: list[TaskReadiness] = Field(default_factory=list)
    energy_wait_share_pct: float | None = None
    bottleneck: Literal["none", "energy", "resource", "energy_and_resource"] | None = None
    model_warnings: list[str] = Field(default_factory=list)
