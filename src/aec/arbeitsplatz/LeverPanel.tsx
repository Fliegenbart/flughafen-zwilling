/** Die drei Stellschrauben, die ein Energieversorger anbieten kann. */
import type { Levers } from "../model/livePower";
import { caseByScenarioId, SCENARIO_CASES } from "../scenarios";
import { dec1, int, powerText } from "../model/format";

type Lever = {
  key: "gridLimitKw" | "batteryKwh" | "pvFactor" | "extraVehicles";
  label: string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  /** Wirkt nur in der genauen Rechnung, nicht in der Sofort-Naeherung. */
  exactOnly?: boolean;
};

const LEVERS: Lever[] = [
  {
    key: "gridLimitKw",
    label: "Netzanschluss",
    min: 1500,
    max: 8000,
    step: 100,
    show: (v) => powerText(v),
  },
  {
    key: "batteryKwh",
    label: "Batteriespeicher",
    min: 0,
    max: 6000,
    step: 250,
    show: (v) => (v ? `${dec1(v / 1000)} MWh` : "keiner"),
  },
  {
    key: "pvFactor",
    label: "Photovoltaik",
    min: 0,
    max: 3,
    step: 0.1,
    show: (v) => `${int(v * 100)} % von heute`,
  },
  {
    key: "extraVehicles",
    label: "Zusätzliche Elektrofahrzeuge",
    min: 0,
    max: 60,
    step: 2,
    show: (v) => (v ? `${int(v)} mehr` : "keine"),
    exactOnly: true,
  },
];

export default function LeverPanel({
  levers,
  today,
  onChange,
  onReset,
  crisisEnabled,
}: {
  levers: Levers;
  today: Levers;
  onChange: (next: Levers) => void;
  onReset: () => void;
  /** Ohne Server (Beispielprojekt) laesst sich kein Krisenfall genau rechnen. */
  crisisEnabled: boolean;
}) {
  const val = (lv: Levers, key: Lever["key"]) => lv[key] ?? 0;
  const changed = LEVERS.some((l) => val(levers, l.key) !== val(today, l.key)) || !!levers.crisis;
  const crisis = caseByScenarioId(levers.crisis);
  return (
    <form className="ap-levers" aria-label="Stellschrauben" onSubmit={(e) => e.preventDefault()}>
      {LEVERS.map((l) => {
        const value = val(levers, l.key);
        const pct = ((val(today, l.key) - l.min) / (l.max - l.min)) * 100;
        return (
          <label
            key={l.key}
            className="ap-lever"
            data-changed={value !== val(today, l.key) || undefined}
          >
            <span className="ap-lever__name">{l.label}</span>
            <output className="ap-lever__value">{l.show(value)}</output>
            <span
              className="ap-lever__track"
              style={{ "--today": `${pct}%` } as React.CSSProperties}
            >
              <input
                type="range"
                min={l.min}
                max={l.max}
                step={l.step}
                value={value}
                aria-valuetext={l.show(value)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange(
                    l.key === "batteryKwh"
                      ? { ...levers, batteryKwh: v, batteryKw: v ? v / 2 : undefined }
                      : { ...levers, [l.key]: v },
                  );
                }}
              />
            </span>
            <span className="ap-lever__today">
              heute {l.show(val(today, l.key))}
              {l.exactOnly ? ", wirkt erst in der genauen Rechnung" : ""}
            </span>
          </label>
        );
      })}
      <label className="ap-lever ap-crisis" data-changed={crisis ? "" : undefined}>
        <span className="ap-lever__name">Krisenfall durchspielen</span>
        <select
          value={levers.crisis ?? ""}
          disabled={!crisisEnabled}
          onChange={(e) => onChange({ ...levers, crisis: e.target.value || undefined })}
        >
          <option value="">keiner</option>
          {SCENARIO_CASES.map((c) => (
            <option key={c.slug} value={c.scenarioId}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="ap-lever__today">
          {!crisisEnabled
            ? "Nur in einem eigenen Projekt, wirkt erst in der genauen Rechnung."
            : crisis
              ? `So rechnen wir „${crisis.name}“ (Annahme): ${crisis.energyStress}`
              : "Wirkt erst in der genauen Rechnung."}
        </span>
      </label>
      <button type="button" className="ap-reset" onClick={onReset} disabled={!changed}>
        Auf heute zurücksetzen
      </button>
    </form>
  );
}
