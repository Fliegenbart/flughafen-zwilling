/**
 * Die Treppe des Oekosystems: was jeder Baustein am Anschluss bewirkt, und der eine Satz dazu.
 * Reine Funktionen auf der vorab gerechneten Tabelle (api/electrification getAtlas).
 */
import type { AirportProfile, Atlas, ElectrificationInputs } from "../api/electrification";
import { int } from "../model/format";

export type Settings = {
  /** Echter Flughafen (IATA) oder null fuer den erfundenen Beispielflughafen. */
  airport: string | null;
  electric_share_pct: number;
  /**
   * Anschluss in kW; bei echten Flughaefen die Reserve des Flughafennetzes fuer das Laden.
   * null: Reserve noch offen (kennt nur der Flughafen); die Seite zeigt dann nur den Bedarf.
   */
  grid_import_limit_kw: number | null;
  storage_kwh: number;
  pv_kwp: number;
  parking_sessions: number;
};

/** Anschlussleistung immer in kW mit Tausenderpunkt, wie im Netzvertrag (1.500 kW). */
export const kw = (value: number) => `${int(value)}\u00a0kW`;

export const START: Settings = {
  airport: null,
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
   * Der Speicher senkt den Bedarf nicht, meist weil schon das Lademanagement die Leistung fast
   * den ganzen Tag nutzt. Er bliebe dann aus (storage_mode "off"); die Stufe zaehlt nicht.
   */
  noGain?: boolean;
};

/** Naechster Wert eines Rasters (die Regler laufen auf genau diesen Werten). */
export const nearest = (values: number[], v: number) =>
  values.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), values[0]!);

/** Anschluss-Regler des Beispielflughafens: 250 bis 5.000 kW in 25-kW-Schritten. */
export const CONNECTION = { min: 250, max: 5000, step: 25 } as const;

/** Bereich des Anschluss- bzw. Reserve-Reglers: beim Flughafen bis gut ueber die Spitze. */
export function connectionRange(atlas: Atlas, airport: string | null) {
  if (!airport) return CONNECTION;
  const step = atlas.gridStepKw;
  const peaks = Object.values(atlas.peaks).filter((v): v is number => v !== null);
  const top = Math.max(step * 10, ...peaks) * 1.3;
  return { min: step, max: Math.min(atlas.gridMaxKw, Math.ceil(top / step) * step), step };
}

/** Startstellung je Flughafen: 50 % elektrisch, Reserve offen, mittlerer Speicher,
 * Parkhaus aus (zuschaltbar). */
export function baseFor(airport: string | null, profile: AirportProfile | null, atlas: Atlas) {
  if (!airport || !profile) return START;
  const storage = atlas.axes.storage_kwh;
  return {
    airport,
    // Wie beim Beispiel 50 %: Veroeffentlichte Anteile gelten fuer anders abgegrenzte Flotten
    // (oft mit Pkw), nicht fuer die vier Klassen des Modells.
    electric_share_pct: nearest(atlas.axes.electric_share_pct, 50),
    grid_import_limit_kw: null,
    storage_kwh: storage[Math.min(3, storage.length - 1)]!,
    pv_kwp: 0,
    // Das Parkhaus beruht bei echten Flughaefen auf einer groben Annahme (je oeffentlichem
    // Ladepunkt ein Vorgang); es soll die Frage nach dem Vorfeld nicht ueberdecken.
    parking_sessions: 0,
  } satisfies Settings;
}

/** Eine Stellung aus der Adresse auf die gerechneten Werte setzen. */
export function snap(atlas: Atlas, s: Settings): Settings {
  const range = connectionRange(atlas, s.airport);
  const raw = s.grid_import_limit_kw;
  const c = raw === null ? null : Math.round(raw / range.step) * range.step;
  return {
    airport: s.airport,
    electric_share_pct: nearest(atlas.axes.electric_share_pct, s.electric_share_pct),
    grid_import_limit_kw: c === null ? null : Math.min(range.max, Math.max(range.min, c)),
    storage_kwh: nearest(atlas.axes.storage_kwh, s.storage_kwh),
    pv_kwp: nearest(atlas.axes.pv_kwp, s.pv_kwp),
    parking_sessions: nearest(atlas.axes.parking_sessions, s.parking_sessions),
  };
}

/** Nur was von der Startstellung abweicht, kommt in die Adresse (der Flughafen eigens). */
export function changedFrom(
  base: Settings,
  s: Settings,
): Partial<Record<Exclude<keyof Settings, "airport">, number>> | undefined {
  const keys = (Object.keys(s) as (keyof Settings)[]).filter(
    (k): k is Exclude<keyof Settings, "airport"> => k !== "airport" && s[k] !== base[k],
  );
  const out = Object.fromEntries(keys.filter((k) => s[k] !== null).map((k) => [k, s[k] as number]));
  return Object.keys(out).length ? out : undefined;
}

/** Kompatibel fuer die Startseite des Beispielflughafens. */
export const changedFromStart = (s: Settings) => changedFrom(START, s);

/**
 * Anschluss fuer Kurve und Rechnung. Ist die Reserve offen, gilt der Bedarf mit Lademanagement:
 * Die rote Linie zeigt dann, was Lademanagement braucht, nicht eine Reserve des Flughafens.
 */
export function effectiveConnection(s: Settings, stages: Stage[] | null, atlas: Atlas): number {
  if (s.grid_import_limit_kw !== null) return s.grid_import_limit_kw;
  const managed = stages?.find((x) => x.id === "managed")?.needKw;
  return managed ?? atlas.gridMaxKw;
}

