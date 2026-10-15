/** Genaue Vorschau eines Tages fuer eine Regler-Stellung (POST /situation/preview). */
import { distributeFleet } from "../model/dataStatus";
import type { LiveBasis, Levers } from "../model/livePower";
import type { Project } from "../types";
import { request } from "./http";
import { SAMPLE_PROJECT } from "../sample";
import { enc, isObj, num } from "./parse";

export type DepartureBin = { startMin: number; count: number; delayed: number };
export const CHARGING_POLICIES = ["uncontrolled", "mission_priority", "lookahead"] as const;
export type ChargingPolicy = (typeof CHARGING_POLICIES)[number];

export const isChargingPolicy = (value: unknown): value is ChargingPolicy =>
  typeof value === "string" && (CHARGING_POLICIES as readonly string[]).includes(value);

const CHARGING_POLICY_LABELS: Record<ChargingPolicy, string> = {
  uncontrolled: "Direkt laden",
  mission_priority: "Fristenpriorität",
  lookahead: "Vorausschauend",
};

export const chargingPolicyLabel = (policy: ChargingPolicy | undefined) =>
  policy ? CHARGING_POLICY_LABELS[policy] : "Unbekannte Laderegel";

export const PLANNING_METHODS = [
  "known_duty_energy_envelope_v1",
  "immediate_grid_limited_v1",
] as const;
export type PlanningMethod = (typeof PLANNING_METHODS)[number];

export const isPlanningMethod = (value: unknown): value is PlanningMethod =>
  typeof value === "string" && (PLANNING_METHODS as readonly string[]).includes(value);

/** Rohmetadaten bleiben für Export und Nachweis erhalten; camelCase ist nur eine Lesehilfe. */
export type PlanningMetadata = Record<string, unknown> & {
  method?: PlanningMethod;
  perfect_foresight?: boolean;
  optimality_guaranteed?: boolean;
  fixed_vehicle_assignments?: boolean;
  duty_roster_hash?: string;
  horizon_minutes?: number;
  end_soc_enforced_by_replay?: boolean;
  perfectForesight?: boolean;
  optimalityGuaranteed?: boolean;
  fixedVehicleAssignments?: boolean;
};

export type PreviewMetadata = Record<string, unknown> & {
  policy?: ChargingPolicy;
  planning?: PlanningMetadata;
};

export type Preview = {
  calculationId?: string;
  inputHash?: string;
  engineVersion?: string;
  metadata?: PreviewMetadata;
  basis: LiveBasis;
  departures: DepartureBin[];
  delayedDepartures: number | null;
  departuresTotal: number | null;
  /** Anteil der Wartezeit, die am Strom lag (Rest: kein freies Fahrzeug). */
  energyWaitSharePct: number | null;
  computeMs: number | null;
};

const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(x)) : []);

function metadataFromApi(value: unknown): PreviewMetadata | undefined {
  if (!isObj(value)) return undefined;
  const planningRaw = isObj(value.planning) ? value.planning : null;
  const planning: PlanningMetadata | undefined = planningRaw
    ? {
        ...planningRaw,
        ...(isPlanningMethod(planningRaw.method) ? { method: planningRaw.method } : {}),
        ...(typeof planningRaw.perfect_foresight === "boolean"
          ? { perfectForesight: planningRaw.perfect_foresight }
          : {}),
        ...(typeof planningRaw.optimality_guaranteed === "boolean"
          ? { optimalityGuaranteed: planningRaw.optimality_guaranteed }
          : {}),
        ...(typeof planningRaw.fixed_vehicle_assignments === "boolean"
          ? { fixedVehicleAssignments: planningRaw.fixed_vehicle_assignments }
          : {}),
      }
    : undefined;
  return {
    ...value,
    policy: isChargingPolicy(value.policy) ? value.policy : undefined,
    planning,
  };
}

