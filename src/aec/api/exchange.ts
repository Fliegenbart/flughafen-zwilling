/** Austausch fuer den Messdaten-Abgleich, inkl. Uebernahme aus der Bibliothek. */
import type { ExchangeItem, ExchangeKind, ExchangeStatus, Party, Project } from "../types";
import { request as call } from "./http";
import { enc, evidence, isObj, str } from "./parse";

const STATUS_FROM_API: Record<string, ExchangeStatus> = {
  proposed: "vorgeschlagen",
  accepted: "angenommen",
  scheduled: "geplant",
  done: "erledigt",
  rejected: "abgelehnt",
  frozen: "uebergeben",
};
const STATUS_TO_API: Partial<Record<ExchangeStatus, string>> = {
  angenommen: "accepted",
  geplant: "scheduled",
  erledigt: "done",
  abgelehnt: "rejected",
};
const KIND_FROM_API: Record<string, ExchangeKind> = {
  scenario_package: "szenario",
  test_request: "testanfrage",
  lab_result: "ergebnis",
};

export function exchangeFromApi(raw: unknown): ExchangeItem | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null;
  const kind = KIND_FROM_API[str(raw.type)];
  if (!kind) return null;
  const content = isObj(raw.content) ? raw.content : {};
  const from: Party =
    str(raw.direction) === "lab_to_airport" || kind === "ergebnis" ? "lab" : "flughafen";
  const status = STATUS_FROM_API[str(raw.status)] ?? "vorgeschlagen";
  const title =
    str(content.title) || str(content.question) || str(content.summary) || "Austauschpunkt";
  const summary =
    kind === "testanfrage"
      ? [str(content.component), str(content.note)].filter(Boolean).join(" · ")
      : str(content.note) || str(content.summary);
  return {
    id: raw.id,
    kind,
    title,
    summary,
    from,
    status,
    evidence: evidence(raw.evidence_level),
    history: [
      { status: "vorgeschlagen", at: str(raw.created_at), by: from },
      ...(status !== "vorgeschlagen"
        ? [
            {
              status,
              at: str(raw.updated_at),
              by: "lab" as Party,
              note: str(raw.status_reason) || undefined,
            },
          ]
        : []),
    ],
    source: "api",
  };
}

export async function listExchange(project: Project): Promise<ExchangeItem[]> {
  if (project.source !== "api") return [];
  const data = await call<unknown>(`/projects/${enc(project.id)}/exchange`);
  if (!Array.isArray(data)) throw new Error("Unerwartete Antwort der Austausch-API");
  return data.map(exchangeFromApi).filter((x): x is ExchangeItem => x !== null);
}

export async function advanceExchange(
  project: Project,
  item: ExchangeItem,
  to: ExchangeStatus,
  _by: Party,
  reason?: string,
): Promise<ExchangeItem> {
  if (project.source !== "api" || item.source !== "api") {
    throw new Error("Für das Beispielprojekt kann kein Messdaten-Abgleich fortgeschrieben werden.");
  }
  const raw = await call<unknown>(
    `/projects/${enc(project.id)}/exchange/${enc(item.id)}/transition`,
    {
      method: "POST",
      body: JSON.stringify({ to: STATUS_TO_API[to], ...(reason ? { reason } : {}) }),
    },
  );
  const next = exchangeFromApi(raw);
  if (!next) throw new Error("Unerwartete Antwort der Austausch-API");
  return next;
}

export async function proposeTest(
  project: Project,
  question: string,
  component: string,
): Promise<ExchangeItem> {
  if (project.source !== "api") {
    throw new Error("Für das Beispielprojekt kann kein Messdaten-Abgleich beauftragt werden.");
  }
  const raw = await call<unknown>(`/projects/${enc(project.id)}/exchange`, {
    method: "POST",
    body: JSON.stringify({
      type: "test_request",
      question,
      component: component || "nicht angegeben",
    }),
  });
  const item = exchangeFromApi(raw);
  if (!item) throw new Error("Unerwartete Antwort der Austausch-API");
  return item;
}

/** Szenario aus der Bibliothek ins Projekt uebernehmen (als Szenario-Paket). */
export async function adoptScenario(
  project: Project,
  scenarioId: string,
  name: string,
): Promise<"api" | "beispiel"> {
  if (project.source === "api") {
    await call<unknown>(`/library/scenarios/${enc(scenarioId)}/adopt`, {
      method: "POST",
      body: JSON.stringify({
        project_id: project.id,
        note: "Aus der Szenario-Bibliothek übernommen",
      }),
    });
    return "api";
  }
  void name;
  return "beispiel";
}
