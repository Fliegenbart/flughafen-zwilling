import { request } from "./http";
import { previewFromApi, type Preview } from "./preview";

export type Solution = "direct" | "managed" | "managed_storage";
export type ElectrificationInputs = {
  electric_share_pct: number;
  grid_import_limit_kw: number;
  storage_kwh: number;
};
export type ElectrificationVariant = Preview & {
  solution: Solution;
  checks: { feasible: boolean; reasons: string[] };
  grid_sizing: {
    status: "feasible" | "not_found" | "resource_infeasible";
    required_grid_kw: number | null;
    step_kw: number;
    max_kw: number;
  };
  metrics: {
    ready_departures: number;
    departures_total: number;
    energy_wait_min: number;
    restricted_charging_min: number;
    peak_grid_kw: number;
    apron_charged_kwh: number;
    background_unserved_kwh: number;
    parking_unmet_kwh: number;
    horizon_hours: number;
  };
};
export type ElectrificationComparison = {
  comparison_id: string;
  inputs: ElectrificationInputs;
  comparison_contract: {
    total_vehicles: number;
    electric_vehicles: number;
    non_electric_vehicles: number;
    initial_fleet_hash: string;
    missions_hash: string;
    duty_roster_hash?: string;
    mission_count: number;
    grid_import_limit_kw: number;
    fleet: {
      kind: string;
      total: number;
      electric: number;
      non_electric: number;
      chargers: number;
    }[];
  };
  variants: ElectrificationVariant[];
  limitations: string[];
  compute_ms: number;
  reference: { days: number; resource_baseline_feasible: boolean; grid_step_kw: number };
  sources: { title: string; url: string }[];
};

export async function compareElectrification(inputs: ElectrificationInputs, signal: AbortSignal) {
  const raw = await request<ElectrificationComparison>(
    "/demo/electrification",
    {
      method: "POST",
      body: JSON.stringify(inputs),
      signal,
    },
    { timeoutMs: 120000 },
  );
  if (
    !raw.comparison_id ||
    raw.comparison_contract?.total_vehicles !== 100 ||
    !Array.isArray(raw.variants) ||
    raw.variants.length !== 3 ||
    raw.reference?.days !== 3 ||
    !Array.isArray(raw.sources)
  ) {
    throw new Error("Der Server hat keinen vollständigen Vergleich geliefert.");
  }
  const variants = raw.variants.map((v, index) => {
    const preview = previewFromApi(v);
    if (
      !preview ||
      v.solution !== ["direct", "managed", "managed_storage"][index] ||
      !v.metrics ||
      typeof v.checks?.feasible !== "boolean" ||
      !Array.isArray(v.checks.reasons) ||
      !["feasible", "not_found", "resource_infeasible"].includes(v.grid_sizing?.status) ||
      (v.grid_sizing.status === "feasible" &&
        (!Number.isFinite(v.grid_sizing.required_grid_kw) ||
          v.grid_sizing.required_grid_kw === null)) ||
      !Object.values(v.metrics).every((value) => Number.isFinite(value))
    ) {
      throw new Error("Eine berechnete Variante ist unvollständig.");
    }
    return { ...v, ...preview };
  });
  return { ...raw, variants };
}