/** Was an den Server geht. */
export function inputsFor(s: Settings, connectionKw: number): ElectrificationInputs {
  return {
    electric_share_pct: s.electric_share_pct,
    grid_import_limit_kw: connectionKw,
    storage_kwh: s.storage_kwh,
    pv_kwp: s.pv_kwp,
    parking_sessions: s.parking_sessions,
    ...(s.airport ? { airport: s.airport } : {}),
  };
}

/** Woerter fuer Beispiel (Anschluss) und Flughafen (Reserve des Flughafennetzes). */
export type Words = {
  noun: string;
  your: string;
  /** Ohne Steuerung zu viel, mit Lademanagement reicht es. */
  over: (c: string) => string;
  grow: (by: string) => string;
};
export const ANSCHLUSS: Words = {
  noun: "Anschluss",
  your: "Ihr Anschluss",
  over: (c) =>
    `Ungesteuertes Laden würde Ihren Anschluss von ${c} überlasten. Mit Lademanagement reicht er, ohne Netzausbau.`,
  grow: (by) => `Ihr Anschluss muss um ${by} wachsen, auch mit allen Bausteinen.`,
};
export const RESERVE: Words = {
  noun: "Reserve",
  your: "Ihre Reserve",
  over: (c) =>
    `Ungesteuertes Laden bräuchte mehr als Ihre Reserve von ${c}. Mit Lademanagement reicht sie.`,
  grow: (by) => `Ihre Reserve muss um ${by} größer werden, auch mit allen Bausteinen.`,
};

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

/** Der eine Satz, den der Vertriebler sagen kann. connectionKw null: Reserve noch offen. */
export function answer(
  stages: Stage[],
  connectionKw: number | null,
  gridMaxKw: number,
  words: Words = ANSCHLUSS,
  place?: string,
): string {
  const [first] = stages;
  const top = best(stages);
  const need = (st: Stage) => (st.needKw === null ? `über ${kw(gridMaxKw)}` : kw(st.needKw));
  if (connectionKw === null) {
    const storage = stages.find((st) => st.id === "managed_storage")!;
    const managed = stages.find((st) => st.id === "managed")!;
    const where = place ? `das Vorfeld in ${place}` : "das Vorfeld";
    return `Ohne Steuerung bräuchte ${where} ${need(first!)} Reserve, mit Lademanagement ${need(managed)}${storage.inactive ? "" : `, mit Speicher ${need(storage)}`}.`;
  }
  const c = kw(connectionKw);
  const enough = firstSufficient(stages, connectionKw);
  if (top.needKw === null)
    return `Selbst ${kw(gridMaxKw)} ${words.noun} reichen im Modell nicht, auch nicht mit allen Bausteinen.`;
  if (enough?.id === "uncontrolled") {
    const room = connectionKw - top.needKw;
    return room > 0 && top !== first
      ? `${words.your} von ${c} reicht schon heute. Mit allen Bausteinen bleiben ${kw(room)} frei für weiteres Wachstum.`
      : `${words.your} von ${c} reicht auch ohne Lademanagement.`;
  }
  if (enough?.id === "managed") return words.over(c);
  if (enough?.id === "managed_storage")
    return `Erst mit Lademanagement und Speicher reicht ${words.your} von ${c}.`;
  return words.grow(kw(top.needKw - connectionKw));
}

/** Wie die rote Linie heisst: Anschluss (Beispiel), Reserve (Flughafen) oder Bedarf (offen). */
export type Line = {
  /** Beschriftung ueber der Treppe und am Diagramm. */
  label: string;
  chart: string;
  nom: string;
  nomLower: string;
  dat: string;
  yourDat: string;
  gen: string;
  /** "Benoetigter Anschluss" bzw. "Benoetigte Reserve" (Spalten, Vorlesetext der Treppe). */
  need: string;
  /** Liegt die Last ueber der Linie, ist das echte Ueberlast (nicht bei offener Reserve). */
  overload: boolean;
  /** Satz unter der Treppe, wenn auch alle Bausteine nicht reichen; null bei offener Reserve. */
  more: ((by: string) => string) | null;
};

export function lineFor(airport: string | null, open: boolean): Line {
  if (!airport)
    return {
      label: "Ihr Anschluss",
      chart: "Netzanschluss",
      nom: "Der Anschluss",
      nomLower: "der Anschluss",
      dat: "dem Anschluss",
      yourDat: "Ihrem Anschluss",
      gen: "Ihres Anschlusses",
      need: "Benötigter Anschluss",
      overload: true,
      more: (by) => `Netzausbau: Der Anschluss braucht ${by} mehr, auch mit allen Bausteinen.`,
    };
  if (open)
    return {
      label: "Mit Lademanagement nötig",
      chart: "Bedarf mit Lademanagement",
      nom: "Diese Leistung",
      nomLower: "diese Leistung",
      dat: "dem Bedarf mit Lademanagement",
      yourDat: "dem Bedarf mit Lademanagement",
      gen: "der mit Lademanagement nötigen Leistung",
      need: "Benötigte Reserve",
      overload: false,
      more: null,
    };
  return {
    label: "Ihre Reserve",
    chart: "Reserve",
    nom: "Die Reserve",
    nomLower: "die Reserve",
    dat: "der Reserve",
    yourDat: "Ihrer Reserve",
    gen: "Ihrer Reserve",
    need: "Benötigte Reserve",
    overload: true,
    more: (by) => `Mehr Reserve: Das Vorfeld braucht ${by} mehr, auch mit allen Bausteinen.`,
  };
}
