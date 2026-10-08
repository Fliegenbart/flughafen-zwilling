/** Der eine Satz zur Tageskurve: wo es eng wird, oder dass der Anschluss reicht. */
import { clock, powerText } from "./format";
import type { LiveResult } from "./livePower";

type Phase = LiveResult["shortfalls"][number];

/** Luecken bis zu dieser Laenge gehoeren zur selben knappen Phase. */
const SAME_PHASE_GAP_MIN = 20;

/** Knappe Phasen des Tages: Unterbrechungen unter 20 Minuten zaehlen als eine Phase. */
export function shortfallPhases(r: LiveResult): Phase[] {
  const out: Phase[] = [];
  for (const s of [...r.shortfalls].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= SAME_PHASE_GAP_MIN) {
      last.end = Math.max(last.end, s.end);
      last.maxMissingKw = Math.max(last.maxMissingKw, s.maxMissingKw);
      last.missingKwh += s.missingKwh;
    } else out.push({ ...s });
  }
  return out;
}

export function worstShortfall(r: LiveResult): Phase | null {
  return shortfallPhases(r).reduce<Phase | null>(
    (a, s) => (!a || s.maxMissingKw > a.maxMissingKw ? s : a),
    null,
  );
}

export function shortfallHeadline(r: LiveResult): string {
  const worst = worstShortfall(r);
  return worst
    ? `Von ${clock(worst.start)} bis ${clock(worst.end)} Uhr fehlen bis zu ${powerText(worst.maxMissingKw)}.`
    : "Der Anschluss reicht den ganzen Tag.";
}
