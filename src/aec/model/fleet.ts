/** Fahrzeugklassen am Vorfeld: Namen an einer Stelle fuer alle Seiten. */
import type { FleetKind } from "../types";

export const FLEET_LABEL: Record<FleetKind, string> = {
  bus: "Busse",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Pushback-Schlepper",
  gpu: "Bodenstromgeräte",
};
