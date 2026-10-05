/**
 * Adapter zur Austausch-API (Vertrag: docs/EXCHANGE_API.md).
 * Jede Funktion prueft die Antwortform. Liefert das Backend nichts Brauchbares,
 * fallen Projekt-Ansichten auf klar markierte Beispieldaten zurueck; Schreibaktionen
 * auf Beispielprojekten bleiben lokal (Sitzungsspeicher) und sind als solche markiert.
 */
import { apiBase } from "../lab/api";
import type { EvidenceLevel } from "../ui/EvidenceBadge";
import { SAMPLE_PROJECT, sampleExchange, sampleSituation, sampleVariants } from "./sample";
import type {
  ExchangeItem,
  ExchangeKind,
  ExchangeStatus,
  Fleet,
  FleetKind,
  Party,
  Project,
  Situation,
  Variant,
  VariantBoard,
  VariantChanges,
} from "./types";

export type Role = "airport" | "lab" | "admin";
const ROLE_KEY = "aec.role";

export function storedRole(): Role {
  try {
    const r = sessionStorage.getItem(ROLE_KEY);
    return r === "airport" || r === "lab" ? r : "admin";
  } catch {
    return "admin";
  }
}
export function storeRole(role: Role) {
  try {
    sessionStorage.setItem(ROLE_KEY, role);
  } catch {
    /* nur fuer diese Ansicht */
  }
}

/** Fachliche Fehlercodes der Austausch-API in Kaeufersprache. */
export function explain(detail: string): string {
  if (detail.includes("acceptance_criteria_not_locked"))
    return "Erst die Abnahmekriterien im Messdaten-Abgleich sperren, dann kann das Lab eine Testanfrage annehmen.";
  if (detail.startsWith("role_forbidden"))
    return "Diese Rolle darf diesen Schritt nicht ausführen.";
  if (detail.includes("lab_result")) return "Erledigt erst mit einem gemeldeten Lab-Ergebnis.";
  if (detail.startsWith("no_base"))
    return "Für Varianten braucht das Projekt einen gekoppelten Lauf oder einen verknüpften Flugplan.";
  if (detail.startsWith("invalid_variant: "))
    return `Variante nicht zulässig: ${detail.slice("invalid_variant: ".length)}`;
  if (detail.includes("Run-Queue voll")) return "Rechner ausgelastet. Laufende Läufe abwarten.";
  return detail;
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase()}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Exchange-Role": storedRole(),
        ...init?.headers,
      },
      signal: init?.signal ?? controller.signal,
    });
    if (!response || !response.ok) {
      const body = (await response?.json().catch(() => ({}))) as { detail?: unknown };
      const detail =
        typeof body?.detail === "string" ? body.detail : `API-Fehler ${response?.status}`;
      throw new Error(explain(detail));
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export const EVIDENCE_FROM_API: Record<string, EvidenceLevel> = {
  assumption: "assumption",
  synthetic: "synthetic",
  model_checked: "model_checked",
  empirical_open: "empirical_open",
  empirical_pass: "empirical_passed",
};
const evidence = (v: unknown, d: EvidenceLevel = "assumption"): EvidenceLevel =>
  EVIDENCE_FROM_API[str(v)] ?? d;

/* ----------------------------------------------------------------- Projekte */

const LOCAL_PROJECTS = "aec.localProjects";

function localProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_PROJECTS) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw.filter(isObj) as Project[]) : [];
  } catch {
    return [];
  }
}

function fromPilot(p: Record<string, unknown>): Project {
  return {
    id: str(p.id),
    name: str(p.name, "Projekt"),
    airport: str(p.scope, "Flughafen"),
    site: str(p.scope, ""),
    dayLabel: "Lagebild aus dem neuesten gekoppelten Lauf",
    fleetSize: 0,
    gridLimitKw: 3500,
    decision: str(p.decision),
    source: "api",
  };
}

export async function listProjects(): Promise<Project[]> {
  let remote: Project[] = [];
  try {
    const data = await call<unknown>("/pilot/projects");
    if (Array.isArray(data))
      remote = data
        .filter((p) => isObj(p) && typeof p.id === "string")
        .map((p) => fromPilot(p as Record<string, unknown>));
  } catch {
    /* ohne Backend: nur Beispiel und lokale Entwuerfe */
  }
  return [SAMPLE_PROJECT, ...remote, ...localProjects()];
}

export async function getProject(id: string): Promise<Project> {
  if (id === SAMPLE_PROJECT.id) return SAMPLE_PROJECT;
  const local = localProjects().find((p) => p.id === id);
  if (local) return local;
  try {
    const data = await call<unknown>(`/pilot/projects/${encodeURIComponent(id)}`);
    if (isObj(data) && typeof data.id === "string") return fromPilot(data);
  } catch {
    /* faellt unten auf das Beispiel zurueck */
  }
  return { ...SAMPLE_PROJECT, id, name: SAMPLE_PROJECT.name };
}

