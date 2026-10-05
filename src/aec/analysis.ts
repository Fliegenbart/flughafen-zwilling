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
    return `Der Anschluss trägt den ganzen Tag. Die knappste Reserve liegt bei ${powerText(minReserve)}.`;
  const w = windows.reduce((a, b) => (b.deficitKw > a.deficitKw ? b : a));
  const more = windows.length > 1 ? ` Dazu ${windows.length - 1} kürzere Engpässe.` : "";
  return `Der Tag ist tragfähig bis auf ein Fenster: ${clock(w.start)}–${clock(w.end)} Uhr.${more}`;
}

/** Der grosse Antwortsatz der Ansicht "Engpass". */
export function bottleneckAnswer(s: Situation): string {
  const { worst } = situationKpis(s);
  if (!worst)
    return "Es wird nirgends eng: der Bedarf bleibt den ganzen Tag unter der Anschlussgrenze.";
  const cause =
    s.delayedDepartures > 0 && s.vehicleShare >= 0.5
      ? " Der Strom ist aber nicht der Hauptengpass, die Fahrzeuge sind es."
      : "";
  if (s.kind === "bezug" || worst.deficitKw <= 0)
    return `Zwischen ${clock(worst.start)} und ${clock(worst.end)} liegt der Anschluss am Limit.${cause}`;
  return `Zwischen ${clock(worst.start)} und ${clock(worst.end)} fehlen bis zu ${powerText(worst.deficitKw)}.${cause}`;
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

export function variantsAnswer(variants: Variant[]): string {
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  const best = bestVariant(variants);
  if (!base || !best || best.id === base.id) return "Keine Variante verbessert die Basis messbar.";
  const gain = best.onTimePct - base.onTimePct;
  const noEffect = variants.filter(
    (v) => v.id !== base.id && Math.abs(v.onTimePct - base.onTimePct) < 1,
  );
  const tail = noEffect.length
    ? ` ${noEffect.map((v) => v.name).join(", ")}: kein messbarer Unterschied.`
    : "";
  return `„${best.name}“ hilft am meisten: ${gain} Prozentpunkte mehr pünktlich abgefertigte Abflüge.${tail}`;
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
  if (!open.length) return "Alles abgestimmt: kein offener Punkt zwischen Flughafen und Lab.";
  const part = (n: number, who: string) => `${n === 1 ? "ein Punkt" : `${n} Punkte`} beim ${who}`;
  const pieces = [lab ? part(lab, "Lab") : "", airport ? part(airport, "Flughafen") : ""].filter(
    Boolean,
  );
  return `${open.length} offen: ${pieces.join(", ")}.`;
}
