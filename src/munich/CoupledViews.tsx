import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CoupledRecord } from "./coupledTypes";
import { number } from "./config";
import { url } from "./api";
import { modelTime, POLICY_LABELS } from "./coupledReport";
import { chartTheme } from "../ui/chartTheme";

export function ResultCard({ record }: { record: CoupledRecord }) {
  const k = record.summary!.coupled_kpis,
    e = record.summary!.energy_kpis;
  const policy = record.model_pack_snapshot.parameter_set.policy;
  return (
    <article
      className={`muc-result ${policy === "mission_priority" ? "muc-result--priority" : ""}`}
    >
      <header>
        {policy === "uncontrolled" && <span className="muc-small">Baseline /</span>}
        <h3>{POLICY_LABELS[policy]}</h3>
        <span className="muc-tag">SIL abgeschlossen</span>
      </header>
      <div className="muc-result__main">
        <strong>
          {k.departure_readiness_pct === null ? "n/a" : number(k.departure_readiness_pct, 1)}
          <small>{k.departure_readiness_pct === null ? "" : " %"}</small>
        </strong>
        <span>Modellierte Abflug-Aufgabenbereitschaft, keine OTP</span>
        <span>
          {k.departures_ready_on_time} / {k.modeled_departure_count} modellierte Abflugseinträge
          rechtzeitig
        </span>
      </div>
      <details>
        <summary>Weitere Modellwerte</summary>
        <dl className="muc-result__metrics">
          <div>
            <dt>Rechtzeitige Aufgaben</dt>
            <dd>
              {k.missions_on_time} / {k.mission_count}
            </dd>
          </div>
          <div>
            <dt>Nicht erledigt</dt>
            <dd>{k.missions_uncompleted}</dd>
          </div>
          <div>
            <dt>Energie-Warteminuten je Auftrag, summiert</dt>
            <dd>{number(k.energy_wait_total_min)}</dd>
          </div>
          <div>
            <dt>Fahrzeug-Warteminuten je Auftrag, summiert</dt>
            <dd>{number(k.resource_wait_total_min)}</dd>
          </div>
          <div>
            <dt>Parkhaus-Ladefristen</dt>
            <dd>
              {e.parking_ready_count} / {e.parking_session_count}
            </dd>
          </div>
          <div>
            <dt>Parkhausenergie fehlt</dt>
            <dd>{number(e.charging_unmet_kwh, 1)} kWh</dd>
          </div>
          <div>
            <dt>Netzspitze</dt>
            <dd>{number(e.grid_peak_kw)} kW</dd>
          </div>
          <div>
            <dt>Fahrzeugverbrauch / Trafoverluste</dt>
            <dd>
              {number(k.fleet_consumed_kwh, 1)} / {number(k.transformer_loss_kwh, 1)} kWh
            </dd>
          </div>
          <div>
            <dt>Grundlast unversorgt / BHKW nicht absetzbar</dt>
            <dd>
              {number(e.background_unserved_kwh, 1)} / {number(e.chp_unabsorbed_kwh, 1)} kWh
            </dd>
          </div>
        </dl>
      </details>
      <p className={record.status.pass_fail ? "muc-ok" : "muc-warn"}>
        Modellkriterien {record.status.pass_fail ? "erfüllt" : "nicht erfüllt"}; kein empirischer
        oder elektrischer Sicherheitsnachweis.
      </p>
      <code className="muc-run-id">{record.status.run_id}</code>
      <div className="muc-downloads">
        <a
          href={url(`/runs/${record.status.run_id}/artifacts/record.json`)}
          target="_blank"
          rel="noreferrer"
        >
          Run-Nachweis
        </a>
        <a
          href={url(`/runs/${record.status.run_id}/artifacts/report.pdf`)}
          target="_blank"
          rel="noreferrer"
        >
          PDF
        </a>
        <a href={url(`/runs/${record.status.run_id}/artifacts/missions.csv`)}>Aufgaben CSV</a>
      </div>
    </article>
  );
}

export function Delta({
  label,
  base,
  value,
  unit,
  higherBetter = false,
}: {
  label: string;
  base: number | null;
  value: number | null;
  unit: string;
  higherBetter?: boolean;
}) {
  const raw = base === null || value === null ? null : Math.round((value - base) * 10) / 10;
  const delta = raw === null ? null : Object.is(raw, -0) ? 0 : raw;
  const positive = delta !== null && (higherBetter ? delta > 0 : delta < 0);
  return (
    <p className={delta === null || delta === 0 ? "" : positive ? "muc-ok" : "muc-warn"}>
      Δ {label}
      <strong>
        {delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${number(delta, 1)} ${unit}`}
      </strong>
    </p>
  );
}

export function CoupledChart({
  rows,
  origin,
  mode,
}: {
  rows: { minute: number; [key: string]: number | undefined }[];
  origin: string;
  mode: "power" | "soc" | "queue";
}) {
  const lines =
    mode === "power"
      ? [
          ["baseline_grid", "Netz / ungesteuert", chartTheme.series.baseline],
          ["grid_import_kw", "Netz / Fristenpriorität", chartTheme.series.blue],
          ["ground_charging_kw", "Flotte / Fristenpriorität", chartTheme.series.amber],
          ["parking_kw", "Parkhaus / Fristenpriorität", chartTheme.series.teal],
        ]
      : mode === "soc"
        ? [
            ["baseline_soc", "SOC / ungesteuert", chartTheme.series.baseline],
            ["fleet_soc_avg_pct", "SOC / Fristenpriorität", chartTheme.series.blue],
            ["fleet_soc_min_pct", "Niedrigster SOC / Fristenpriorität", chartTheme.series.amber],
          ]
        : [
            ["baseline_queue", "Offene Aufgaben / ungesteuert", chartTheme.series.baseline],
            ["mission_queue", "Offene Aufgaben / Fristenpriorität", chartTheme.series.blue],
          ];
  return (
    <div>
      <h3>
        {mode === "power"
          ? "Gemeinsame Stromversorgung"
          : mode === "soc"
            ? "Dynamischer Fahrzeug-SOC"
            : "Wartende Modellaufträge"}
      </h3>
      <div
        className="muc-chart"
        role="img"
        aria-label={
          mode === "power"
            ? "Gekoppelte Netz- und Ladeleistung"
            : mode === "soc"
              ? "Mittlerer und niedrigster Fahrzeug-SOC"
              : "Wartende Modellaufträge beider Regeln"
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="minute"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => modelTime(origin, v)}
              stroke={chartTheme.axis}
              tick={{ fontSize: 12 }}
              minTickGap={25}
            />
            <YAxis
              width={55}
              stroke={chartTheme.axis}
              domain={mode === "soc" ? [0, 100] : [0, "auto"]}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              labelFormatter={(v) => modelTime(origin, Number(v))}
              formatter={(v: number) =>
                `${number(v, 1)} ${mode === "soc" ? "%" : mode === "power" ? "kW" : "Aufträge"}`
              }
              contentStyle={chartTheme.tooltip}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {lines.map(([key, name, color]) => (
              <Line
                key={key}
                dataKey={key}
                name={name}
                stroke={color}
                dot={false}
                isAnimationActive={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
