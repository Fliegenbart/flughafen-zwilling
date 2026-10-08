/**
 * Der eine HTTP-Client des Airport Energy Check. Alle Module unter `api/` gehen hierueber:
 * gleiche Header (Rolle), gleiche Zeitgrenze, gleiche Fehlerbehandlung.
 */
import { apiBase } from "../../shared/runtimeConfig";
import { isObj, str } from "./parse";
import { storedRole } from "./role";

/** Fachliche Fehlercodes der Austausch-API in Kaeufersprache. */
export function explain(detail: string): string {
  if (detail.includes("acceptance_criteria_not_locked"))
    return "Bevor das Lab eine Anfrage annehmen kann, müssen die Prüfgrenzen feststehen (Modell gegen Messung).";
  if (detail.startsWith("role_forbidden")) return "Dieser Schritt ist Sache der anderen Seite.";
  if (detail.includes("lab_result"))
    return "Als erledigt zählt es erst, wenn das Lab ein Ergebnis gemeldet hat.";
  if (detail.startsWith("no_base"))
    return "Um Lösungen zu rechnen, braucht das Projekt einen Flugplan. Hinterlegen Sie ihn unter „Daten“.";
  if (detail.startsWith("invalid_variant: "))
    return `Diese Lösung geht so nicht: ${detail.slice("invalid_variant: ".length)}`;
  if (detail.includes("Run-Queue voll"))
    return "Der Rechner ist gerade ausgelastet. Bitte warten Sie, bis die laufenden Berechnungen fertig sind.";
  return detail;
}

type Options = {
  timeoutMs?: number;
  /** Uebersetzt Backend-Codes in Saetze; je Bereich verschieden (Austausch, Datenimport). */
  translate?: (detail: string) => string;
};

/** Fehler mit der Original-Antwort, falls ein Aufrufer Details braucht. */
export type ApiError = Error & { body?: unknown };

function detailText(body: unknown, status: number): string {
  const detail = isObj(body) ? body.detail : undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Pydantic-Validierung: erstes Feld nennen.
    const first = detail.find(isObj);
    const field = first && Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
    return `Eingabe ungültig${field ? ` (${String(field)})` : ""}: ${str(first?.msg)}`;
  }
  return `API-Fehler ${status}`;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  { timeoutMs = 12000, translate = explain }: Options = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBase()}/api/v1${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Exchange-Role": storedRole(),
          ...init?.headers,
        },
        signal: init?.signal ?? controller.signal,
      });
    } catch (e) {
      throw new Error(translate(e instanceof Error ? e.message : "Failed to fetch"));
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error: ApiError = new Error(translate(detailText(body, response.status)));
      error.body = body;
      throw error;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Wie `request`, aber `null` statt Fehler (fuer optionale Datenquellen). */
export async function optional<T>(path: string, options?: Options): Promise<T | null> {
  try {
    return await request<T>(path, undefined, options);
  } catch {
    return null;
  }
}
