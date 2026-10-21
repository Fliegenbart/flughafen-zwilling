"""Versioned, deliberately synthetic apron section, not an FMG operational dataset."""
from datetime import date

from ..munich.coupled_models import CoupledConfig, PowerConfig, default_fleets
from ..munich.flightplan import parse_pages
from .demo import _HEADER, _airport_code, _canonical_hash

REFERENCE_ID = "apron_grid_reference_v2"
SOURCES = [
    {"title": "He et al. (2026), Table 1: narrow-body GSE energy and batteries",
     "url": "https://doi.org/10.1038/s41467-026-71125-4"},
    {"title": "Leijon et al. (2022): minute-level power balance and storage dispatch",
     "url": "https://www.citelec.org/EVS35/download.php?f=papers%2FEVS35-1690131.pdf"},
    {"title": "Miller / Rutledge (2025): airport electrification and system boundaries",
     "url": "https://doi.org/10.7771/2159-6670.1314"},
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


def reference_config():
    fleets = default_fleets()
    values = {"baggage_tractor": (7.7, 50), "pushback_tug": (15.6, 72), "gpu": (50.6, 160)}
    for fleet in fleets:
        fleet.initial_soc_pct = 85
        if fleet.kind in values:
            fleet.mission_energy_kwh, fleet.battery_capacity_kwh = values[fleet.kind]
        if fleet.kind in ('gpu', 'baggage_tractor'):
            fleet.departure_lead_min = 55
        if fleet.kind == 'gpu':
            # 60 jobs/wave require 3.3 MWh at the chargers; the old 10-point layout
            # cannot replenish the last wave before midnight. 14 is an explicit
            # reference-layout assumption, held fixed for every charging policy.
            fleet.chargers = 14
            fleet.service_duration_min = 40
            fleet.arrival_allowance_min = 40
    return CoupledConfig(
        fleets=fleets, repeat_days=3, warmup_min=0, drain_min=0,
        power=PowerConfig(background_load_kw=250, chp_output_kw=0, pv_capacity_kwp=500,
                          pv_peak_factor=0.2, parking_sessions=40,
                          grid_import_limit_kw=1500),
    )
