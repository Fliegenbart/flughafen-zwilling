/** Die Regler: was der Flughafen hat und welche Bausteine dazukommen. */
import { useEffect, useRef } from "react";
import type { AirportProfile, Atlas } from "../api/electrification";
import { dec1, int } from "../model/format";
import { connectionRange, kw, type Settings } from "./stufen";

type NumberKey = "electric_share_pct" | "storage_kwh" | "pv_kwp" | "parking_sessions";

type Lever = {
  key: NumberKey;
  label: string;
  show: (v: number) => string;
  hint?: (v: number) => string;
};

function Slider({
  inputRef,
  id,
  label,
  text,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  text: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (v: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="oe-lever">
      <label htmlFor={id} className="oe-lever__name">
        {label}
      </label>
      <output htmlFor={id} className="oe-lever__value" aria-live="off">
        {text}
      </output>
      <input
        ref={inputRef}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="oe-lever__hint">{hint}</span> : null}
    </div>
  );
}

/** Feste Stufen (vorab gerechnet) laufen als Index, damit jede Stufe gleich viel Weg bekommt. */
function Steps({
  lever,
  value,
  values,
  onChange,
}: {
  lever: Lever;
  value: number;
  values: number[];
  onChange: (v: number) => void;
}) {
  return (
    <Slider
      id={`oe-${lever.key}`}
      label={lever.label}
      text={lever.show(value)}
      value={Math.max(0, values.indexOf(value))}
      min={0}
      max={values.length - 1}
      step={1}
      hint={lever.hint?.(value)}
      onChange={(i) => onChange(values[i]!)}
    />
  );
}

export default function Levers({
  settings,
  atlas,
  profile,
  managedNeedKw,
  onChange,
}: {
  settings: Settings;
  atlas: Atlas;
  /** Steckbrief des gewaehlten Flughafens; null beim Beispielflughafen. */
  profile?: AirportProfile | null;
  /** Bedarf mit Lademanagement: Startwert, wenn eine offene Reserve eingetragen wird. */
  managedNeedKw?: number | null;
  onChange: (next: Settings) => void;
}) {
  const airport = profile ?? null;
  const total = airport ? Object.values(airport.fleet.vehicles).reduce((a, b) => a + b, 0) : 100;
  const range = connectionRange(atlas, settings.airport);
  const set = (key: keyof Settings, v: number | null) => onChange({ ...settings, [key]: v });
  // Beim Umschalten der Reserve verschwindet der gedrueckte Knopf: Fokus dorthin, wo es weitergeht.
  const focusNext = useRef<"slider" | "button" | null>(null);
  const reserveSlider = useRef<HTMLInputElement>(null);
  const reserveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusNext.current === "slider") reserveSlider.current?.focus();
    if (focusNext.current === "button") reserveButton.current?.focus();
    focusNext.current = null;
  });

  const share: Lever = {
    key: "electric_share_pct",
    label: "Elektrische Fahrzeuge im Vorfeld",
    show: (v) => `${v}\u00a0%`,
    hint: (v) =>
      `${int(Math.round((total * v) / 100))} von ${int(total)} Fahrzeugen${airport ? " im Modell" : ""} fahren elektrisch` +
      (airport?.electric_share_now_pct != null
        ? `; veröffentlicht: rund ${int(airport.electric_share_now_pct)} % der Flughafenflotte`
        : ""),
  };
  const blocks: Lever[] = [
    {
      key: "storage_kwh",
      label: "Speicher",
      show: (v) => (v ? `${dec1(v / 1000)}\u00a0MWh` : "keiner"),
      hint: (v) => (v ? `gibt bis zu ${kw(v / 2)} ab` : "Stufe 3 braucht einen Speicher"),
    },
    ...(atlas.axes.pv_kwp.length > 1
      ? [
          {
            key: "pv_kwp" as const,
            label: "Photovoltaik",
            show: (v: number) => (v ? `${int(v)}\u00a0kWp` : "keine"),
          },
        ]
      : []),
    {
      key: "parking_sessions",
      label: "Laden im Parkhaus",
      show: (v) => (v ? `${int(v)} Ladevorgänge` : "keins"),
      hint: (v) =>
        !v
          ? "nur das Vorfeld"
          : airport
            ? "am Tag, je öffentlichem Ladepunkt einer"
            : "am Tag, Mitarbeiter, Gäste und Mietwagen",
    },
  ];
  const connection = settings.grid_import_limit_kw;
  const summary = [
    `${share.label}: ${share.show(settings.electric_share_pct)}`,
    `${airport ? "Reserve fürs Vorfeld" : "Netzanschluss heute"}: ${connection === null ? "offen" : kw(connection)}`,
    ...blocks.map((l) => `${l.label}: ${l.show(settings[l.key])}`),
  ];

  return (
    <form className="oe-levers" aria-label="Annahmen" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>{airport ? `Vorfeld ${airport.name}` : "Ihr Flughafen"}</legend>
        <Steps
          lever={share}
          value={settings.electric_share_pct}
          values={atlas.axes.electric_share_pct}
          onChange={(v) => set("electric_share_pct", v)}
        />
        {connection === null ? (
          <div className="oe-lever">
            <span className="oe-lever__name" id="oe-reserve-label">
              Reserve fürs Vorfeld
            </span>
            <span className="oe-lever__value">offen</span>
            <button
              ref={reserveButton}
              type="button"
              className="oe-tool oe-lever__set"
              aria-describedby="oe-reserve-label"
              onClick={() => {
                focusNext.current = "slider";
                // Start beim Bedarf mit Lademanagement, aufs Raster des Reglers gerundet.
                const start = managedNeedKw ?? range.min;
                const snapped = Math.round(start / range.step) * range.step;
                set("grid_import_limit_kw", Math.min(range.max, Math.max(range.min, snapped)));
              }}
            >
              Reserve eintragen
            </button>
            <span className="oe-lever__hint">
              Leistung, die das Flughafennetz für das Laden bereitstellen kann
            </span>
          </div>
        ) : (
          <>
            <Slider
              inputRef={reserveSlider}
              id="oe-grid_import_limit_kw"
              label={airport ? "Reserve fürs Vorfeld" : "Netzanschluss heute"}
              text={kw(connection)}
              value={connection}
              min={range.min}
              max={range.max}
              step={range.step}
              hint={
                airport ? "Leistung, die das Flughafennetz für das Laden bereitstellt" : undefined
              }
              onChange={(v) => set("grid_import_limit_kw", v)}
            />
            {airport ? (
              <button
                type="button"
                className="oe-link"
                onClick={() => {
                  focusNext.current = "button";
                  set("grid_import_limit_kw", null);
                }}
              >
                Reserve offen lassen
              </button>
            ) : null}
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>Weitere Bausteine</legend>
        {blocks.map((lever) => (
          <Steps
            key={lever.key}
            lever={lever}
            value={settings[lever.key]}
            values={atlas.axes[lever.key]}
            onChange={(v) => set(lever.key, v)}
          />
        ))}
      </fieldset>
      <p className="oe-print-only oe-levers__print">{summary.join(". ")}.</p>
    </form>
  );
}
