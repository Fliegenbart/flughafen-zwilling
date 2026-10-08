/**
 * Datenquellen eines Projekts laden und importieren (Schritt "Daten").
 * Nutzt ausschliesslich bestehende Endpunkte: Flugplan (`/munich/flight-plans`),
 * Verknuepfungen (`/projects/{id}/links`), Projektwerte (`/projects/{id}/assets`),
 * Pilot-Messdaten (`/pilot/projects/{id}/imports`) und FlexLab (`/lab/imports`).
 */
import {
  EMPTY_INPUTS,
  importError,
  type AssetEntry,
  type AssetField,
  type Assets,
  type DataInputs,
  type DataState,
  type LabRun,
  type LinkedPlan,
  type MeasurementImport,
} from "../model/dataStatus";
import type { FlightPlanInfo, FlightPlanSnapshot } from "../../munich/flightplanTypes";
import type { Project } from "../types";
import { optional as optionalRequest, request } from "./http";
import { enc, isObj, num, str } from "./parse";

/** Datenimporte: laengere Zeitgrenze, Fehler in Import-Sprache. */
const DATA = { timeoutMs: 20000, translate: importError };
const send = <T>(path: string, init?: RequestInit) => request<T>(path, init, DATA);
const optional = <T>(path: string) => optionalRequest<T>(path, DATA);

/* ------------------------------------------------------------------ Mapper */

export function assetsFromApi(raw: unknown): Assets | null {
  if (!isObj(raw) || !Array.isArray(raw.entries)) return null;
  const version = isObj(raw.version) ? raw.version : null;
  return {
    status: (["echt", "annahme", "fehlt"].includes(str(raw.status))
      ? raw.status
      : "fehlt") as DataState,
    entries: raw.entries.filter(isObj).map(
      (e): AssetEntry => ({
        key: str(e.key),
        label: str(e.label, str(e.key)),
        group: str(e.group) === "flotte" ? "flotte" : "anlagen",
        value: num(e.value),
        unit: str(e.unit),
        originalValue: num(e.original_value, num(e.value)),
        originalUnit: str(e.original_unit, str(e.unit)),
        source: str(e.source),
        sourceDate: typeof e.source_date === "string" ? e.source_date : null,
        status: str(e.status) === "echt" ? "echt" : "annahme",
      }),
    ),
    fields: Array.isArray(raw.fields)
      ? raw.fields.filter(isObj).map(
          (f): AssetField => ({
            key: str(f.key),
            label: str(f.label),
            group: str(f.group) === "flotte" ? "flotte" : "anlagen",
            unit: str(f.unit),
            min: num(f.min),
            max: num(f.max),
            integer: f.integer === true,
            default: typeof f.default === "number" ? f.default : null,
          }),
        )
      : [],
    version: version
      ? {
          createdAt: str(version.created_at),
          filename: typeof version.filename === "string" ? version.filename : null,
          sourceKind: str(version.source_kind),
          sha256: str(version.sha256),
        }
      : null,
  };
}

export function importFromApi(raw: unknown): MeasurementImport | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null;
  const q = isObj(raw.quality) ? raw.quality : {};
  const role = str(raw.role);
  return {
    id: raw.id,
    role: role === "holdout" ? "holdout" : role === "lab" ? "lab" : "calibration",
    filename: str(raw.filename),
    sourceNote: str(raw.source_note),
    createdAt: str(raw.created_at),
    valid: q.state === "valid",
    issues: Array.isArray(q.issues)
      ? q.issues.filter((x): x is string => typeof x === "string")
      : [],
    rows: num(q.rows),
    first: typeof q.first_timestamp === "string" ? q.first_timestamp : null,
    last: typeof q.last_timestamp === "string" ? q.last_timestamp : null,
  };
}

