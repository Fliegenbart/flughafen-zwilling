/** Der Tag in Fuenf-Minuten-Punkten fuer Diagramme: was gebraucht wird, was der Anschluss gibt. */
import type { LiveResult } from "./livePower";

/** Minuten je Kurvenpunkt. */
export const STEP = 5;

export type Point = { m: number; need: number; cap: number; cover: number; miss: number };

/** Je 5 Minuten: Maximum fuer den Bedarf und Fehlendes (nichts darf verschwinden). */
export function points(r: LiveResult): Point[] {
  const out: Point[] = [];
  for (let m = 0; m < r.importKw.length; m += STEP) {
    let need = 0;
    let cover = 0;
    let miss = 0;
    let cap = Infinity;
    const end = Math.min(r.importKw.length, m + STEP);
    for (let i = m; i < end; i++) {
      const discharge = Math.max(0, r.batteryKw[i]!);
      const n = r.importKw[i]! + discharge + r.missingKw[i]!;
      need = Math.max(need, n);
      cover = Math.max(cover, discharge);
      miss = Math.max(miss, r.missingKw[i]!);
      cap = Math.min(cap, r.capKw[i]!);
    }
    out.push({ m, need, cap, cover, miss });
  }
  return out;
}
