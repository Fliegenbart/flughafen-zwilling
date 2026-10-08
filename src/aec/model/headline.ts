/** Der eine Satz zur Tageskurve: wo es eng wird, oder dass der Anschluss reicht. */
import type { LiveResult } from "./livePower";
import { ENOUGH, mergePhases, missingSentence } from "./situation";

type Phase = LiveResult["shortfalls"][number];

/** Knappe Phasen des Tages: Unterbrechungen bis 20 Minuten zaehlen als eine Phase. */
export function shortfallPhases(r: LiveResult): Phase[] {
  return mergePhases(r.shortfalls, (a, b) => ({
    start: a.start,
    end: Math.max(a.end, b.end),
    maxMissingKw: Math.max(a.maxMissingKw, b.maxMissingKw),
    missingKwh: a.missingKwh + b.missingKwh,
  }));
}

export function worstShortfall(r: LiveResult): Phase | null {
  return shortfallPhases(r).reduce<Phase | null>(
    (a, s) => (!a || s.maxMissingKw > a.maxMissingKw ? s : a),
    null,
  );
}

export function shortfallHeadline(r: LiveResult): string {
  const worst = worstShortfall(r);
  return worst ? missingSentence(worst.start, worst.end, worst.maxMissingKw) : ENOUGH;
}
