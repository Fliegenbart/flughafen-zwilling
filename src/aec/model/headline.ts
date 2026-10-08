/** Der eine Satz zur Tageskurve: wo es eng wird, oder dass der Anschluss reicht. */
import { clock, powerText } from "./format";
import type { LiveResult } from "./livePower";

export function worstShortfall(r: LiveResult): LiveResult["shortfalls"][number] | null {
  return r.shortfalls.reduce<LiveResult["shortfalls"][number] | null>(
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
