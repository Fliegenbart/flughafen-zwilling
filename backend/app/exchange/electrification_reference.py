"""Versioned, deliberately synthetic apron section, not an FMG operational dataset."""
from datetime import date

from ..munich.coupled_models import CoupledConfig, FleetSpec, PowerConfig
from ..munich.flightplan import parse_pages
from .demo import _HEADER, _airport_code, _canonical_hash

REFERENCE_ID = "apron_grid_reference_v3"
SOURCES = [
    {"title": "Hess et al. (2023): gemessener Verbrauch elektrischer Vorfeldbusse (Fraport)",
     "url": "https://doi.org/10.3390/wevj14050126"},
    {"title": "ITW GSE 7400: Abfertigungen je Ladung elektrischer Bodenstromgeraete",
     "url": "https://patlon.com/wp-content/uploads/2025/06/ITWGSE_7400-Brochure_Nov24_EN-Rev-K.pdf"},
    {"title": "Oeko-Institut (2020): gemessene Verbraeuche elektrischer Vorfeldgeraete (Stuttgart)",
     "url": "https://www.oeko.de/fileadmin/oekodoc/WP-scale-up-2.pdf"},
    {"title": "CARB/SMF (2001): Messung elektrischer Gepaeckschlepper",
     "url": "https://ww2.arb.ca.gov/sites/default/files/classic/research/apr/past/icat99-4a.pdf"},
    {"title": "Goldhofer PHOENIX E: Akku und Pushbacks je Ladung",
     "url": "https://www.electrive.com/2021/10/05/akasol-to-supply-goldhofer-with-battery-systems"},
    {"title": "Airbus A321 Aircraft Characteristics: Abfertigungsgeraete und Zeiten",
     "url": "https://aviation.hawaii.gov/wp-content/uploads/2025/06/Airbus-techdata-AC_A321_0322-2.pdf"},
    {"title": "EUROCONTROL Standard Inputs: Bodenzeiten nach Flugzeuggroesse",
     "url": "https://standard-inputs.netlify.app/chapters/turnaround_time.html"},
    {"title": "He et al. (2026): Akkus und Einsatzzeiten der Abfertigungsgeraete",
     "url": "https://doi.org/10.1038/s41467-026-71125-4"},
    {"title": "Leijon et al. (2022): minute-level power balance and storage dispatch",
     "url": "https://www.citelec.org/EVS35/download.php?f=papers%2FEVS35-1690131.pdf"},
]


def reference_day():
    rows = []

    def clock(minute):
        return f"{minute // 60:02d}:{minute % 60:02d}"

    for wave in (360, 720, 1080):
        for slot in range(60):
            departure = wave + slot * 3
            arrival = departure - 55
            number = len(rows) // 2 + 1
            airport = _airport_code(number)
            rows.extend([
                f"S XY {1000 + number} {clock(departure)} {clock(departure + 90)} "
                f"1234567 {airport} 03.10.26 27.03.27 1 Synthetic Reference",
                f"L XY {2000 + number} {clock(arrival - 90)} {clock(arrival)} "
                f"1234567 {airport} 03.10.26 27.03.27 1 Synthetic Reference",
            ])
    text = _HEADER + "\n".join(rows)
    snapshot = parse_pages([text], date(2026, 10, 3), '0' * 64)
    snapshot.source_url = 'urn:airport-twin:synthetic:apron-grid-reference-v2'
    snapshot.import_method = 'synthetic_generator'
    snapshot.evidence_level = 'synthetic_reference'
    snapshot.generated_input_sha256 = _canonical_hash({'text': text})
    snapshot.warnings = ['Synthetische Referenz, kein veroeffentlichter Muenchner Flugplan.',
                         'Kein PDF-Upload: source_pdf_sha256 ist ein Null-Platzhalter.']
    digest = _canonical_hash(snapshot.model_dump(mode='json', exclude={
        'snapshot_id', 'content_sha256', 'imported_at'}))
    snapshot.snapshot_id = snapshot.content_sha256 = digest
    return snapshot


