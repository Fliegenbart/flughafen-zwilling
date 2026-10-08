/** Die Stellschrauben, die ein Energieversorger anbieten kann, plus Laderegel und Krisenfall. */
import { dec1, int, powerText, unit } from "../model/format";
import { FLEET_LABEL } from "../model/fleet";
import type { Levers } from "../model/livePower";
import { POLICY_LABEL, type ChargingPolicy } from "../model/policy";
import { caseByScenarioId, SCENARIO_CASES } from "../scenarios";
import type { FleetKind } from "../types";
import { isChanged, leverRanges, type RangeKey } from "./levers";

type Slider = {
  key: RangeKey;
  label: string;
  show: (v: number) => string;
  /** Zeile unter der Schiene; Standard: "heute" und der heutige Wert. */
  today?: (pvKwp: number) => string;
  /** Wirkt nur in der genauen Rechnung, nicht in der Sofort-Naeherung. */
  exactOnly?: boolean;
};

const SLIDERS: Slider[] = [
  { key: "gridLimitKw", label: "Netzanschluss", show: (v) => powerText(v) },
  {
    key: "batteryKwh",
    label: "Batteriespeicher",
    show: (v) => (v ? unit(dec1(v / 1000), "MWh") : "keiner"),
  },
  {
    key: "pvFactor",
    label: "Photovoltaik",
    show: (v) => `${unit(int(v * 100), "%")} von heute`,
    today: (kwp) => `heute ${unit(dec1(kwp / 1000), "MWp")}`,
  },
  {
    key: "extraVehicles",
    label: "Zusätzliche Elektrofahrzeuge",
    show: (v) => (v ? `${int(v)} mehr` : "keine"),
    exactOnly: true,
  },
];

const KINDS = Object.keys(FLEET_LABEL) as FleetKind[];
const MIXED = "alle Arten, in angenommener Mischung";

/** Der eine Hinweis, warum Fahrzeuge, Laderegel und Krisenfall ohne Server nicht gehen. */
export const EXACT_NOTE_ID = "ap-exact-note";

