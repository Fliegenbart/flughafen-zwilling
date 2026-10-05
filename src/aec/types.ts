/**
 * Datenmodell des Airport Energy Check (Frontend-Sicht).
 * Jede Zahl traegt ihre Herkunft: `source` = "api" (aus dem Backend) oder
 * "beispiel" (klar markierte Beispieldaten zur Gestaltung/Vorfuehrung).
 */
import type { EvidenceLevel } from "../ui/EvidenceBadge";

export type DataSource = "api" | "beispiel";

export type Project = {
  id: string;
  name: string;
  airport: string;
  site: string;
  dayLabel: string;
  fleetSize: number;
  gridLimitKw: number;
  decision?: string;
  source: DataSource;
};

/** Ein Messpunkt des Tages: Bedarf (Laden + Grundlast), davon PV-Deckung. */
export type LoadPoint = { minute: number; demandKw: number; baseKw: number; pvKw: number };
export type DepartureSlot = { minute: number; count: number };
export type Situation = {
  projectId: string;
  source: DataSource;
  evidence: EvidenceLevel;
  /** "bedarf": ungedeckelter Ladebedarf (Beispiel); "bezug": tatsaechlicher Netzbezug, am Limit gedeckelt (API). */
  kind: "bedarf" | "bezug";
  gridLimitKw: number;
  stepMinutes: number;
  load: LoadPoint[];
  departures: DepartureSlot[];
  /** Engpassfenster, falls die API sie liefert; sonst aus dem Verlauf abgeleitet. */
  windows?: Window[];
  /** Abfluege mit verspaeteter Abfertigung und Anteil fahrzeugbedingt (0..1). */
  delayedDepartures: number;
  vehicleShare: number;
  /** Modellierte Flotte des Laufs (nur API). */
  fleet?: Fleet;
};

export type Window = { start: number; end: number; peakKw: number; deficitKw: number };

export type Variant = {
  id: string;
  name: string;
  kind: "basis" | "speicher" | "fahrzeuge" | "laderegel" | "anschluss" | "pv" | "ausfall" | "mix";
  onTimePct: number;
  minutesAtLimit: number;
  gridEnergyMwh: number;
  peakKw: number;
  evidence: EvidenceLevel;
  source: DataSource;
  /** Nur aus der API: weitere Kennzahlen eines gerechneten Laufs. */
  delayedDepartures?: number;
  departuresTotal?: number;
  missingKw?: number | null;
  backgroundUnservedKwh?: number;
  bottleneck?: string | null;
  energyShare?: number;
  fleetTotal?: number | null;
  deltaOnTimePct?: number | null;
  deltaMinutes?: number | null;
  stressOnTimePct?: number | null;
  status?: string;
};

export type FleetKind = "bus" | "baggage_tractor" | "pushback_tug" | "gpu";
export type Fleet = {
  total: number | null;
  byKind: { kind: FleetKind; label: string; vehicles: number; chargers: number }[];
  source: string | null;
};

/** Parameteraenderungen einer Variante gegenueber der Basis (Vertrag: EXCHANGE_API.md). */
export type VariantChanges = {
  grid_import_limit_kw?: number;
  storage_kwh?: number;
  storage_kw?: number;
  extra_vehicles?: Partial<Record<FleetKind, number>>;
  charging_policy?: "uncontrolled" | "mission_priority";
  chargers_offline?: Partial<Record<FleetKind, number>>;
  pv_factor?: number;
};
export type VariantDefinition = { id: string; name: string; changes: VariantChanges };

export type VariantBoard = {
  source: DataSource;
  /** Basis des Projekts; null ohne gekoppelten Lauf und ohne Flugplan. */
  base: {
    source: string;
    policy: string;
    gridLimitKw: number;
    storageKwh: number;
    fleet: Fleet;
  } | null;
  definitions: VariantDefinition[];
  run: {
    status: "queued" | "running" | "completed" | "partial";
    done: number;
    total: number;
    stress: boolean;
    stale: boolean;
    /** Projektwerte oder Flugplan seit dem Lauf geaendert (Hash-Vergleich im Backend). */
    inputsStale: boolean;
    createdAt: string;
  } | null;
  /** Gerechnete Varianten (inkl. Basis) bzw. Beispielwerte. */
  variants: Variant[];
  answer: {
    status: string;
    headline: string;
    details: string[];
    bestId: string | null;
  } | null;
};

export type ExchangeStatus =
  | "vorgeschlagen"
  | "angenommen"
  | "geplant"
  | "erledigt"
  | "abgelehnt"
  /** Szenario-Pakete werden eingefroren uebergeben, ohne Arbeitsfluss. */
  | "uebergeben";
export type Party = "flughafen" | "lab";
export type ExchangeKind = "szenario" | "testanfrage" | "ergebnis" | "auswertung";
export type ExchangeEvent = { status: ExchangeStatus; at: string; by: Party; note?: string };
export type ExchangeItem = {
  id: string;
  kind: ExchangeKind;
  title: string;
  summary: string;
  from: Party;
  status: ExchangeStatus;
  evidence: EvidenceLevel;
  history: ExchangeEvent[];
  source: DataSource;
};
