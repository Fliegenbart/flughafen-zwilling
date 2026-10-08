/**
 * Lagebild: knappe Phasen, Kennzahlen und die Antwortsaetze der Seiten Tag und Engpass.
 * Reine Funktionen, damit die Antwort einer Ansicht testbar aus den Daten folgt.
 */
import type { Situation, Window } from "../types";
import { clock, powerText } from "./format";

/** Zusammenhaengende Zeitraeume, in denen der Bedarf die Anschlussgrenze uebersteigt. */
export function limitWindows(s: Situation): Window[] {
  if (s.windows) return s.windows;
  const out: Window[] = [];
  let current: Window | null = null;
  for (const p of s.load) {
    const over =
      s.kind === "bezug" ? p.demandKw >= s.gridLimitKw - 0.5 : p.demandKw > s.gridLimitKw;
    if (over) {
      if (!current)
        current = { start: p.minute, end: p.minute + s.stepMinutes, peakKw: 0, deficitKw: 0 };
      current.end = p.minute + s.stepMinutes;
      current.peakKw = Math.max(current.peakKw, p.demandKw);
      current.deficitKw = Math.max(current.deficitKw, p.demandKw - s.gridLimitKw);
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

export function situationKpis(s: Situation) {
  const windows = limitWindows(s);
  const minutesAtLimit = windows.reduce((sum, w) => sum + (w.end - w.start), 0);
  const peak = s.load.reduce((m, p) => Math.max(m, p.demandKw), 0);
  const departures = s.departures.reduce((sum, d) => sum + d.count, 0);
  const worst = windows.reduce<Window | null>(
    (a, w) => (!a || w.deficitKw > a.deficitKw ? w : a),
    null,
  );
  const minReserve = s.load.reduce((m, p) => Math.min(m, s.gridLimitKw - p.demandKw), Infinity);
  return { windows, minutesAtLimit, peak, departures, worst, minReserve };
}

/** Abfluege, deren halbe Stunde ein Engpassfenster beruehrt. */
export function departuresInWindows(s: Situation, windows: Window[]) {
  return s.departures
    .filter((d) => windows.some((w) => d.minute < w.end && d.minute + 30 > w.start))
    .reduce((sum, d) => sum + d.count, 0);
}

export function pointAt(s: Situation, minute: number) {
  const i = Math.max(0, Math.min(s.load.length - 1, Math.round(minute / s.stepMinutes)));
  const p = s.load[i]!;
  const slot = s.departures[Math.min(s.departures.length - 1, Math.floor(minute / 30))];
  return { ...p, reserveKw: s.gridLimitKw - p.demandKw, departures: slot?.count ?? 0 };
}

/** Der grosse Antwortsatz der Ansicht "Lage". */
export function situationAnswer(s: Situation): string {
  const { windows, minReserve } = situationKpis(s);
  if (!windows.length)
    return `Der Anschluss reicht den ganzen Tag, im knappsten Moment bleiben ${powerText(minReserve)} frei.`;
  const w = windows.reduce((a, b) => (b.deficitKw > a.deficitKw ? b : a));
  const more =
    windows.length > 1
      ? ` Dazu ${windows.length === 2 ? "kommt eine kürzere enge Phase" : `kommen ${windows.length - 1} kürzere enge Phasen`}.`
      : "";
  return `Von ${clock(w.start)} bis ${clock(w.end)} Uhr reicht der Anschluss nicht.${more}`;
}

/** Der grosse Antwortsatz der Ansicht "Engpass". */
export function bottleneckAnswer(s: Situation): string {
  const { worst } = situationKpis(s);
  if (!worst) return "Es wird an keinem Punkt des Tages eng.";
  // Die Ursache (Strom oder Fahrzeuge) steht im Lead und im Abschnitt darunter,
  // damit die Ueberschrift ein einziger, kurzer Satz bleibt.
  if (s.kind === "bezug" || worst.deficitKw <= 0)
    return `Von ${clock(worst.start)} bis ${clock(worst.end)} Uhr ist der Anschluss voll ausgelastet.`;
  return `Von ${clock(worst.start)} bis ${clock(worst.end)} Uhr fehlen bis zu ${powerText(worst.deficitKw)}.`;
}
