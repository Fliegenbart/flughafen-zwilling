/**
 * Die Treppe des Oekosystems: was jeder Baustein am Anschluss bewirkt, und der eine Satz dazu.
 * Reine Funktionen auf der vorab gerechneten Tabelle (api/electrification getAtlas).
 */
import type { Atlas, ElectrificationInputs } from "../api/electrification";
import { int } from "../model/format";

export type Settings = Required<ElectrificationInputs>;

/** Anschlussleistung immer in kW mit Tausenderpunkt, wie im Netzvertrag (1.500 kW). */
export const kw = (value: number) => `${int(value)}\u00a0kW`;

export const START: Settings = {
  electric_share_pct: 50,
  grid_import_limit_kw: 1500,
  storage_kwh: 2000,
  pv_kwp: 500,
  parking_sessions: 40,
};

/** Stufe 1 laedt ganz ohne Steuerung; 2 und 3 sind die Loesungen des Vergleichs. */
export type StageId = "uncontrolled" | "managed" | "managed_storage";

export type Stage = {
  id: StageId;
  /** Zahl auf dem Schild: 1, 2, 3. */
  sign: number;
  title: string;
  /** Benoetigter Anschluss in kW; null, wenn das Modell bis zur Obergrenze keine Stufe findet. */
  needKw: number | null;
  /** Ersparnis gegenueber Laden ohne Steuerung in kW (positiv = weniger Anschluss). */
  savingKw: number | null;
  /** Ohne Speicher ist Stufe 3 dieselbe Rechnung wie Stufe 2. */
  inactive?: boolean;
  /**
   * Der Speicher senkt den Bedarf nicht: Die einfache Speicherregel des Modells laedt aus dem
   * Netz nach und muss am Ende voll sein. Ein Speicher, der nicht hilft, bliebe aus; die Stufe
   * zaehlt dann nicht.
   */
  noGain?: boolean;
};

/** Naechster Wert eines Rasters (die Regler laufen auf genau diesen Werten). */
export const nearest = (values: number[], v: number) =>
  values.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), values[0]!);

/** Anschluss-Regler: 250 bis 5.000 kW in 25-kW-Schritten. */
export const CONNECTION = { min: 250, max: 5000, step: 25 } as const;

/** Eine Stellung aus der Adresse auf die gerechneten Werte setzen. */
export function snap(atlas: Atlas, s: Settings): Settings {
  const c = Math.round(s.grid_import_limit_kw / CONNECTION.step) * CONNECTION.step;
  return {
    electric_share_pct: nearest(atlas.axes.electric_share_pct, s.electric_share_pct),
    grid_import_limit_kw: Math.min(CONNECTION.max, Math.max(CONNECTION.min, c)),
    storage_kwh: nearest(atlas.axes.storage_kwh, s.storage_kwh),
    pv_kwp: nearest(atlas.axes.pv_kwp, s.pv_kwp),
    parking_sessions: nearest(atlas.axes.parking_sessions, s.parking_sessions),
  };
}

/** Nur was vom Start abweicht, kommt in die Adresse. */
export function changedFromStart(s: Settings): Partial<Settings> | undefined {
  const out = Object.fromEntries(
    (Object.keys(s) as (keyof Settings)[]).filter((k) => s[k] !== START[k]).map((k) => [k, s[k]]),
  );
  return Object.keys(out).length ? out : undefined;
}

export const atlasKey = (s: Settings) =>
  `${s.electric_share_pct}|${s.storage_kwh}|${s.pv_kwp}|${s.parking_sessions}`;

/** Ohne Steuerung spielt der Speicher keine Rolle. */
export const peakKey = (s: Settings) => `${s.electric_share_pct}|${s.pv_kwp}|${s.parking_sessions}`;

export function stagesFor(atlas: Atlas, s: Settings): Stage[] | null {
  const entry = atlas.entries[atlasKey(s)];
  const uncontrolled = atlas.peaks[peakKey(s)];
  if (!entry || uncontrolled === undefined) return null;
  const [, managed, storage] = entry;
  const noGain = managed !== null && (storage === null || storage >= managed);
  const saving = (kw: number | null) =>
    uncontrolled !== null && kw !== null ? uncontrolled - kw : null;
  return [
    {
      id: "uncontrolled",
      sign: 1,
      title: "Ladeinfrastruktur",
      needKw: uncontrolled,
      savingKw: null,
    },
    {
      id: "managed",
      sign: 2,
      title: "+\u00a0Lademanagement",
      needKw: managed,
      savingKw: saving(managed),
    },
    {
      id: "managed_storage",
      sign: 3,
      title: "+\u00a0Speicher",
      needKw: storage,
      savingKw: saving(storage),
      inactive: s.storage_kwh === 0 || noGain,
      noGain: s.storage_kwh > 0 && noGain,
    },
  ];
}

/** Bester Stand der Treppe: die letzte aktive Stufe. */
const best = (stages: Stage[]) => [...stages].reverse().find((s) => !s.inactive)!;

/** Die Stufe, ab der der eingestellte Anschluss reicht; null, wenn keine reicht. */
export function firstSufficient(stages: Stage[], connectionKw: number): Stage | null {
  return stages.find((s) => !s.inactive && s.needKw !== null && s.needKw <= connectionKw) ?? null;
}

/** Der eine Satz, den der Vertriebler sagen kann. */
export function answer(stages: Stage[], connectionKw: number, gridMaxKw: number): string {
  const c = kw(connectionKw);
  const [first] = stages;
  const top = best(stages);
  const enough = firstSufficient(stages, connectionKw);
  if (top.needKw === null)
    return `Selbst ${kw(gridMaxKw)} Anschluss reichen im Modell nicht, auch nicht mit allen Bausteinen.`;
  if (enough?.id === "uncontrolled") {
    const room = connectionKw - top.needKw;
    return room > 0 && top !== first
      ? `Ihr Anschluss von ${c} reicht schon heute. Mit allen Bausteinen bleiben ${kw(room)} frei für weiteres Wachstum.`
      : `Ihr Anschluss von ${c} reicht auch ohne Lademanagement.`;
  }
  if (enough?.id === "managed")
    return `Ungesteuertes Laden würde Ihren Anschluss von ${c} überlasten. Mit Lademanagement reicht er, ohne Netzausbau.`;
  if (enough?.id === "managed_storage")
    return `Erst mit Lademanagement und Speicher reicht Ihr Anschluss von ${c}.`;
  return `Ihr Anschluss muss um ${kw(top.needKw - connectionKw)} wachsen, auch mit allen Bausteinen.`;
}
