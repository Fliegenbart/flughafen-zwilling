/**
 * Der eine HTTP-Client des Airport Energy Check. Alle Module unter `api/` gehen hierueber:
 * gleiche Header (Rolle), gleiche Zeitgrenze, gleiche Fehlerbehandlung.
 */
import { apiBase } from "../../shared/runtimeConfig";
import { isObj, str } from "./parse";
import { storedRole } from "./role";

const NO_CONNECTION = "Keine Verbindung zum Server.";

/** So meldet der Browser, dass gar keine Antwort kam: Chrome, Safari, Firefox. */
const isNetworkFailure = (message: string) =>
  /Failed to fetch|Load failed|NetworkError/i.test(message);

/** Der Satz des Servers zu den Grenzen des Modells; er ist schon fuer Kunden geschrieben. */
export function modelLimit(detail: string): string | null {
  return /^invalid_variant: (Das Modell rechnet .+)$/.exec(detail.trim())?.[1] ?? null;
}

/** Fachliche Fehlercodes der Austausch-API in Kaeufersprache. */
export function explain(detail: string): string {
  if (detail.includes("acceptance_criteria_not_locked"))
    return "Bevor das Lab eine Anfrage annehmen kann, müssen die Prüfgrenzen feststehen (Modell gegen Messung).";
  if (detail.startsWith("role_forbidden")) return "Dieser Schritt ist Sache der anderen Seite.";
  if (detail.includes("lab_result"))
    return "Als erledigt zählt es erst, wenn das Lab ein Ergebnis gemeldet hat.";
  if (detail.startsWith("no_base"))
    return "Um Lösungen zu rechnen, braucht das Projekt einen Flugplan. Hinterlegen Sie ihn unter „Daten“.";
  if (detail.startsWith("invalid_variant"))
    return modelLimit(detail) ?? "Diese Lösung lässt sich so nicht rechnen.";
  if (detail.includes("Run-Queue voll")) return "Der Rechner ist gerade belegt.";
  if (/^API-Fehler 5\d\d/.test(detail)) return "Der Server konnte die Anfrage nicht bearbeiten.";
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
  // Zeitgrenze und Abbruch des Aufrufers wirken auf dieselbe Anfrage.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const caller = init?.signal;
  const forward = () => controller.abort();
  if (caller?.aborted) forward();
  else caller?.addEventListener("abort", forward, { once: true });
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
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new Error("Der Server antwortet nicht.");
      const message = e instanceof Error ? e.message : "Failed to fetch";
      // Ein Satz fuer alle Bereiche, bevor ihre eigenen Uebersetzer den Browsertext sehen.
      throw new Error(isNetworkFailure(message) ? NO_CONNECTION : translate(message));
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
    caller?.removeEventListener("abort", forward);
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
