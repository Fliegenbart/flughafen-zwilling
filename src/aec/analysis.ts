/**
 * Ableitungen aus dem Lagebild: Engpassfenster, Kennzahlen, Antwortsaetze.
 * Reine Funktionen, damit die Antwort einer Ansicht testbar aus den Daten folgt.
 */
import type { ExchangeItem, ExchangeStatus, Party, Situation, Variant, Window } from "./types";

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const clock = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Leistung in Kaeufer-Einheit: unter 1 MW in kW, sonst MW mit zwei Stellen. */
export function power(kw: number): { value: string; unit: string } {
  return Math.abs(kw) >= 1000
    ? { value: nf2.format(kw / 1000), unit: "MW" }
    : { value: nf0.format(kw), unit: "kW" };
}
export const powerText = (kw: number) => {
  const p = power(kw);
  return `${p.value}\u00a0${p.unit}`;
};
export const int = (n: number) => nf0.format(n);
export const dec1 = (n: number) => nf1.format(n);

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
    return `Der Anschluss reicht den ganzen Tag. Am knappsten bleiben noch ${powerText(minReserve)} Luft.`;
  const w = windows.reduce((a, b) => (b.deficitKw > a.deficitKw ? b : a));
  const more =
    windows.length > 1
      ? ` Dazu ${windows.length === 2 ? "eine kürzere Phase" : `${windows.length - 1} kürzere Phasen`}.`
      : "";
  return `Der Anschluss reicht fast den ganzen Tag. Knapp wird es zwischen ${clock(w.start)} und ${clock(w.end)} Uhr.${more}`;
}

/** Der grosse Antwortsatz der Ansicht "Engpass". */
export function bottleneckAnswer(s: Situation): string {
  const { worst } = situationKpis(s);
  if (!worst)
    return "Es wird nie eng. Der Anschluss gibt den ganzen Tag mehr her, als gebraucht wird.";
  // Die Ursache (Strom oder Fahrzeuge) steht im Lead und im Abschnitt darunter,
  // damit die Ueberschrift ein einziger, kurzer Satz bleibt.
  if (s.kind === "bezug" || worst.deficitKw <= 0)
    return `Zwischen ${clock(worst.start)} und ${clock(worst.end)} Uhr ist der Anschluss voll ausgereizt.`;
  return `Zwischen ${clock(worst.start)} und ${clock(worst.end)} Uhr fehlen bis zu ${powerText(worst.deficitKw)}.`;
}

export function bestVariant(variants: Variant[]): Variant | null {
  return variants.reduce<Variant | null>(
    (best, v) =>
      !best ||
      v.onTimePct > best.onTimePct ||
      (v.onTimePct === best.onTimePct && v.minutesAtLimit < best.minutesAtLimit)
        ? v
        : best,
    null,
  );
}

/** Antwortsatz: Pünktlichkeit und Netzentlastung getrennt (Schwellen wie im Backend). */
export function variantsAnswer(variants: Variant[]): string {
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  if (!base) return "Keine Lösung macht die Abflüge pünktlicher.";
  const others = variants.filter((v) => v.id !== base.id);
  const gain = (v: Variant) => v.onTimePct - base.onTimePct;
  const relief = (v: Variant) => base.minutesAtLimit - v.minutesAtLimit;
  const punctual = others.filter((v) => gain(v) >= 0.5);
  const gridBest = others
    .filter((v) => relief(v) > 1)
    .reduce<Variant | null>((a, v) => (!a || relief(v) > relief(a) ? v : a), null);
  const gridText = gridBest
    ? `Den Anschluss entlastet „${gridBest.name}“ am meisten: ${int(relief(gridBest))} Minuten weniger am Limit`
    : "keine Lösung entlastet den Anschluss spürbar";
  const noEffect = others.filter((v) => Math.abs(gain(v)) < 0.5 && Math.abs(relief(v)) <= 1);
  const tail = noEffect.length
    ? ` ${noEffect.map((v) => `„${v.name}“`).join(", ")} ${noEffect.length === 1 ? "ändert" : "ändern"} praktisch nichts.`
    : "";
  if (!punctual.length)
    return `Keine Lösung macht die Abflüge pünktlicher. ${gridText.charAt(0).toUpperCase() + gridText.slice(1)}.${tail}`;
  const best = punctual.reduce((a, v) => (gain(v) > gain(a) ? v : a));
  let grid: string;
  if (-relief(best) > 1)
    grid = `Der Haken: Der Anschluss ist damit ${int(-relief(best))} Minuten länger am Limit.${gridBest ? ` ${gridText.charAt(0).toUpperCase() + gridText.slice(1)}` : ""}`;
  else if (gridBest === best)
    grid = `Sie entlastet zugleich den Anschluss am meisten: ${int(relief(best))} Minuten weniger am Limit`;
  else grid = gridText.charAt(0).toUpperCase() + gridText.slice(1);
  return `Am meisten hilft „${best.name}“: ${dec1(gain(best))} Prozentpunkte mehr Abflüge pünktlich. ${grid}.${tail}`;
}

/* ---------------------------------------------------------------- Austausch */

export const EXCHANGE_FLOW: ExchangeStatus[] = [
  "vorgeschlagen",
  "angenommen",
  "geplant",
  "erledigt",
];
export const PARTY_LABEL: Record<Party, string> = { flughafen: "Flughafen", lab: "Testing-Lab" };
export const other = (p: Party): Party => (p === "lab" ? "flughafen" : "lab");

/** Wer ist am Zug? Vorschlag: Empfaenger nimmt an. Danach plant und liefert das Lab. */
export function whoseTurn(item: ExchangeItem): Party | null {
  if (item.status === "erledigt" || item.status === "abgelehnt" || item.status === "uebergeben")
    return null;
  if (item.status === "vorgeschlagen") return other(item.from);
  return "lab";
}

export function nextStatus(status: ExchangeStatus): ExchangeStatus | null {
  if (status === "abgelehnt" || status === "uebergeben") return null;
  const i = EXCHANGE_FLOW.indexOf(status);
  return i >= 0 && i < EXCHANGE_FLOW.length - 1 ? EXCHANGE_FLOW[i + 1]! : null;
}

export const ACTION_LABEL: Record<ExchangeStatus, string> = {
  vorgeschlagen: "Vorschlagen",
  angenommen: "Annehmen",
  geplant: "Einplanen",
  erledigt: "Als erledigt melden",
  abgelehnt: "Ablehnen",
  uebergeben: "Übergeben",
};

export const STATUS_LABEL: Record<ExchangeStatus, string> = {
  vorgeschlagen: "vorgeschlagen",
  angenommen: "angenommen",
  geplant: "geplant",
  erledigt: "erledigt",
  abgelehnt: "abgelehnt",
  uebergeben: "übergeben",
};

export function exchangeAnswer(items: ExchangeItem[]): string {
  const open = items.filter((i) => whoseTurn(i) !== null);
  const lab = open.filter((i) => whoseTurn(i) === "lab").length;
  const airport = open.filter((i) => whoseTurn(i) === "flughafen").length;
  if (!open.length) return "Nichts offen. Flughafen und Lab sind auf dem gleichen Stand.";
  const waiting = (n: number, who: string) =>
    `${n === 1 ? "Ein Punkt wartet" : `${n} Punkte warten`} auf ${who}.`;
  if (!airport) return waiting(lab, "das Lab");
  if (!lab) return waiting(airport, "den Flughafen");
  return `${open.length} Punkte offen: ${lab} beim Lab, ${airport} beim Flughafen.`;
}
