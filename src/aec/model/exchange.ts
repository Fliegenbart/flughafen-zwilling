/** Austausch Flughafen und Testing-Lab: Statusfluss, wer am Zug ist, Beschriftungen. */
import type { ExchangeItem, ExchangeStatus, Party } from "../types";

export const EXCHANGE_FLOW: ExchangeStatus[] = [
  "vorgeschlagen",
  "angenommen",
  "geplant",
  "erledigt",
];
export const PARTY_LABEL: Record<Party, string> = { flughafen: "Flughafen", lab: "Testing-Lab" };
const other = (p: Party): Party => (p === "lab" ? "flughafen" : "lab");

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
