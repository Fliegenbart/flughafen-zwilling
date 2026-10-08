/** Wie weit sich die Regler bewegen lassen: aus den Werten des Projekts abgeleitet, nicht fest. */
import type { Levers } from "../model/livePower";

export type Range = { min: number; max: number; step: number };
export type RangeKey = "gridLimitKw" | "batteryKwh" | "pvFactor" | "extraVehicles";

/**
 * Der heutige Wert liegt immer auf der Schiene: Anschluss von 40 % bis 250 % von heute,
 * Batterie bis mindestens 6 MWh und dem Dreifachen von heute, Photovoltaik bis dreifach.
 */
export function leverRanges(today: Levers): Record<RangeKey, Range> {
  const grid = Math.max(100, today.gridLimitKw);
  return {
    gridLimitKw: {
      min: Math.max(100, Math.floor((grid * 0.4) / 100) * 100),
      max: Math.ceil((grid * 2.5) / 500) * 500,
      step: grid > 20000 ? 500 : 100,
    },
    batteryKwh: {
      min: 0,
      max: Math.max(6000, Math.ceil((today.batteryKwh * 3) / 500) * 500),
      step: 250,
    },
    pvFactor: { min: 0, max: 3, step: 0.1 },
    extraVehicles: { min: 0, max: 60, step: 2 },
  };
}

/** Ist die Reglerstellung anders als heute? Eine Definition fuer Vergleich, Linie, Handout und Gedaechtnis. */
export function isChanged(levers: Levers, today: Levers): boolean {
  const keys: RangeKey[] = ["gridLimitKw", "batteryKwh", "pvFactor", "extraVehicles"];
  return (
    keys.some((k) => (levers[k] ?? 0) !== (today[k] ?? 0)) ||
    !!levers.crisis ||
    (levers.policy ?? today.policy) !== today.policy
  );
}

/** Einzelne benannte Aenderungen gegenueber heute, als Chips zum Ausprobieren. */
export type Preset = {
  id: string;
  label: string;
  patch: (today: Levers) => Partial<Levers>;
  /** Wirkt nur in der genauen Rechnung (braucht den Server). */
  exactOnly?: boolean;
  /** Passt nur, wenn heute nicht schon so gerechnet wird. */
  applies?: (today: Levers) => boolean;
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
