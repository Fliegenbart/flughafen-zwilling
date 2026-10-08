/**
 * Merkt sich die Regler-Stellung je Projekt fuer diese Sitzung, damit ein Wechsel zu Daten oder
 * Zusage und zurueck die Einstellung nicht verwirft. Nichts davon verlaesst den Browser.
 */
import { isFleetKind } from "../api/preview";
import type { Levers } from "../model/livePower";
import { isPolicy } from "../model/policy";
import { caseByScenarioId } from "../scenarios";

const key = (projekt: string) => `aec.regler.${projekt}`;

const NUMBERS = ["gridLimitKw", "batteryKwh", "batteryKw", "pvFactor", "extraVehicles"] as const;

/** Gemerkte Stellung, geprueft: Was nicht mehr passt (alter Stand, fremde Werte), faellt weg. */
export function loadLevers(projekt: string): Partial<Levers> | undefined {
  try {
    const raw = sessionStorage.getItem(key(projekt));
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return undefined;
    const stored = v as Record<string, unknown>;
    const out: Partial<Levers> = {};
    for (const k of NUMBERS) {
      const n = stored[k];
      if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
    }
    if (isFleetKind(stored.extraKind)) out.extraKind = stored.extraKind;
    if (isPolicy(stored.policy)) out.policy = stored.policy;
    if (typeof stored.crisis === "string" && caseByScenarioId(stored.crisis))
      out.crisis = stored.crisis;
    return out;
  } catch {
    return undefined;
  }
}

/** Fehlend und 0 gelten bei Zahlen gleich (wie in isChanged). */
const same = (a: unknown, b: unknown) => (typeof a === "number" ? a === (b ?? 0) : a === b);

/** Nur was von heute abweicht. */
function differences(levers: Levers, today: Levers): Partial<Levers> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(levers))
    if (v !== undefined && !same(v, today[k as keyof Levers])) out[k] = v;
  if (!levers.extraVehicles) delete out.extraKind;
  return Object.keys(out).length ? (out as Partial<Levers>) : null;
}

/**
 * Speichert nur, was von `today` abweicht. Unberuehrte Regler folgen so einem Wert, den man
 * danach in Daten korrigiert hat. `null` loescht: Wer auf heute zurueckgesetzt hat, startet
 * beim naechsten Mal wieder bei heute.
 */
export function saveLevers(projekt: string, levers: Levers | null, today: Levers) {
  try {
    const diff = levers ? differences(levers, today) : null;
    if (diff) sessionStorage.setItem(key(projekt), JSON.stringify(diff));
    else sessionStorage.removeItem(key(projekt));
  } catch {
    /* ohne Sitzungsspeicher: die Stellung gilt nur auf dieser Seite */
  }
}
