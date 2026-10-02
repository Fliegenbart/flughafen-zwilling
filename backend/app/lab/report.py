from __future__ import annotations

import csv
import html
import io
import json

from .analysis import CSV_COLUMNS
from .models import RunRecord, Sample

STYLE = """
body{font:15px/1.6 'Sora',sans-serif;color:#183b31;background:#f5f7f4;margin:0;padding:40px}
main{max-width:1000px;margin:auto}h1{font-size:32px;letter-spacing:-1px;line-height:1.3}
h2{margin-top:36px;font-size:20px}.mono,pre{font-family:'IBM Plex Mono',monospace}
.badge{background:#173f35;color:white;padding:8px 16px;border-radius:5px}
.fail{background:#a14435}.inconclusive{background:#87581c}
table{width:100%;border-collapse:collapse;background:white;margin:20px 0;font-size:13px}
td,th{text-align:left;padding:12px;border-bottom:1px solid #dde6de;vertical-align:top}
pre{white-space:pre-wrap;word-break:break-all;background:#edf1ec;padding:16px;font-size:11px}
svg{background:white;width:100%;border:1px solid #dde6de}.note{border-left:3px solid #cde87e;
padding:12px 18px}small{color:#68766d}.meta{font-size:12px;overflow-wrap:anywhere}
@media(max-width:600px){body{padding:18px}td,th{padding:7px;font-size:10px}h1{font-size:24px}}
@media print{body{background:white;padding:0}table,svg{break-inside:avoid}}
"""
VERDICTS = {
    "pass": "Bestanden",
    "fail": "Nicht bestanden",
    "inconclusive": "Nicht bewertbar",
    "not_applicable": "Nicht anwendbar",
}
METRICS = {
    "peak_power_kw": ("Spitzenleistung", "kW"),
    "energy_import_kwh": ("Bezogene Energie (beobachtet)", "kWh"),
    "energy_export_kwh": ("Eingespeiste Energie (beobachtet)", "kWh"),
    "tracking_mae_kw": ("Sollabweichung (zeitgewichtete MAE)", "kW"),
    "response_time_s": ("Reaktionszeit", "s"),
    "limit_violation_s": ("Obere Limitverletzung", "s"),
    "observed_duration_s": ("Gueltig beobachtete Dauer", "s"),
}


def esc(value) -> str:
    return html.escape(str(value if value is not None else "n/a"), quote=True)


def page(title: str, body: str) -> str:
    return (
        '<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{esc(title)}</title><style>{STYLE}</style></head><body><main>"
        f"{body}</main></body></html>"
    )