function labRunFromApi(raw: unknown): LabRun | null {
  if (!isObj(raw) || typeof raw.run_id !== "string") return null;
  const analysis = isObj(raw.analysis) ? raw.analysis : null;
  const quality = analysis && isObj(analysis.quality) ? analysis.quality : {};
  const verdict = analysis ? str(analysis.verdict) : "";
  return {
    id: raw.run_id,
    source: str(raw.source) === "csv_import" ? "csv_import" : "simulation",
    state: (["queued", "running", "completed", "failed", "cancelled"].includes(str(raw.state))
      ? raw.state
      : "queued") as LabRun["state"],
    filename: typeof raw.filename === "string" ? raw.filename : null,
    createdTs: str(raw.created_ts),
    verdict: (["pass", "fail", "inconclusive"].includes(verdict) ? verdict : null) as
      | LabRun["verdict"]
      | null,
    qualityReasons: Array.isArray(quality.reasons)
      ? quality.reasons.filter((x): x is string => typeof x === "string")
      : [],
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

/* ------------------------------------------------------------------- Laden */

export async function loadDataInputs(project: Project): Promise<DataInputs> {
  if (project.source !== "api") return EMPTY_INPUTS;
  const id = enc(project.id);
  const [links, plans, assets, imports, tolerances, assessments] = await Promise.all([
    optional<unknown[]>(`/projects/${id}/links`),
    optional<unknown[]>("/munich/flight-plans"),
    optional<unknown>(`/projects/${id}/assets`),
    optional<unknown[]>(`/pilot/projects/${id}/imports`),
    optional<unknown>(`/pilot/projects/${id}/tolerances`),
    optional<unknown[]>(`/pilot/projects/${id}/assessments`),
  ]);
  const linkList = (Array.isArray(links) ? links : []).filter(isObj);
  const planIds = new Set(
    linkList.filter((l) => l.kind === "flight_plan_snapshot").map((l) => str(l.ref_id)),
  );
  const labIds = linkList.filter((l) => l.kind === "flexlab_run").map((l) => str(l.ref_id));
  const labRuns = (
    await Promise.all(labIds.map((rid) => optional<unknown>(`/lab/runs/${enc(rid)}`)))
  )
    .map(labRunFromApi)
    .filter((r): r is LabRun => r !== null);
  return {
    available: true,
    plans: (Array.isArray(plans) ? plans : [])
      .filter(isObj)
      .filter((p) => planIds.has(str(p.snapshot_id)))
      .map(
        (p): LinkedPlan => ({
          snapshotId: str(p.snapshot_id),
          serviceDate: str(p.service_date),
          sourceDataDate: str(p.source_data_date),
          importedAt: str(p.imported_at),
          sharedGroups: num(p.possible_shared_flight_groups),
          departures: num(p.departure_entry_count),
          arrivals: num(p.arrival_entry_count),
        }),
      ),
    assets: assetsFromApi(assets),
    imports: (Array.isArray(imports) ? imports : [])
      .map(importFromApi)
      .filter((x): x is MeasurementImport => x !== null),
    tolerances: isObj(tolerances)
      ? { locked: tolerances.locked === true, sha256: str(tolerances.sha256) || null }
      : null,
    holdoutPass: (Array.isArray(assessments) ? assessments : [])
      .filter(isObj)
      .some((a) => a.validity_status === "PASS" && a.evaluation_kind === "holdout_validation"),
    labRuns,
  };
}

/* ---------------------------------------------------------------- Aktionen */

/** Flugplan-Snapshot ans Projekt haengen (idempotent: bestehende Verknuepfung ist ok). */
export async function linkFlightPlan(project: Project, snapshotId: string): Promise<void> {
  try {
    await send(`/projects/${enc(project.id)}/links`, {
      method: "POST",
      body: JSON.stringify({
        kind: "flight_plan_snapshot",
        ref_id: snapshotId,
        note: "Im Schritt Daten importiert",
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("bereits")) return;
    throw e;
  }
}

export type AssetInput = {
  key: string;
  value: number;
  unit: string;
  source: string;
  source_date: string | null;
};

export async function saveAssets(project: Project, entries: AssetInput[]): Promise<Assets> {
  const raw = await send<unknown>(`/projects/${enc(project.id)}/assets`, {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
  const parsed = assetsFromApi(raw);
  if (!parsed) throw new Error("Unerwartete Antwort des Servers.");
  return parsed;
}

export async function importAssets(project: Project, file: File): Promise<Assets> {
  const json = /\.json$/i.test(file.name);
  const raw = await send<unknown>(
    `/projects/${enc(project.id)}/assets/import?filename=${enc(file.name)}`,
    {
      method: "POST",
      body: await file.text(),
      headers: { "Content-Type": json ? "application/json" : "text/csv" },
    },
  );
  const parsed = assetsFromApi(raw);
  if (!parsed) throw new Error("Unerwartete Antwort des Servers.");
  return parsed;
}

export type MeasurementInput = {
  file: File;
  role: "calibration" | "holdout";
  measurementBoundary: string;
  sourceNote: string;
  sampleSemantics: "point_samples" | "interval_end_mean";
};

/**
 * Lastgang ueber die Pilot-Import-API. Auch abgewiesene Importe bleiben dort als
 * nicht auswertbare Nachweise erhalten; hier kommen sie mit deutschen Gruenden zurueck.
 */
export async function importMeasurement(
  project: Project,
  input: MeasurementInput,
): Promise<MeasurementImport> {
  try {
    const raw = await send<unknown>(`/pilot/projects/${enc(project.id)}/imports`, {
      method: "POST",
      body: JSON.stringify({
        filename: input.file.name,
        csv_text: await input.file.text(),
        role: input.role,
        measurement_boundary: input.measurementBoundary,
        source_note: input.sourceNote,
        sample_semantics: input.sampleSemantics,
      }),
    });
    const parsed = importFromApi(raw);
    if (!parsed) throw new Error("Unerwartete Antwort des Servers.");
    return parsed;
  } catch (e) {
    const body = (e as { body?: unknown }).body;
    const rejected = importFromApi(body);
    if (rejected) return rejected; // 422 mit gespeichertem, ungueltigem Import
    throw e;
  }
}

/** FlexLab-CSV importieren und als `flexlab_run` mit dem Projekt verknuepfen. */
export async function importLab(
  project: Project,
  file: File,
  label: string,
  caseId = "setpoint-step",
): Promise<LabRun> {
  const raw = await send<unknown>("/lab/imports", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      csv_text: await file.text(),
      label: label.slice(0, 120),
      case_id: caseId,
    }),
  });
  const run = labRunFromApi(raw);
  if (!run) throw new Error("Unerwartete Antwort des Servers.");
  await send(`/projects/${enc(project.id)}/links`, {
    method: "POST",
    body: JSON.stringify({
      kind: "flexlab_run",
      ref_id: run.id,
      note: "Im Schritt Daten importiert",
    }),
  });
  return run;
}

/* --------------------------------------------------------------- Flugplaene */

/** Schon eingelesene Saisonflugplaene (fuer die Auswahl). */
export function listFlightPlans(): Promise<FlightPlanInfo[]> {
  return send<FlightPlanInfo[]>("/munich/flight-plans");
}

/** Saisonflugplan-PDF einlesen; Fehlertexte uebersetzt die Seite (flightPlanError). */
export function importFlightPlan(date: string, file: File): Promise<FlightPlanSnapshot> {
  return request<FlightPlanSnapshot>(
    `/munich/flight-plans?service_date=${enc(date)}`,
    { method: "POST", body: file, headers: { "Content-Type": "application/pdf" } },
    { timeoutMs: 45000, translate: (detail) => detail },
  );
}
