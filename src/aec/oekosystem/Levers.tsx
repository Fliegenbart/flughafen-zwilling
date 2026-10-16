/** Die Regler: was der Flughafen hat und welche Bausteine dazukommen. */
import type { Atlas } from "../api/electrification";
import { dec1, int } from "../model/format";
import { kw, type Settings } from "./stufen";

type Lever = {
  key: keyof Settings;
  label: string;
  show: (v: number) => string;
  /** Feste Stufen (vorab gerechnet); ohne Angabe ein freier Bereich. */
  values?: number[];
  range?: { min: number; max: number; step: number };
  hint?: (v: number) => string;
};

const AIRPORT: Lever[] = [
  {
    key: "electric_share_pct",
    label: "Elektrische Fahrzeuge im Vorfeld",
    show: (v) => `${v}\u00a0%`,
    hint: (v) => `${v} von 100 Fahrzeugen fahren elektrisch`,
  },
  {
    key: "grid_import_limit_kw",
    label: "Netzanschluss heute",
    show: kw,
    range: { min: 250, max: 5000, step: 25 },
  },
];
const BLOCKS: Lever[] = [
  {
    key: "storage_kwh",
    label: "Speicher",
    show: (v) => (v ? `${dec1(v / 1000)}\u00a0MWh` : "keiner"),
    hint: (v) => (v ? `gibt bis zu ${kw(v / 2)} ab` : "Stufe 3 braucht einen Speicher"),
  },
  {
    key: "pv_kwp",
    label: "Photovoltaik",
    show: (v) => (v ? `${int(v)}\u00a0kWp` : "keine"),
  },
  {
    key: "parking_sessions",
    label: "Laden im Parkhaus",
    show: (v) => (v ? `${v} Ladevorgänge` : "keins"),
    hint: (v) => (v ? "am Tag, Mitarbeiter, Gäste und Mietwagen" : "nur das Vorfeld"),
  },
];

function Slider({
  lever,
  value,
  values,
  onChange,
}: {
  lever: Lever;
  value: number;
  values?: number[];
  onChange: (v: number) => void;
}) {
  const id = `oe-${lever.key}`;
  const text = lever.show(value);
  // Feste Stufen laufen als Index, damit jede Stufe gleich viel Weg bekommt.
  const discrete = values && values.length > 0;
  const index = discrete ? Math.max(0, values.indexOf(value)) : 0;
  return (
    <div className="oe-lever">
      <label htmlFor={id} className="oe-lever__name">
        {lever.label}
      </label>
      <output htmlFor={id} className="oe-lever__value" aria-live="off">
        {text}
      </output>
      <input
        id={id}
        type="range"
        min={discrete ? 0 : lever.range!.min}
        max={discrete ? values.length - 1 : lever.range!.max}
        step={discrete ? 1 : lever.range!.step}
        value={discrete ? index : value}
        aria-valuetext={text}
        onChange={(e) => {
          const raw = Number(e.target.value);
          onChange(discrete ? values[raw]! : raw);
        }}
      />
      {lever.hint ? <span className="oe-lever__hint">{lever.hint(value)}</span> : null}
    </div>
  );
}

export default function Levers({
  settings,
  atlas,
  onChange,
}: {
  settings: Settings;
  atlas: Atlas;
  onChange: (next: Settings) => void;
}) {
  const axis = (key: keyof Settings) =>
    key === "grid_import_limit_kw" ? undefined : atlas.axes[key];
  const row = (lever: Lever) => (
    <Slider
      key={lever.key}
      lever={lever}
      value={settings[lever.key]}
      values={axis(lever.key)}
      onChange={(v) => onChange({ ...settings, [lever.key]: v })}
    />
  );
  return (
    <form className="oe-levers" aria-label="Annahmen" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Ihr Flughafen</legend>
        {AIRPORT.map(row)}
      </fieldset>
      <fieldset>
        <legend>Weitere Bausteine</legend>
        {BLOCKS.map(row)}
      </fieldset>
      <p className="oe-print-only oe-levers__print">
        {[...AIRPORT, ...BLOCKS].map((l) => `${l.label}: ${l.show(settings[l.key])}`).join(". ")}.
      </p>
    </form>
  );
}