def trace_csv(trace: list[Sample]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    for point in trace:
        writer.writerow([getattr(point, key) for key in CSV_COLUMNS])
    return output.getvalue()


def chart(trace: list[Sample], max_gap: float) -> str:
    scale = max(
        [abs(p.power_kw or 0) for p in trace]
        + [abs(p.setpoint_kw) for p in trace]
        + [p.limit_kw for p in trace]
        + [1]
    )
    start = trace[0].ts_s
    span = trace[-1].ts_s - start

    def x(point):
        return (point.ts_s - start) / span * 880 + 10

    def y(power):
        return 130 - power / scale * 100

    def step_path(field):
        first = trace[0]
        return f"M{x(first):.2f},{y(getattr(first, field)):.2f} " + " ".join(
            f"H{x(p):.2f}V{y(getattr(p, field)):.2f}" for p in trace[1:]
        )

    segments, current = [], []
    previous = None
    for point in trace:
        if point.power_kw is None or (previous and point.ts_s - previous.ts_s > max_gap):
            if current:
                segments.append(current)
            current = []
        if point.power_kw is not None:
            current.append(f"{x(point):.2f},{y(point.power_kw):.2f}")
        previous = point
    if current:
        segments.append(current)
    measured = "".join(
        f'<polyline fill="none" stroke="#237785" stroke-width="2.5" points="{" ".join(segment)}"/>'
        for segment in segments
    )
    return (
        '<svg viewBox="0 0 900 260" role="img" aria-label="Leistung in kW ueber Sekunden">'
        '<path d="M10,130 H890" stroke="#cdd8ce"/>'
        f'<path fill="none" stroke="#183b31" stroke-dasharray="3 3" '
        f'd="{step_path("setpoint_kw")}"/>'
        f'<path fill="none" stroke="#bc771f" stroke-dasharray="6 4" '
        f'd="{step_path("limit_kw")}"/>{measured}'
        f'<text x="12" y="20" fill="#68766d" font-size="11">{scale:g} kW</text>'
        '<text x="12" y="144" fill="#68766d" font-size="11">0 kW</text>'
        f'<text x="12" y="248" font-size="11">{start:g} s</text>'
        f'<text x="840" y="248" font-size="11">{trace[-1].ts_s:g} s</text></svg>'
    )


def html_report(record: RunRecord, trace: list[Sample]) -> str:
    analysis = record.analysis
    if analysis is None:
        raise ValueError("Auswertung fehlt")
    checks = "".join(
        f"<tr><td>{esc(c.name)}</td><td>{esc(VERDICTS[c.state])}</td>"
        f"<td>{esc(c.actual)} {esc(c.unit)}</td><td>{esc(c.threshold)}</td>"
        f"<td>{esc(c.detail)}</td></tr>"
        for c in analysis.checks
    )
    metrics = "".join(
        f"<tr><td>{esc(METRICS[key][0])}</td><td>{esc(value)} {METRICS[key][1]}</td></tr>"
        for key, value in analysis.metrics.model_dump().items()
    )
    snapshot = json.dumps(
        {
            "bench": record.bench.model_dump(),
            "criteria": record.criteria.model_dump(),
            "request": record.request.model_dump() if record.request else None,
            "quality": analysis.quality.model_dump(),
        },
        indent=2,
        ensure_ascii=False,
    )
    audit = json.dumps(
        {
            "schema": record.schema_version,
            "filename": record.filename,
            "source_sha256": record.source_sha256,
            "build_commit": record.build_commit,
            "build_source_sha256": record.build_source_sha256,
            "recovery_count": record.recovery_count,
            "comparison_key": record.comparison_key,
        },
        indent=2,
    )
    return page(
        "FlexLab Evidenzbericht",
        f"""
<p class="mono meta">FLEXLAB / EVIDENZBERICHT / v1</p><h1>{esc(record.label)}</h1>
<span class="badge {analysis.verdict}">{VERDICTS[analysis.verdict]}</span>
<p class="meta">Run <span class="mono">{esc(record.run_id)}</span> · {esc(record.created_ts)}
<br>Quelle: {esc(record.source)} · Test: {esc(record.case_id)}</p>
<p class="note">{esc(record.provenance)} Importdaten sind Nutzerangaben, keine unabhaengig
bestaetigte Hardwaremessung. Zeitabdeckung: {analysis.quality.coverage_pct:g}%.
Energie umfasst nur beobachtete Intervalle.</p>
<h2>Leistungsverlauf</h2><p>Ist (Teal), Soll (dunkel), Limit (Orange); kW / Sekunden.
Luecken werden nicht verbunden. Positive Leistung = Bezug, negative = Einspeisung.</p>
{chart(trace, record.criteria.max_gap_s)}
<h2>Pruefkriterien</h2><table><thead><tr><th>Pruefung</th><th>Status</th><th>Ist</th>
<th>Grenze</th><th>Methode</th></tr></thead><tbody>{checks}</tbody></table>
<h2>Messgroessen</h2><table>{metrics}</table>
<h2>Eingefrorene Konfiguration</h2><pre>{esc(snapshot)}</pre>
<h2>Provenienz</h2><pre>{esc(audit)}</pre>
<p>Kein Live-Schreibzugriff. Simulation = aggregiertes, unkalibriertes Referenzmodell.
Rohtrace und Record separat exportieren, um die Auswertung zu reproduzieren.</p>""",
    )


def comparison_report(baseline: RunRecord, candidate: RunRecord, comparison: dict) -> str:
    rows = "".join(
        f"<tr><td>{METRICS[key][0]}</td>"
        f"<td>{esc(getattr(baseline.analysis.metrics, key))}</td>"
        f"<td>{esc(getattr(candidate.analysis.metrics, key))}</td>"
        f"<td>{esc(delta)} {METRICS[key][1]}</td></tr>"
        for key, delta in comparison["deltas"].items()
    )
    return page(
        "FlexLab Baseline-Vergleich",
        f"""
<p class="mono">FLEXLAB / BASELINE-VERGLEICH</p><h1>{esc(candidate.label)}</h1>
<p class="note">{esc(comparison["note"])}</p>
<p class="meta">Baseline: {esc(baseline.label)} · {esc(baseline.run_id)} · {baseline.source}
<br>Test: {esc(candidate.label)} · {esc(candidate.run_id)} · {candidate.source}</p>
<p>Baseline: {VERDICTS[baseline.analysis.verdict]},
Test: {VERDICTS[candidate.analysis.verdict]}. Gleiche Kriterien und Soll-/Limittraces;
Deltas = Test minus Baseline, keine automatische Gut/Schlecht-Interpretation.</p>
<table><thead><tr><th>Messgroesse</th><th>Baseline</th><th>Test</th><th>Delta</th></tr>
</thead><tbody>{rows}</tbody></table>
<h2>Abdeckung</h2><p>Baseline: {baseline.analysis.quality.coverage_pct:g}%,
Test: {candidate.analysis.quality.coverage_pct:g}%. Nicht bewertbare Tests bleiben
nicht bewertbar, auch wenn einzelne Zahlen besser erscheinen.</p>
<h2>Eingefrorene Kriterien</h2>
<pre>{esc(json.dumps(candidate.criteria.model_dump(), indent=2))}</pre>
<p class="meta">Vergleichs-Fingerprint: {esc(candidate.comparison_key)}.</p>
<p>Die einzelnen Records und Traces gehoeren zum Evidenzpaket. Keine Live-Ansteuerung.</p>""",
    )
