import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.munich.flightplan import FlightPlanError, parse_pages, verify_snapshot


HEADER = """Flugplan Muenchen
L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename
Datenstand: 02.10.2026
Alle Zeiten im Flugplan sind Ortszeiten. Die Flugtage beziehen sich auf Muenchen.
1 ... 7 = Montag ... Sonntag
"""


def parse(*rows, day=date(2026, 10, 3)):
    return parse_pages([HEADER + "\n".join(rows)], day, "a" * 64)


def test_muc_time_column_weekday_and_validity_are_used_not_counterpart_time():
    result = parse(
        "L XY 101 - 23:10 06:25 1234567 AAA 03.10.26 24.10.26 2 Test Air",
        "S XY 102 22:40 + 07:10 -----6- BBB CCC 03.10.26 24.10.26 1 Test Air",
        "S XY 103 09:00 10:00 ------7 AAA 03.10.26 24.10.26 1 Test Air",
        "L XY 104 08:00 10:15 1234567 AAA 04.10.26 24.10.26 1 Test Air",
    )
    assert result.arrival_entry_count == result.departure_entry_count == 1
    assert [row.flight_number for row in result.rows] == ["XY101", "XY102"]
    arrival, departure = result.rows
    assert arrival.scheduled_local == "2026-10-03T06:25:00+02:00"
    assert arrival.scheduled_utc == "2026-10-03T04:25:00+00:00"
    assert departure.scheduled_local == "2026-10-03T22:40:00+02:00"
    assert departure.counterpart_iata == "BBB"
    assert result.hourly_counts[6].arrivals == 1
    assert result.hourly_counts[22].departures == 1
    assert result.source_data_date == date(2026, 10, 2)
    assert result.parsed_schedule_rows == 4
    assert arrival.source_pages == [1]
    verify_snapshot(result)


def test_identical_rows_collapse_but_different_flight_numbers_are_not_guessed_away():
    row = "S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air"
    result = parse_pages([
        HEADER + row,
        row + "\nS ZZ 202 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Other Air",
    ], date(2026, 10, 3), "b" * 64)
    assert result.departure_entry_count == 2
    assert result.duplicate_rows_removed == 1
    assert result.rows[0].source_pages == [1, 2]
    assert result.possible_shared_flight_groups == 1
    assert result.rows[0].possible_shared_group == result.rows[1].possible_shared_group
    assert any("Codeshare" in warning for warning in result.warnings)


def test_conflicting_rows_and_partial_or_unknown_layout_do_not_succeed():
    with pytest.raises(FlightPlanError, match="Zeile"):
        parse("S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air",
              "L XY 103 BROKEN 10:15 1234567 AAA 03.10.26 24.10.26 1 Test Air")
    with pytest.raises(FlightPlanError, match="widerspruech"):
        parse("S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air",
              "S XY 102 09:05 10:05 1234567 AAA 03.10.26 24.10.26 1 Test Air")
    with pytest.raises(FlightPlanError, match="Format"):
        parse_pages(["Other Airport Schedules"], date(2026, 10, 3), "b" * 64)
    with pytest.raises(FlightPlanError, match="Verkehrstag"):
        parse("S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air",
              day=date(2026, 11, 3))


@pytest.mark.parametrize("time,days,start,end,day", [
    ("25:00", "1234567", "03.10.26", "24.10.26", date(2026, 10, 3)),
    ("09:00", "7654321", "03.10.26", "24.10.26", date(2026, 10, 3)),
    ("09:00", "1234567", "24.10.26", "03.10.26", date(2026, 10, 3)),
    ("02:30", "------7", "25.10.26", "25.10.26", date(2026, 10, 25)),
    ("02:30", "------7", "29.03.26", "29.03.26", date(2026, 3, 29)),
])
def test_invalid_times_days_and_dst_ambiguity_are_rejected(time, days, start, end, day):
    with pytest.raises(FlightPlanError):
        parse(f"S XY 102 {time} 10:00 {days} AAA {start} {end} 1 Test Air", day=day)


def test_snapshot_is_content_addressed_and_detects_later_mutation():
    row = "S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air"
    first = parse(row)
    assert first.snapshot_id == parse(row).snapshot_id
    assert first.snapshot_id != parse(row, day=date(2026, 10, 4)).snapshot_id
    first.rows[0].flight_number = "ZZ999"
    with pytest.raises(FlightPlanError, match="Hash"):
        verify_snapshot(first)


def test_inconsistent_data_dates_are_not_accepted():
    with pytest.raises(FlightPlanError, match="Datenstand"):
        parse("Datenstand: 01.10.2026\n"
              "S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air")


def test_terminal_module_is_preserved_without_inventing_a_gate():
    result = parse("S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1F Test Air")
    assert result.rows[0].terminal == "1F"


def test_a_wrapped_direction_marker_does_not_silently_drop_a_flight():
    with pytest.raises(FlightPlanError, match="Zeile"):
        parse("S XY 102 09:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air",
              "L\nXY 101 08:00 10:00 1234567 AAA 03.10.26 24.10.26 1 Test Air")