# Fahrzeugklassen (Engine v4). Energie je Einsatz akkuseitig, fuer Schmal- und Grossraum, aus
# Messungen, Herstellerangaben und Physik (Recherche 10/2026, gegengeprueft; Herleitung und
# Quellen in docs/ELECTRIFICATION_COMPARISON.md). Zeiten in Minuten: Service am Flugzeug,
# Rueckfahrt, Vorlauf vor dem Abflug, Puffer vor dem Abflug, Zeitfenster nach der Ankunft.
# Fahrzeuge und Ladepunkte des Beispielflughafens sind Annahmen (FLEET), Abdeckung je Flughafen.
CLASSES = {
    "bus": dict(battery_capacity_kwh=300, charger_kw=80, mission_energy_kwh=6.5,
                service_duration_min=15, return_min=10, departure_lead_min=45,
                departure_buffer_min=10, arrival_allowance_min=30, units_per_flight=2,
                wide_units_per_flight=4, wide_departure_lead_min=60,
                wide_arrival_allowance_min=40, freight_coverage_pct=0),
    "baggage_tractor": dict(battery_capacity_kwh=50, charger_kw=22, mission_energy_kwh=2.5,
                            service_duration_min=20, return_min=5, departure_lead_min=55,
                            departure_buffer_min=15, arrival_allowance_min=30,
                            wide_units_per_flight=3, wide_mission_energy_kwh=3.0,
                            wide_service_duration_min=35, wide_departure_lead_min=90,
                            wide_arrival_allowance_min=60),
    "pushback_tug": dict(battery_capacity_kwh=72, charger_kw=80, mission_energy_kwh=3.0,
                         service_duration_min=10, return_min=10, departure_lead_min=20,
                         departure_buffer_min=0, arrival_allowance_min=30,
                         wide_mission_energy_kwh=8.0, wide_service_duration_min=15,
                         wide_departure_lead_min=25),
    "gpu": dict(battery_capacity_kwh=160, charger_kw=50, mission_energy_kwh=16.0,
                service_duration_min=40, return_min=5, departure_lead_min=55,
                departure_buffer_min=15, arrival_allowance_min=40, wide_units_per_flight=2,
                wide_mission_energy_kwh=42.5, wide_service_duration_min=100,
                wide_departure_lead_min=125, wide_arrival_allowance_min=125,
                freight_coverage_pct=100),
    "belt_loader": dict(battery_capacity_kwh=30, charger_kw=11, mission_energy_kwh=1.0,
                        service_duration_min=20, return_min=5, departure_lead_min=45,
                        departure_buffer_min=10, arrival_allowance_min=30, units_per_flight=2,
                        wide_units_per_flight=1, wide_mission_energy_kwh=1.5,
                        wide_service_duration_min=30, wide_departure_lead_min=60,
                        wide_arrival_allowance_min=45),
    "stairs": dict(battery_capacity_kwh=30, charger_kw=6, mission_energy_kwh=1.0,
                   service_duration_min=20, return_min=5, departure_lead_min=40,
                   departure_buffer_min=5, arrival_allowance_min=30, units_per_flight=2,
                   wide_units_per_flight=2, wide_mission_energy_kwh=1.3,
                   wide_service_duration_min=30, wide_departure_lead_min=50,
                   wide_arrival_allowance_min=40, freight_coverage_pct=0),
    "loader": dict(battery_capacity_kwh=65, charger_kw=22, mission_energy_kwh=1.5,
                   service_duration_min=15, return_min=5, departure_lead_min=45,
                   departure_buffer_min=10, arrival_allowance_min=30, units_per_flight=2,
                   wide_units_per_flight=2, wide_mission_energy_kwh=3.5,
                   wide_service_duration_min=30, wide_departure_lead_min=70,
                   wide_arrival_allowance_min=45, wide_coverage_pct=100,
                   freight_coverage_pct=100),
    "catering": dict(battery_capacity_kwh=120, charger_kw=22, mission_energy_kwh=10.0,
                     service_duration_min=25, return_min=30, departure_lead_min=75,
                     departure_buffer_min=25, arrival_allowance_min=30, serves="departure",
                     wide_units_per_flight=2, wide_mission_energy_kwh=12.0,
                     wide_service_duration_min=40, wide_departure_lead_min=90,
                     wide_arrival_allowance_min=45, wide_coverage_pct=100,
                     freight_coverage_pct=0),
    "lavatory": dict(battery_capacity_kwh=40, charger_kw=12, mission_energy_kwh=2.5,
                     service_duration_min=10, return_min=15, departure_lead_min=60,
                     departure_buffer_min=15, arrival_allowance_min=30, serves="departure",
                     wide_mission_energy_kwh=4.0, wide_service_duration_min=20,
                     wide_departure_lead_min=90, wide_coverage_pct=100, freight_coverage_pct=0),
    "water": dict(battery_capacity_kwh=40, charger_kw=12, mission_energy_kwh=2.0,
                  service_duration_min=10, return_min=15, departure_lead_min=60,
                  departure_buffer_min=15, arrival_allowance_min=30, serves="departure",
                  wide_mission_energy_kwh=3.0, wide_service_duration_min=15,
                  wide_departure_lead_min=90, wide_coverage_pct=100, freight_coverage_pct=0),
}
# Beispielflughafen: Abdeckung (Anteil der Fluege) und Flotte mit Ladepunkten (Annahmen).
# Flotte = kleinste puenktliche Dieselflotte mal Puffer: fuer die vier ersten Klassen der Puffer
# der bisherigen Referenz (Busse 3,3x, Gepaeck 2,2x, Schlepper 1,4x, Bodenstrom 2,3x; in MUC
# ergibt das 97 Busse und 47 Bodenstromgeraete, AeroGround hat 95 und 53), fuer die weiteren
# Klassen 1,5x. Ladepunkte: Baender und Treppen laden langsam am Abstellplatz (1 je Fahrzeug),
# die uebrigen neuen Klassen 1 je 2 Fahrzeuge.
COVERAGE = {"bus": 35, "baggage_tractor": 100, "pushback_tug": 100, "gpu": 100,
            "belt_loader": 100, "stairs": 35, "loader": 10, "catering": 40, "lavatory": 60,
            "water": 40}
FLEET = {"bus": (40, 16), "baggage_tractor": (35, 12), "pushback_tug": (10, 4), "gpu": (35, 14),
         "belt_loader": (48, 48), "stairs": (24, 24), "loader": (6, 3), "catering": (14, 7),
         "lavatory": (8, 4), "water": (6, 3)}


def reference_config():
    fleets = [FleetSpec(kind=kind, vehicles=FLEET[kind][0], chargers=FLEET[kind][1],
                        coverage_pct=COVERAGE[kind], initial_soc_pct=85, **values)
              for kind, values in CLASSES.items()]
    return CoupledConfig(
        fleets=fleets, repeat_days=3, warmup_min=0, drain_min=0,
        power=PowerConfig(background_load_kw=250, chp_output_kw=0, pv_capacity_kwp=500,
                          pv_peak_factor=0.2, parking_sessions=40,
                          grid_import_limit_kw=1500),
    )