export type NewProject = {
  name: string;
  airport: string;
  decision: string;
  gridLimitKw: number;
  fleetSize: number;
};

export async function createProject(input: NewProject): Promise<Project> {
  try {
    const data = await call<unknown>("/pilot/projects", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        decision: input.decision,
        scope: input.airport,
        acceptance_note: `Anschlussgrenze ${input.gridLimitKw} kW, Flotte ${input.fleetSize} Fahrzeuge (Annahmen).`,
      }),
    });
    if (isObj(data) && typeof data.id === "string")
      return { ...fromPilot(data), gridLimitKw: input.gridLimitKw, fleetSize: input.fleetSize };
  } catch {
    /* lokal anlegen */
  }
  const project: Project = {
    id: `lokal-${Date.now().toString(36)}`,
    name: input.name,
    airport: input.airport,
    site: input.airport,
    dayLabel: "Entwurf ohne Backend",
    fleetSize: input.fleetSize,
    gridLimitKw: input.gridLimitKw,
    decision: input.decision,
    source: "beispiel",
  };
  try {
    localStorage.setItem(LOCAL_PROJECTS, JSON.stringify([...localProjects(), project]));
  } catch {
    /* nur in dieser Sitzung */
  }
  return project;
}

/* ---------------------------------------------------------------- Lagebild */

/**
 * Minute nach Ortszeit des Flughafens (Europe/Berlin), gezaehlt ab dem Ortstag des
 * Lagebilds. Die API liefert UTC; Kaeufer lesen Flugwellen in Ortszeit.
 */
