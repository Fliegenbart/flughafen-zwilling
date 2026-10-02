import type { ReactNode } from "react";
import type { Analysis, LabRun } from "./types";

export function Icon({
  name,
  size = 18,
}: {
  name: "pulse" | "upload" | "history" | "settings" | "arrow" | "download" | "shield" | "close";
  size?: number;
}) {
  const paths = {
    pulse: "M2 12h4l3-8 5 16 3-8h5",
    upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
    history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2",
    settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    download: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-6",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export const stateNames: Record<LabRun["state"], string> = {
  queued: "In Warteschlange",
  running: "Test läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  failed: "Technischer Fehler",
};
export const verdictNames = {
  pass: "Bestanden",
  fail: "Nicht bestanden",
  inconclusive: "Nicht bewertbar",
  not_applicable: "Nicht anwendbar",
};
export function format(value: number | null | undefined, digits = 1) {
  return value == null
    ? "n/a"
    : new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);
}
export function sourceName(run: LabRun) {
  return run.source === "simulation" ? "Simulation" : "CSV-Import";
}

export function Field({
  label,
  value,
  onChange,
  unit,
  min = 0,
  max = 10000,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="lab-field">
      <span>{label}</span>
      <div className="lab-number">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          required
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>{unit}</span>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SectionHeading({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="lab-section-heading">
      <h2>
        <span>{number}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Metrics({ analysis }: { analysis: Analysis | null }) {
  const m = analysis?.metrics;
  return (
    <div className="lab-metrics" aria-label="Ausgewertete Messgrößen">
      {[
        {
          name: "Spitzenleistung",
          value: m?.peak_power_kw,
          unit: "kW",
          note: "Maximaler Ist-Wert",
        },
        {
          name: "Bezogene Energie",
          value: m?.energy_import_kwh,
          unit: "kWh",
          note: "Nur beobachtete Intervalle",
        },
        {
          name: "Reaktionszeit",
          value: m?.response_time_s,
          unit: "s",
          note: "Stabil im Toleranzband",
        },
        {
          name: "Limitverletzung",
          value: m?.limit_violation_s,
          unit: "s",
          note: "Oberhalb Limit + Toleranz",
        },
      ].map((metric) => (
        <div className="lab-metric" key={metric.name}>
          <span>{metric.name}</span>
          <strong>
            {format(metric.value, metric.unit === "kWh" ? 2 : 1)}
            <small>{metric.unit}</small>
          </strong>
          <p>{metric.note}</p>
        </div>
      ))}
    </div>
  );
}
