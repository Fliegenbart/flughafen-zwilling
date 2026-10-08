/** Austausch Flughafen und Testing-Lab, inkl. Uebernahme aus der Bibliothek. */
import { sampleExchange } from "../sample";
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

const sessionKey = (projectId: string) => `aec.exchange.${projectId}`;
function sessionItems(projectId: string): ExchangeItem[] {
  try {
    const raw = sessionStorage.getItem(sessionKey(projectId));
    return raw ? (JSON.parse(raw) as ExchangeItem[]) : sampleExchange(projectId);
  } catch {
    return sampleExchange(projectId);
  }
}
function saveSession(projectId: string, items: ExchangeItem[]) {
  try {
    sessionStorage.setItem(sessionKey(projectId), JSON.stringify(items));
  } catch {
    /* fluechtig */
  }
}

export async function listExchange(project: Project): Promise<ExchangeItem[]> {
  if (project.source === "api") {
    try {
      const data = await call<unknown>(`/projects/${enc(project.id)}/exchange`);
      if (Array.isArray(data))
        return data.map(exchangeFromApi).filter((x): x is ExchangeItem => x !== null);
    } catch {
      /* Beispiel */
    }
  }
  return sessionItems(project.id);
}

export async function advanceExchange(
  project: Project,
  item: ExchangeItem,
  to: ExchangeStatus,
  by: Party,
  reason?: string,
): Promise<ExchangeItem> {
  if (item.source === "api") {
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
  const next: ExchangeItem = {
    ...item,
    status: to,
    history: [
      ...item.history,
      { status: to, at: new Date().toISOString().slice(0, 16), by, note: reason },
    ],
  };
  saveSession(
    project.id,
    sessionItems(project.id).map((i) => (i.id === item.id ? next : i)),
  );
  return next;
}

export async function proposeTest(
  project: Project,
  question: string,
  component: string,
): Promise<ExchangeItem> {
  if (project.source === "api") {
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
  const item: ExchangeItem = {
    id: `${project.id}-l${Date.now().toString(36)}`,
    kind: "testanfrage",
    title: question,
    summary: component,
    from: "flughafen",
    status: "vorgeschlagen",
    evidence: "assumption",
    source: "beispiel",
    history: [
      { status: "vorgeschlagen", at: new Date().toISOString().slice(0, 16), by: "flughafen" },
    ],
  };
  saveSession(project.id, [item, ...sessionItems(project.id)]);
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
  const item: ExchangeItem = {
    id: `${project.id}-s${Date.now().toString(36)}`,
    kind: "szenario",
    title: `${name} als Stresstest`,
    summary: "Aus der Szenario-Bibliothek übernommen.",
    from: "flughafen",
    status: "uebergeben",
    evidence: "synthetic",
    source: "beispiel",
    history: [{ status: "uebergeben", at: new Date().toISOString().slice(0, 16), by: "flughafen" }],
  };
  saveSession(project.id, [item, ...sessionItems(project.id)]);
  return "beispiel";
}