const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const localMinute = (t: number) => {
  const parts = Object.fromEntries(berlin.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
};
const minuteOf = (iso: string, dayStart: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localMinute(dayStart) + Math.round((t - dayStart) / 60000) : -1;
};
const inDay = (p: { minute: number }) => p.minute >= 0 && p.minute < 1440;

export function situationFromApi(project: Project, data: unknown): Situation | null {
  if (!isObj(data) || data.available !== true || !Array.isArray(data.series) || !data.series.length)
    return null;
  const series = data.series.filter(isObj);
  const dayStart = Date.parse(str(data.day_start_utc, str(series[0]!.start_utc)));
  if (!Number.isFinite(dayStart)) return null;
  const step = num(data.interval_min, 15);
  const limit =
    series.reduce((m, p) => Math.max(m, num(p.grid_limit_kw)), 0) || project.gridLimitKw;
  const answer = isObj(data.answer) ? data.answer : {};
  const shares = isObj(answer.cause_shares_pct) ? answer.cause_shares_pct : {};
  const windows = Array.isArray(data.bottleneck_windows)
    ? data.bottleneck_windows.filter(isObj).map((w) => ({
        start: minuteOf(str(w.start_utc), dayStart),
        end: minuteOf(str(w.end_utc), dayStart),
        peakKw: num(w.peak_kw),
        deficitKw: 0,
      }))
    : [];
  return {
    projectId: project.id,
    source: "api",
    evidence: evidence(data.evidence_level, "model_checked"),
    kind: "bezug",
    gridLimitKw: limit,
    stepMinutes: step,
    load: series
      .map((p) => ({
        minute: minuteOf(str(p.start_utc), dayStart),
        demandKw: num(p.grid_import_kw),
        baseKw: Math.max(0, num(p.grid_import_kw) - num(p.charging_kw)),
        pvKw: num(p.pv_kw),
      }))
      .filter(inDay),
    departures: Array.isArray(data.departures)
      ? data.departures
          .filter(isObj)
          .map((d) => ({ minute: minuteOf(str(d.start_utc), dayStart), count: num(d.count) }))
          .filter(inDay)
      : [],
    windows,
    delayedDepartures: num(answer.delayed_departures),
    vehicleShare: num(shares.resource) / 100,
    fleet: fleetFromApi(data.fleet),
  };
}

export function fleetFromApi(raw: unknown): Fleet | undefined {
  if (!isObj(raw)) return undefined;
  return {
    total: typeof raw.total_vehicles === "number" ? raw.total_vehicles : null,
    byKind: Array.isArray(raw.by_kind)
      ? raw.by_kind.filter(isObj).map((k) => ({
          kind: str(k.kind) as FleetKind,
          label: str(k.label, str(k.kind)),
          vehicles: num(k.vehicles),
          chargers: num(k.chargers),
        }))
      : [],
    source: typeof raw.source === "string" ? raw.source : null,
  };
}

export async function getSituation(project: Project): Promise<Situation> {
  if (project.source === "api") {
    try {
      const s = situationFromApi(
        project,
        await call<unknown>(`/projects/${encodeURIComponent(project.id)}/situation`),
      );
      if (s) return s;
    } catch {
      /* Beispieldaten */
    }
  }
  return sampleSituation(project);
}

/* ---------------------------------------------------------------- Varianten */

function variantKind(changes: VariantChanges, key: string): Variant["kind"] {
  if (key === "base") return "basis";
  const kinds: Variant["kind"][] = [];
  if (changes.storage_kwh) kinds.push("speicher");
  if (changes.extra_vehicles && Object.keys(changes.extra_vehicles).length) kinds.push("fahrzeuge");
  if (changes.charging_policy) kinds.push("laderegel");
  if (changes.grid_import_limit_kw !== undefined) kinds.push("anschluss");
  if (changes.pv_factor !== undefined) kinds.push("pv");
  if (changes.chargers_offline && Object.keys(changes.chargers_offline).length)
    kinds.push("ausfall");
  return kinds.length === 1 ? kinds[0]! : "mix";
}

/** Beispiel-Tafel: nur ohne Projekt-API oder ohne gerechneten Lauf, klar markiert. */
export function sampleBoard(): VariantBoard {
  return {
    source: "beispiel",
    base: null,
    definitions: [],
    run: null,
    variants: sampleVariants(),
    answer: null,
  };
}

export function boardFromApi(data: unknown): VariantBoard | null {
  if (!isObj(data) || !Array.isArray(data.variants)) return null;
  const baseRaw = isObj(data.base) ? data.base : null;
  const definitions = data.variants.filter(isObj).map((v) => ({
    id: str(v.id),
    name: str(v.name),
    changes: (isObj(v.changes) ? v.changes : {}) as VariantChanges,
  }));
  const runRaw = isObj(data.latest_run) ? data.latest_run : null;
  const progress = runRaw && isObj(runRaw.progress) ? runRaw.progress : {};
  const entries = runRaw && Array.isArray(runRaw.entries) ? runRaw.entries.filter(isObj) : [];
  const variants: Variant[] = entries
    .filter((e) => isObj(e.kpis))
    .map((e) => {
      const k = e.kpis as Record<string, unknown>;
      const d = isObj(e.delta_to_base) ? e.delta_to_base : {};
      const shares = isObj(k.cause_shares_pct) ? k.cause_shares_pct : {};
      const stress = isObj(e.stress) && isObj(e.stress.kpis) ? e.stress.kpis : null;
      const fleet = fleetFromApi(e.fleet);
      return {
        id: str(e.key),
        name: str(e.name),
        kind: variantKind((isObj(e.changes) ? e.changes : {}) as VariantChanges, str(e.key)),
        onTimePct: Math.round(num(k.on_time_pct) * 10) / 10,
        minutesAtLimit: num(k.minutes_at_limit),
        gridEnergyMwh: num(k.grid_energy_mwh_day),
        peakKw: num(k.peak_kw),
        evidence: evidence(e.evidence_level, "synthetic"),
        source: "api" as const,
        delayedDepartures: num(k.delayed_departures),
        departuresTotal: num(k.departures_total),
        missingKw: typeof k.missing_kw_peak === "number" ? k.missing_kw_peak : null,
        backgroundUnservedKwh: num(k.background_unserved_kwh),
        bottleneck: typeof k.bottleneck === "string" ? k.bottleneck : null,
        energyShare: num(shares.energy) / 100,
        fleetTotal: fleet?.total ?? null,
        deltaOnTimePct: typeof d.on_time_pct === "number" ? d.on_time_pct : null,
        deltaMinutes: typeof d.minutes_at_limit === "number" ? d.minutes_at_limit : null,
        stressOnTimePct:
          stress && typeof stress.on_time_pct === "number" ? stress.on_time_pct : null,
        status: str(e.status),
      };
    });
  const answerRaw = runRaw && isObj(runRaw.answer) ? runRaw.answer : null;
  const status = str(runRaw?.status, "queued");
  return {
    source: "api",
    base: baseRaw
      ? {
          source: str(baseRaw.source),
          policy: str(baseRaw.policy),
          gridLimitKw: num(baseRaw.grid_import_limit_kw),
          storageKwh: num(baseRaw.storage_kwh),
          fleet: fleetFromApi(baseRaw.fleet) ?? { total: null, byKind: [], source: null },
        }
      : null,
    definitions,
    run: runRaw
      ? {
          status: (["queued", "running", "completed", "partial"].includes(status)
            ? status
            : "queued") as NonNullable<VariantBoard["run"]>["status"],
          done: num(progress.done),
          total: num(progress.total),
          stress: runRaw.stress === true,
          stale: runRaw.stale === true,
          inputsStale: runRaw.inputs_stale === true,
          createdAt: str(runRaw.created_at),
        }
      : null,
    variants,
    answer:
      answerRaw && typeof answerRaw.headline === "string"
        ? {
            status: str(answerRaw.status),
            headline: answerRaw.headline,
            details: Array.isArray(answerRaw.details)
              ? answerRaw.details.filter((x): x is string => typeof x === "string")
              : [],
            bestId:
              typeof answerRaw.best_variant_id === "string" ? answerRaw.best_variant_id : null,
          }
        : null,
  };
}

export async function getVariantBoard(project: Project): Promise<VariantBoard> {
  if (project.source === "api") {
    try {
      const board = boardFromApi(
        await call<unknown>(`/projects/${encodeURIComponent(project.id)}/variants`),
      );
      if (board) return board;
    } catch {
      /* Beispiel */
    }
  }
  return sampleBoard();
}

export async function createVariant(
  project: Project,
  name: string,
  changes: VariantChanges,
): Promise<void> {
  await call<unknown>(`/projects/${encodeURIComponent(project.id)}/variants`, {
    method: "POST",
    body: JSON.stringify({ name, changes }),
  });
}

export async function deleteVariant(project: Project, id: string): Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/v1/projects/${encodeURIComponent(project.id)}/variants/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { "X-Exchange-Role": storedRole() } },
  );
  if (!response.ok) throw new Error(explain(`API-Fehler ${response.status}`));
}

