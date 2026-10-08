/**
 * Knappe Phasen des Tages und der Satz dazu. Reine Funktionen, damit die Antwort einer Ansicht
 * testbar aus den Daten folgt. Startseite, Durchrechnen (model/headline.ts) und Zusage zaehlen
 * dieselben Phasen und sagen sie mit demselben Satz.
 */
import type { Situation, Window } from "../types";
import { clock, powerText } from "./format";

/** Luecken bis zu dieser Laenge gehoeren zur selben knappen Phase. */
const SAME_PHASE_GAP_MIN = 20;

/** Der Satz, wenn der Anschluss den ganzen Tag reicht. */
export const ENOUGH = "Der Anschluss reicht den ganzen Tag.";

/**
 * Fasst Abschnitte zu Phasen zusammen: Unterbrechungen bis 20 Minuten zaehlen als eine Phase.
 * `combine` verschmilzt zwei benachbarte Abschnitte; die Eingabe bleibt unveraendert.
 */
export function mergePhases<T extends { start: number; end: number }>(
  list: readonly T[],
  combine: (a: T, b: T) => T,
): T[] {
  const out: T[] = [];
  for (const p of [...list].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && p.start - last.end <= SAME_PHASE_GAP_MIN) out[out.length - 1] = combine(last, p);
    else out.push({ ...p });
  }
  return out;
}

/** Knappe Phasen aus Fenstern: zusammenhaengende Fenster verschmelzen, das Defizit gilt je Phase. */
export const mergeWindows = (windows: readonly Window[]): Window[] =>
  mergePhases(windows, (a, b) => ({
    start: a.start,
    end: Math.max(a.end, b.end),
    deficitKw: Math.max(a.deficitKw, b.deficitKw),
  }));

/** Die knappen Phasen des Tages. */
export function limitWindows(s: Situation): Window[] {
  return s.windows;
}

/** Die knappste Phase: die mit der groessten fehlenden Leistung, bei Gleichstand die laengste. */
export function worstWindow(s: Situation): Window | null {
  const length = (w: Window) => w.end - w.start;
  return s.windows.reduce<Window | null>(
    (a, w) =>
      !a || w.deficitKw > a.deficitKw || (w.deficitKw === a.deficitKw && length(w) > length(a))
        ? w
        : a,
    null,
  );
}

export function pointAt(s: Situation, minute: number) {
  const i = Math.max(0, Math.min(s.load.length - 1, Math.round(minute / s.stepMinutes)));
  const p = s.load[i]!;
  const slot = s.departures[Math.min(s.departures.length - 1, Math.floor(minute / 30))];
  return { ...p, reserveKw: s.gridLimitKw - p.demandKw, departures: slot?.count ?? 0 };
}

/** "Von 17:40 bis 19:13 Uhr fehlen bis zu 1,10 MW." */
export const missingSentence = (start: number, end: number, missingKw: number) =>
  `Von ${clock(start)} bis ${clock(end)} Uhr fehlen bis zu ${powerText(missingKw)}.`;

/** Der Satz zur knappsten Phase des Tages (Zusage). */
export function bottleneckAnswer(s: Situation): string {
  const worst = worstWindow(s);
  if (!worst) return ENOUGH;
  // Aus dem Netzbezug der API folgt nur, dass der Anschluss voll war, nicht wie viel fehlte.
  if (worst.deficitKw <= 0)
    return `Von ${clock(worst.start)} bis ${clock(worst.end)} Uhr ist der Anschluss voll ausgelastet.`;
  return missingSentence(worst.start, worst.end, worst.deficitKw);
}
