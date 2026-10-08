/** Wie weit sich die Regler bewegen lassen: aus den Werten des Projekts abgeleitet, nicht fest. */
import { extraVehiclesFor } from "../api/preview";
import { MAX_FLEET } from "../model/dataStatus";
import type { Levers } from "../model/livePower";
import type { FleetKind } from "../types";

export type Range = { min: number; max: number; step: number };
export type RangeKey = "gridLimitKw" | "batteryKwh" | "pvFactor" | "extraVehicles";
const RANGE_KEYS: RangeKey[] = ["gridLimitKw", "batteryKwh", "pvFactor", "extraVehicles"];

const BATTERY_STEP = 250;

/** Das Modell rechnet hoechstens 200 Fahrzeuge je Art (backend/app/munich/coupled_models.py). */
const MAX_PER_KIND = 200;
const MAX_EXTRA_VEHICLES = 60;
const EXTRA_VEHICLES_STEP = 2;

/** Fahrzeuge der Flotte heute: nur die Gesamtzahl oder je Art. */
export type FleetCounts = number | Partial<Record<FleetKind, number>>;

const totalOf = (fleet: FleetCounts) =>
  typeof fleet === "number"
    ? fleet
    : Object.values(fleet).reduce<number>((n, v) => n + (v ?? 0), 0);

/** Bleibt die Flotte mit diesen Fahrzeugen mehr in den Grenzen des Modells (300 insgesamt, 200 je Art)? */
function withinModel(fleet: FleetCounts, extra: Record<string, number>): boolean {
  if (totalOf(fleet) + Object.values(extra).reduce((n, v) => n + v, 0) > MAX_FLEET) return false;
  return (
    typeof fleet === "number" ||
    Object.entries(extra).every(([k, n]) => (fleet[k as FleetKind] ?? 0) + n <= MAX_PER_KIND)
  );
}

/** Die meisten zusaetzlichen Fahrzeuge, die das Modell noch rechnet (mit der gewaehlten Art). */
function extraMax(today: Levers, fleet: FleetCounts, extraKind?: FleetKind): number {
  for (let n = MAX_EXTRA_VEHICLES; n > 0; n -= EXTRA_VEHICLES_STEP) {
    const extra = extraVehiclesFor({ ...today, extraVehicles: n, extraKind });
    if (extra && withinModel(fleet, extra)) return n;
  }
  return 0;
}

/**
 * Der heutige Wert liegt immer auf der Schiene: Anschluss von 40 % bis 250 % von heute,
 * Batterie bis mindestens 6 MWh und dem Dreifachen von heute, Photovoltaik bis dreifach.
 * Einen vorhandenen Speicher kann die Rechnung nicht entfernen, nur verkleinern: Dann endet
 * die Schiene bei der kleinsten Stufe statt bei „keiner“. Zusaetzliche Fahrzeuge gehen bis 60,
 * aber nur so weit, wie das Modell sie noch rechnet; ist die Art gewaehlt, zaehlt deren Bestand.
 */
export function leverRanges(
  today: Levers,
  fleet: FleetCounts = 0,
  extraKind?: FleetKind,
): Record<RangeKey, Range> {
  const grid = Math.max(100, today.gridLimitKw);
  return {
    gridLimitKw: {
      min: Math.max(100, Math.floor((grid * 0.4) / 100) * 100),
      max: Math.ceil((grid * 2.5) / 500) * 500,
      step: grid > 20000 ? 500 : 100,
    },
    batteryKwh: {
      min: today.batteryKwh > 0 ? Math.min(BATTERY_STEP, today.batteryKwh) : 0,
      max: Math.max(6000, Math.ceil((today.batteryKwh * 3) / 500) * 500),
      step: BATTERY_STEP,
    },
    pvFactor: { min: 0, max: 3, step: 0.1 },
    extraVehicles: {
      min: 0,
      max: extraMax(today, fleet, extraKind),
      step: EXTRA_VEHICLES_STEP,
    },
  };
}

/** Ist die Reglerstellung anders als heute? Eine Definition fuer Vergleich, Linie, Handout und Gedaechtnis. */
export function isChanged(levers: Levers, today: Levers): boolean {
  return (
    RANGE_KEYS.some((k) => (levers[k] ?? 0) !== (today[k] ?? 0)) ||
    !!levers.crisis ||
    (levers.policy ?? today.policy) !== today.policy
  );
}

/**
 * Werte auf die Schienen von heute bringen. Gemerkte Werte stammen aus einem frueheren Stand des
 * Projekts und koennen daneben liegen. `fleet` und `pvKwp` sind die Werte, mit denen auch die
 * Regler zeichnen: Ohne Flotte gilt nur die Obergrenze der Schiene, ohne Photovoltaik entfaellt
 * ihr Regler.
 */
export function clampToRanges(
  wanted: Partial<Levers>,
  today: Levers,
  { fleet = 0, pvKwp }: { fleet?: FleetCounts; pvKwp?: number } = {},
): Partial<Levers> {
  const ranges = leverRanges(today, fleet, wanted.extraKind);
  const out = { ...wanted };
  for (const k of RANGE_KEYS) {
    const v = out[k];
    if (v !== undefined) out[k] = Math.min(ranges[k].max, Math.max(ranges[k].min, v));
  }
  if (pvKwp !== undefined && pvKwp <= 0) delete out.pvFactor;
  if (!out.extraVehicles) delete out.extraKind;
  // Leistung der Batterie folgt der Kapazitaet wie am Regler.
  if (out.batteryKwh !== undefined && out.batteryKwh !== wanted.batteryKwh)
    out.batteryKw = out.batteryKwh ? out.batteryKwh / 2 : undefined;
  return out;
}

/** Einzelne benannte Aenderungen gegenueber heute, als Chips zum Ausprobieren. */
export type Preset = {
  id: string;
  label: string;
  patch: (today: Levers) => Partial<Levers>;
  /** Wirkt nur in der genauen Rechnung (braucht den Server). */
  exactOnly?: boolean;
  /** Passt nur, wenn heute nicht schon so gerechnet wird und das Modell es noch rechnet. */
  applies?: (today: Levers, fleet?: FleetCounts) => boolean;
};

export const PRESETS: Preset[] = [
  {
    id: "anschluss",
    label: "1 MW mehr Anschluss",
    patch: (t) => ({ gridLimitKw: t.gridLimitKw + 1000 }),
  },
  {
    id: "speicher",
    label: "Batteriespeicher 2 MWh",
    patch: () => ({ batteryKwh: 2000, batteryKw: 1000 }),
    applies: (t) => t.batteryKwh < 2000,
  },
  {
    id: "schlepper",
    label: "5 Schlepper mehr",
    patch: () => ({ extraVehicles: 5, extraKind: "pushback_tug" }),
    exactOnly: true,
    applies: (_t, fleet = 0) => withinModel(fleet, { pushback_tug: 5 }),
  },
  {
    id: "laderegel",
    label: "Wer zuerst los muss, lädt zuerst",
    patch: () => ({ policy: "mission_priority" }),
    exactOnly: true,
    applies: (t) => t.policy !== "mission_priority",
  },
];

export const presetLevers = (p: Preset, today: Levers): Levers => ({ ...today, ...p.patch(today) });

/** Ist die Stellung genau dieser Vorschlag (und nichts sonst)? */
export function isPreset(p: Preset, levers: Levers, today: Levers): boolean {
  const want = presetLevers(p, today);
  const keys = new Set([...Object.keys(want), ...Object.keys(levers)] as (keyof Levers)[]);
  return [...keys].every((k) => (want[k] ?? undefined) === (levers[k] ?? undefined));
}
