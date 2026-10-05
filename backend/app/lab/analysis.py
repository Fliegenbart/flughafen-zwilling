from __future__ import annotations

import csv
import io
import math

from .models import Analysis, CaseId, Check, Criteria, Metrics, Quality, Sample

CSV_COLUMNS = ("ts_s", "power_kw", "setpoint_kw", "limit_kw")


def parse_csv(content: str) -> list[Sample]:
    if len(content.encode("utf-8")) > 5_000_000:
        raise ValueError("CSV ist groesser als 5 MB")
    content = content.lstrip("\ufeff")
    if not content.strip():
        raise ValueError("CSV ist leer")
    delimiter = ";" if ";" in content.splitlines()[0] else ","
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    if reader.fieldnames != list(CSV_COLUMNS):
        raise ValueError("Kopfzeile muss ts_s,power_kw,setpoint_kw,limit_kw sein (kW und Sekunden)")
    result: list[Sample] = []
    for line, row in enumerate(reader, 2):
        if line > 100_001:
            raise ValueError("Maximal 100.000 Messpunkte erlaubt")
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Spaltenanzahl stimmt nicht")
            values = {
                key: (None if key == "power_kw" and not row[key].strip() else float(row[key]))
                for key in CSV_COLUMNS
            }
            if any(value is not None and not math.isfinite(value) for value in values.values()):
                raise ValueError("NaN/Infinity nicht erlaubt")
            point = Sample(**values)
            if result and point.ts_s <= result[-1].ts_s:
                raise ValueError("Zeit muss strikt aufsteigend sein")
            result.append(point)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"CSV Zeile {line}: {exc}") from exc
    if len(result) < 2:
        raise ValueError("Mindestens zwei Messpunkte erforderlich")
    return result


def _positive_energy(left: float, right: float, dt: float) -> float:
    # Split zero-crossing intervals: import/export must not cancel each other.
    if left >= 0 and right >= 0:
        return (left + right) * dt / 2 / 3600
    if left <= 0 and right <= 0:
        return 0
    positive = max(left, right)
    return positive * (dt * positive / abs(right - left)) / 2 / 3600


