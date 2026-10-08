/** Loesungen (Varianten): laden, anlegen, loeschen, rechnen. */
import type { Project, Variant, VariantBoard, VariantChanges } from "../types";
import { fleetFromApi } from "./situation";
import { request as call } from "./http";
import { enc, evidence, isObj, num, str } from "./parse";

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
    variants: [],
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
          crisis:
            isObj(runRaw.crisis) && typeof runRaw.crisis.id === "string"
              ? {
                  id: runRaw.crisis.id,
                  name: str(runRaw.crisis.name),
                  assumption: str(runRaw.crisis.assumption),
                }
              : null,
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
      const board = boardFromApi(await call<unknown>(`/projects/${enc(project.id)}/variants`));
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
  await call<unknown>(`/projects/${enc(project.id)}/variants`, {
    method: "POST",
    body: JSON.stringify({ name, changes }),
  });
}

export async function deleteVariant(project: Project, id: string): Promise<void> {
  await call<unknown>(`/projects/${enc(project.id)}/variants/${enc(id)}`, { method: "DELETE" });
}

export async function runVariants(
  project: Project,
  stress: boolean,
  baseOnly = false,
  crisis: string | null = null,
): Promise<VariantBoard> {
  const body = { stress, ...(baseOnly ? { base_only: true } : {}), ...(crisis ? { crisis } : {}) };
  const data = await call<unknown>(
    `/projects/${enc(project.id)}/variants/run`,
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: 30000 },
  );
  return boardFromApi(data) ?? sampleBoard();
}