export async function runVariants(
  project: Project,
  stress: boolean,
  baseOnly = false,
): Promise<VariantBoard> {
  const data = await call<unknown>(
    `/projects/${encodeURIComponent(project.id)}/variants/run`,
    { method: "POST", body: JSON.stringify(baseOnly ? { stress, base_only: true } : { stress }) },
    30000,
  );
  return boardFromApi(data) ?? sampleBoard();
}

/* --------------------------------------------------------------- Uebersicht */

export type Overview = {
  source: "api" | "beispiel";
  locked: boolean;
  sha256: string | null;
  elements: {
    kind: string;
    refId: string;
    title: string;
    status: string;
    evidence: EvidenceLevel;
  }[];
  summary: Partial<Record<EvidenceLevel, number>>;
  fleet?: Fleet;
};

export async function getOverview(project: Project): Promise<Overview> {
  if (project.source === "api") {
    try {
      const d = await call<unknown>(`/projects/${encodeURIComponent(project.id)}/overview`);
      if (isObj(d) && Array.isArray(d.elements)) {
        const acc = isObj(d.acceptance) ? d.acceptance : {};
        const summary: Overview["summary"] = {};
        if (isObj(d.evidence_summary))
          for (const [k, v] of Object.entries(d.evidence_summary)) {
            const lvl = EVIDENCE_FROM_API[k];
            if (lvl) summary[lvl] = num(v);
          }
        return {
          source: "api",
          locked: acc.locked === true,
          sha256: typeof acc.sha256 === "string" ? acc.sha256 : null,
          elements: d.elements.filter(isObj).map((e) => ({
            kind: str(e.kind),
            refId: str(e.ref_id),
            title: str(e.title, str(e.kind)),
            status: str(e.status),
            evidence: evidence(e.evidence_level),
          })),
          summary,
          fleet: fleetFromApi(d.fleet),
        };
      }
    } catch {
      /* Beispiel */
    }
  }
  return {
    source: "beispiel",
    locked: false,
    sha256: null,
    elements: [],
    summary: { assumption: 3, synthetic: 2, model_checked: 2, empirical_open: 2 },
  };
}

/* ---------------------------------------------------------------- Austausch */

const STATUS_FROM_API: Record<string, ExchangeStatus> = {
  proposed: "vorgeschlagen",
  accepted: "angenommen",
  scheduled: "geplant",
  done: "erledigt",
  rejected: "abgelehnt",
  frozen: "uebergeben",
};
export const STATUS_TO_API: Partial<Record<ExchangeStatus, string>> = {
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
      const data = await call<unknown>(`/projects/${encodeURIComponent(project.id)}/exchange`);
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
      `/projects/${encodeURIComponent(project.id)}/exchange/${encodeURIComponent(item.id)}/transition`,
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
    const raw = await call<unknown>(`/projects/${encodeURIComponent(project.id)}/exchange`, {
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
    await call<unknown>(`/library/scenarios/${encodeURIComponent(scenarioId)}/adopt`, {
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