def analyze(trace: list[Sample], criteria: Criteria, case_id: CaseId | None = None) -> Analysis:
    if len(trace) < 2 or any(b.ts_s <= a.ts_s for a, b in zip(trace, trace[1:])):
        raise ValueError("Mindestens zwei zeitlich aufsteigende Messpunkte erforderlich")
    duration = trace[-1].ts_s - trace[0].ts_s
    covered = energy_in = energy_out = violation = error_area = tracking_duration = 0.0
    changes = [
        i
        for i in range(1, len(trace))
        if trace[i].setpoint_kw != trace[i - 1].setpoint_kw
        or trace[i].limit_kw != trace[i - 1].limit_kw
    ]
    change_indices = set(changes)
    last_change = trace[0].ts_s
    gaps = [b.ts_s - a.ts_s for a, b in zip(trace, trace[1:])]
    for index, (left, right) in enumerate(zip(trace, trace[1:]), 1):
        dt = right.ts_s - left.ts_s
        if index in change_indices:
            last_change = right.ts_s
        if left.power_kw is None or right.power_kw is None or dt > criteria.max_gap_s:
            continue
        covered += dt
        energy_in += _positive_energy(left.power_kw, right.power_kw, dt)
        energy_out += _positive_energy(-left.power_kw, -right.power_kw, dt)
        # Left-held limit/command semantics; interpolate power only within a valid interval.
        excess_l = left.power_kw - left.limit_kw - criteria.tolerance_kw
        excess_r = right.power_kw - left.limit_kw - criteria.tolerance_kw
        if excess_l > 0 and excess_r > 0:
            violation += dt
        elif excess_l > 0 or excess_r > 0:
            violation += dt * max(excess_l, excess_r) / abs(excess_r - excess_l)
        eligible_from = max(left.ts_s, last_change + criteria.grace_s)
        eligible_dt = max(0, right.ts_s - eligible_from)
        if eligible_dt and index not in change_indices:
            fraction = (eligible_from - left.ts_s) / dt
            interpolated = left.power_kw + fraction * (right.power_kw - left.power_kw)
            err_left, err_right = interpolated - left.setpoint_kw, right.power_kw - left.setpoint_kw
            error_area += (
                _positive_energy(err_left, err_right, eligible_dt)
                + _positive_energy(-err_left, -err_right, eligible_dt)
            ) * 3600
            tracking_duration += eligible_dt
    coverage = 100 * covered / duration
    missing = sum(point.power_kw is None for point in trace)
    expected_count = duration / criteria.expected_interval_s + 1
    sampling_coverage = min(100.0, 100 * (len(trace) - missing) / expected_count)
    reasons = []
    if coverage < criteria.min_coverage_pct:
        reasons.append(f"Zeitabdeckung {coverage:.1f}% < {criteria.min_coverage_pct:g}%")
    if max(gaps) > criteria.max_gap_s:
        reasons.append(f"Zeitluecke {max(gaps):g} s > {criteria.max_gap_s:g} s")
    if sampling_coverage < criteria.min_coverage_pct:
        reasons.append(
            f"Abtastabdeckung {sampling_coverage:.1f}% bei erwartetem Intervall "
            f"{criteria.expected_interval_s:g} s"
        )
    valid_power = [p.power_kw for p in trace if p.power_kw is not None]
    responses: list[float] = []
    response_failed = response_inconclusive = False
    for n, index in enumerate(changes):
        start = trace[index].ts_s
        end_index = changes[n + 1] if n + 1 < len(changes) else len(trace)
        window_end = trace[end_index - 1].ts_s
        stable_start: float | None = None
        found = False
        previous: Sample | None = None
        for point in trace[index:end_index]:
            if previous is not None and point.ts_s - previous.ts_s > criteria.max_gap_s:
                stable_start = None
            if (
                point.power_kw is None
                or abs(point.power_kw - point.setpoint_kw) > criteria.tolerance_kw
            ):
                stable_start = None
            elif stable_start is None:
                stable_start = point.ts_s
            if stable_start is not None and point.ts_s - stable_start >= criteria.settling_s:
                responses.append(stable_start - start)
                found = True
                break
            previous = point
        if not found:
            if window_end - start < criteria.response_max_s + criteria.settling_s:
                response_inconclusive = True
            else:
                response_failed = True
    mae = error_area / tracking_duration if tracking_duration else None
    response_time = (
        max(responses) if responses and not response_failed and not response_inconclusive else None
    )
    if response_failed:
        response_state = "fail"
    elif response_inconclusive:
        response_state = "inconclusive"
    elif not changes:
        response_state = "not_applicable"
    else:
        response_state = (
            "pass"
            if response_time is not None and response_time <= criteria.response_max_s
            else "fail"
        )
    checks = [
        Check(
            id="quality",
            name="Datenqualitaet",
            state="inconclusive" if reasons else "pass",
            actual=round(min(coverage, sampling_coverage), 3),
            threshold=criteria.min_coverage_pct,
            unit="%",
            detail="; ".join(reasons) or "Zeit-/Abtastabdeckung und maximale Luecke eingehalten",
        ),
        Check(
            id="limit",
            name="Leistungsgrenze",
            state="pass" if violation <= criteria.limit_violation_budget_s else "fail",
            actual=round(violation, 4),
            threshold=criteria.limit_violation_budget_s,
            unit="s",
            detail=f"Oberhalb Limit + {criteria.tolerance_kw:g} kW; nur beobachtete Intervalle",
        ),
        Check(
            id="tracking",
            name="Sollwerttreue",
            state="inconclusive"
            if mae is None
            else ("pass" if mae <= criteria.tracking_mae_max_kw else "fail"),
            actual=round(mae, 4) if mae is not None else None,
            threshold=criteria.tracking_mae_max_kw,
            unit="kW",
            detail=f"Zeitgewichtete MAE nach {criteria.grace_s:g} s Einschwingfrist",
        ),
        Check(
            id="response",
            name="Reaktionszeit",
            state=response_state,
            actual=response_time,
            threshold=criteria.response_max_s,
            unit="s",
            detail=(
                f"Nach jedem Soll-/Limitsprung {criteria.settling_s:g} s stabil "
                "im Toleranzband; nicht erreichte Spruenge = FAIL"
            ),
        ),
    ]
    valid_pairs = [(p.power_kw, p.setpoint_kw) for p in trace if p.power_kw is not None]
    if len(valid_pairs) >= 2 and all(power == setpoint for power, setpoint in valid_pairs):
        # Ist-Leistung ist exakt der Sollwert: kopierte Reihe, keine unabhaengige Messung.
        checks.insert(
            0,
            Check(
                id="circular",
                name="Unabhaengigkeit der Messung",
                state="inconclusive",
                actual=0,
                threshold=None,
                unit="kW",
                detail="power_kw ist exakt gleich setpoint_kw (zirkulaer); kein Nachweis",
            ),
        )
    if case_id in {"setpoint-step", "flex-reduction"}:
        jumps = [
            abs(b.setpoint_kw - a.setpoint_kw)
            for a, b in zip(trace, trace[1:])
            if b.setpoint_kw != a.setpoint_kw
        ]
        if jumps and valid_power:
            power_span = max(valid_power) - min(valid_power)
            required = 0.5 * max(jumps)
            if power_span < required:
                checks.append(
                    Check(
                        id="reaction",
                        name="Reaktion auf Sollwertsprung",
                        state="fail",
                        actual=round(power_span, 4),
                        threshold=round(required, 4),
                        unit="kW",
                        detail=(
                            "Ist-Leistung aendert sich nicht erkennbar trotz Sollwertsprung "
                            "(konstante/eingefrorene Reihe)"
                        ),
                    )
                )
    if case_id is not None:
        predicates = {
            "setpoint-step": any(b.setpoint_kw > a.setpoint_kw for a, b in zip(trace, trace[1:])),
            "flex-reduction": any(b.setpoint_kw < a.setpoint_kw for a, b in zip(trace, trace[1:])),
            "power-cap": any(b.limit_kw < a.limit_kw for a, b in zip(trace, trace[1:])),
            "telemetry-loss": missing > 0 or max(gaps) > criteria.max_gap_s,
        }
        present = predicates[case_id]
        checks.insert(
            0,
            Check(
                id="profile",
                name="Testprofil im Trace",
                state="pass" if present else "inconclusive",
                actual=1 if present else 0,
                threshold=1,
                unit="",
                detail="Erwartetes Profilereignis aufgezeichnet"
                if present
                else "Erwartetes Profilereignis fehlt; dieser Testfall ist nicht nachweisbar",
            ),
        )
    verdict = (
        "inconclusive"
        if any(c.state == "inconclusive" for c in checks)
        else ("fail" if any(c.state == "fail" for c in checks) else "pass")
    )
    return Analysis(
        verdict=verdict,
        metrics=Metrics(
            peak_power_kw=max(valid_power, default=0),
            energy_import_kwh=round(energy_in, 6),
            energy_export_kwh=round(energy_out, 6),
            tracking_mae_kw=round(mae, 4) if mae is not None else None,
            response_time_s=response_time,
            limit_violation_s=round(violation, 4),
            observed_duration_s=covered,
        ),
        quality=Quality(
            coverage_pct=round(coverage, 3),
            sampling_coverage_pct=round(sampling_coverage, 3),
            missing_samples=missing,
            sample_count=len(trace),
            max_gap_s=max(gaps),
            reasons=reasons,
        ),
        checks=checks,
    )
