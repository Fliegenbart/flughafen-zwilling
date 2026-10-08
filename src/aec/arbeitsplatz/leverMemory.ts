/**
 * Merkt sich die Regler-Stellung je Projekt fuer diese Sitzung, damit ein Wechsel zu Daten oder
 * Zusage und zurueck die Einstellung nicht verwirft. Nichts davon verlaesst den Browser.
 */
import type { Levers } from "../model/livePower";

const key = (projekt: string) => `aec.regler.${projekt}`;

export function loadLevers(projekt: string): Partial<Levers> | undefined {
  try {
    const raw = sessionStorage.getItem(key(projekt));
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Partial<Levers>) : undefined;
  } catch {
    return undefined;
  }
}

/** `null` loescht: Wer auf heute zurueckgesetzt hat, startet beim naechsten Mal wieder bei heute. */
export function saveLevers(projekt: string, levers: Levers | null) {
  try {
    if (levers) sessionStorage.setItem(key(projekt), JSON.stringify(levers));
    else sessionStorage.removeItem(key(projekt));
  } catch {
    /* ohne Sitzungsspeicher: die Stellung gilt nur auf dieser Seite */
  }
}
