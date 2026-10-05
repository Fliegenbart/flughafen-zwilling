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
};

export type Window = { start: number; end: number; peakKw: number; deficitKw: number };

export type Variant = {
  id: string;
  name: string;
  kind: "basis" | "speicher" | "fahrzeuge" | "laderegel" | "anschluss";
  onTimePct: number;
  minutesAtLimit: number;
  gridEnergyMwh: number;
  peakKw: number;
  evidence: EvidenceLevel;
  source: DataSource;
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