/** Antwort der Vorschau (oder der Beispiel-Referenz) in die Browser-Form bringen. */
export function previewFromApi(raw: unknown, departuresRaw?: unknown): Preview | null {
  if (!isObj(raw) || !Array.isArray(raw.requested_kw) || !isObj(raw.power)) return null;
  const p = raw.power;
  const kpis = isObj(raw.kpis) ? raw.kpis : {};
  const deps = Array.isArray(raw.departures)
    ? raw.departures
    : Array.isArray(departuresRaw)
      ? departuresRaw
      : [];
  return {
    calculationId: typeof raw.calculation_id === "string" ? raw.calculation_id : undefined,
    inputHash: typeof raw.input_hash === "string" ? raw.input_hash : undefined,
    engineVersion: typeof raw.engine_version === "string" ? raw.engine_version : undefined,
    metadata: metadataFromApi(raw.metadata),
    basis: {
      dayMinutes: num(raw.day_minutes, 1440),
      startMin: num(raw.start_min),
      requestedKw: nums(raw.requested_kw),
      deliveredKw: nums(raw.delivered_kw),
      backgroundKw: nums(raw.background_kw),
      pvKw: nums(raw.pv_kw),
      chpKw: nums(raw.chp_kw),
      gridCapKw: nums(raw.grid_cap_kw),
      gridImportKw: nums(raw.grid_import_kw),
      batteryKw: nums(raw.battery_kw),
      power: {
        gridImportLimitKw: num(p.grid_import_limit_kw),
        pvCapacityKwp: num(p.pv_capacity_kwp),
        batteryCapacityKwh: num(p.battery_capacity_kwh),
        batteryPowerKw: num(p.battery_power_kw),
        batteryInitialSocPct: num(p.battery_initial_soc_pct, 50),
        batteryReservePct: num(p.battery_reserve_pct, 10),
        batteryEfficiency: num(p.battery_efficiency, 0.95),
        batteryGridChargeBelowKw:
          typeof p.battery_grid_charge_below_kw === "number"
            ? p.battery_grid_charge_below_kw
            : null,
        transformerEfficiency: num(p.transformer_efficiency, 0.98),
        chargingLimitKw: num(p.charging_limit_kw, 1e9),
      },
    },
    departures: deps.filter(isObj).map((d) => ({
      startMin: num(d.start_min),
      count: num(d.count),
      delayed: num(d.delayed),
    })),
    delayedDepartures: typeof kpis.delayed_departures === "number" ? kpis.delayed_departures : null,
    departuresTotal: typeof kpis.departures_total === "number" ? kpis.departures_total : null,
    energyWaitSharePct:
      typeof kpis.energy_wait_share_pct === "number" ? kpis.energy_wait_share_pct : null,
    computeMs: typeof raw.compute_ms === "number" ? raw.compute_ms : null,
  };
}

/** Regler-Stellung als Aenderung gegenueber heute (nur was sich unterscheidet). */
export function changesFor(levers: Levers, today: Levers): Record<string, number> {
  const out: Record<string, number> = {};
  if (Math.abs(levers.gridLimitKw - today.gridLimitKw) > 0.5)
    out.grid_import_limit_kw = Math.round(levers.gridLimitKw);
  if (levers.batteryKwh !== today.batteryKwh) {
    out.storage_kwh = Math.round(levers.batteryKwh);
    if (levers.batteryKwh > 0)
      out.storage_kw = Math.round(levers.batteryKw ?? levers.batteryKwh / 2);
  }
  if (Math.abs(levers.pvFactor - 1) > 1e-3) out.pv_factor = Math.round(levers.pvFactor * 100) / 100;
  return out;
}

/** Zusaetzliche Fahrzeuge je Klasse, im Verhaeltnis der Standardflotte. */
export function extraVehiclesFor(levers: Levers): Record<string, number> | undefined {
  if (!levers.extraVehicles) return undefined;
  const parts = distributeFleet(levers.extraVehicles).filter((f) => f.vehicles > 0);
  return Object.fromEntries(parts.map((f) => [f.kind, f.vehicles]));
}

export async function getPreview(
  project: Project,
  changes: Record<string, number | Record<string, number>>,
  signal?: AbortSignal,
): Promise<Preview> {
  const raw = await request<unknown>(
    project.id === SAMPLE_PROJECT.id
      ? "/demo/simulation"
      : `/projects/${enc(project.id)}/situation/preview`,
    { method: "POST", body: JSON.stringify(changes), signal },
    { timeoutMs: 60000 },
  );
  const preview = previewFromApi(raw);
  if (!preview) throw new Error("Die Vorschau hat keine Kurve geliefert.");
  return preview;
}