export default function LeverPanel({
  levers,
  today,
  pvKwp,
  fleetVehicles,
  onChange,
  onReset,
  exactEnabled,
}: {
  levers: Levers;
  today: Levers;
  /** Photovoltaik heute in kWp; ohne Anlage gibt es nichts zu verstellen. */
  pvKwp: number;
  /** Fahrzeuge der Flotte heute; die Obergrenze des Fahrzeugreglers haengt daran. */
  fleetVehicles: number;
  onChange: (next: Levers) => void;
  onReset: () => void;
  /** Ohne Server (Beispielprojekt) rechnet nur die Naeherung: kein Krisenfall, keine Laderegel. */
  exactEnabled: boolean;
}) {
  const ranges = leverRanges(today, fleetVehicles);
  const val = (lv: Levers, key: RangeKey) => lv[key] ?? 0;
  const changed = isChanged(levers, today);
  const crisis = caseByScenarioId(levers.crisis);
  const describedBy = exactEnabled ? undefined : EXACT_NOTE_ID;
  return (
    <form className="ap-levers" aria-label="Stellschrauben" onSubmit={(e) => e.preventDefault()}>
      {SLIDERS.filter((l) => l.key !== "pvFactor" || pvKwp > 0).map((l) => {
        const value = val(levers, l.key);
        const r = ranges[l.key];
        const pct = ((val(today, l.key) - r.min) / (r.max - r.min)) * 100;
        const text = l.show(value);
        return (
          <div
            key={l.key}
            className="ap-lever"
            data-changed={value !== val(today, l.key) || undefined}
          >
            <label className="ap-lever__name" htmlFor={`ap-${l.key}`}>
              {l.label}
            </label>
            <output className="ap-lever__value" htmlFor={`ap-${l.key}`} aria-live="off">
              {text}
            </output>
            <span
              className="ap-lever__track"
              style={{ "--today": `${pct}%` } as React.CSSProperties}
            >
              <input
                id={`ap-${l.key}`}
                type="range"
                min={r.min}
                max={r.max}
                step={r.step}
                value={Math.min(r.max, Math.max(r.min, value))}
                aria-valuetext={text}
                aria-describedby={l.exactOnly ? describedBy : undefined}
                disabled={!!l.exactOnly && !exactEnabled}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  // Liegt heute neben dem Raster der Schiene, gilt der naechste Rasterpunkt als heute.
                  const v =
                    Math.abs(raw - val(today, l.key)) < r.step / 2 ? val(today, l.key) : raw;
                  onChange(
                    l.key === "batteryKwh"
                      ? v === today.batteryKwh
                        ? { ...levers, batteryKwh: v, batteryKw: today.batteryKw }
                        : { ...levers, batteryKwh: v, batteryKw: v ? v / 2 : undefined }
                      : { ...levers, [l.key]: v },
                  );
                }}
              />
            </span>
            <span className="ap-lever__today">
              {l.today ? l.today(pvKwp) : `heute ${l.show(val(today, l.key))}`}
              {l.exactOnly && exactEnabled ? (
                <span className="ap-lever__note">, wirkt erst, wenn die Rechnung fertig ist</span>
              ) : null}
            </span>
            {l.key === "extraVehicles" && value > 0 ? (
              <>
                <select
                  className="ap-select"
                  aria-label="Art der zusätzlichen Fahrzeuge"
                  value={levers.extraKind ?? ""}
                  onChange={(e) =>
                    onChange({ ...levers, extraKind: (e.target.value as FleetKind) || undefined })
                  }
                >
                  <option value="">{MIXED}</option>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      nur {FLEET_LABEL[k]}
                    </option>
                  ))}
                </select>
                <span className="ap-print-only" aria-hidden="true">
                  {levers.extraKind ? `nur ${FLEET_LABEL[levers.extraKind]}` : MIXED}
                </span>
              </>
            ) : null}
          </div>
        );
      })}
      <div
        className="ap-lever"
        data-changed={(levers.policy ?? today.policy) !== today.policy || undefined}
      >
        <label className="ap-lever__name" htmlFor="ap-policy">
          Laderegel
        </label>
        <select
          id="ap-policy"
          className="ap-select"
          value={levers.policy ?? today.policy ?? "uncontrolled"}
          aria-describedby={describedBy}
          disabled={!exactEnabled}
          onChange={(e) => onChange({ ...levers, policy: e.target.value as Levers["policy"] })}
        >
          {(Object.keys(POLICY_LABEL) as ChargingPolicy[]).map((k) => (
            <option key={k} value={k}>
              {POLICY_LABEL[k]}
              {k === today.policy ? " (heute)" : ""}
            </option>
          ))}
        </select>
        <span className="ap-print-only" aria-hidden="true">
          {POLICY_LABEL[levers.policy ?? today.policy ?? "uncontrolled"]}
        </span>
        {exactEnabled ? (
          <span className="ap-lever__today">Wirkt erst, wenn die Rechnung fertig ist.</span>
        ) : null}
      </div>
      <div className="ap-lever ap-crisis" data-changed={crisis ? "" : undefined}>
        <label className="ap-lever__name" htmlFor="ap-crisis">
          Krisenfall durchspielen
        </label>
        <select
          id="ap-crisis"
          className="ap-select"
          value={levers.crisis ?? ""}
          aria-describedby={describedBy}
          disabled={!exactEnabled}
          onChange={(e) => onChange({ ...levers, crisis: e.target.value || undefined })}
        >
          <option value="">keiner</option>
          {SCENARIO_CASES.map((c) => (
            <option key={c.slug} value={c.scenarioId}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="ap-print-only" aria-hidden="true">
          {crisis ? crisis.name : "keiner"}
        </span>
        {exactEnabled ? (
          <span className="ap-lever__today">
            {crisis
              ? `Annahme für „${crisis.name}“. ${crisis.energyStress}`
              : "Wirkt erst, wenn die Rechnung fertig ist."}
          </span>
        ) : null}
      </div>
      {exactEnabled ? null : (
        <div className="ap-lever">
          <span className="ap-lever__today" id={EXACT_NOTE_ID}>
            Zusätzliche Fahrzeuge, Laderegel und Krisenfall gibt es nur in einem eigenen Projekt.
          </span>
        </div>
      )}
      <button type="button" className="ap-reset" onClick={onReset} disabled={!changed}>
        Auf heute zurücksetzen
      </button>
    </form>
  );
}
