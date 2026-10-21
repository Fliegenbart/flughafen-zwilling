import { request } from "./http";
import { previewFromApi, type Preview } from "./preview";

export type Solution = "direct" | "managed" | "managed_storage";
export type ElectrificationInputs = {
  electric_share_pct: number;
  grid_import_limit_kw: number;
  storage_kwh: number;
  /** Photovoltaik in kWp; ohne Angabe die Annahme des Beispielflughafens (500 kWp). */
  pv_kwp?: number;
  /** Ladevorgaenge im Parkhaus am Tag; ohne Angabe 40. */
  parking_sessions?: number;
  /** Echter Flughafen (IATA); ohne Angabe der erfundene Beispielflughafen. */
  airport?: string | null;
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
/** Dieselbe Flotte ganz ohne Steuerung: nichts bremst, Bedarf = hoechste Netzlast. */
export type UncontrolledCharging = Preview & {
  grid_sizing: {
    status: "feasible" | "not_found";
    required_grid_kw: number | null;
    peak_kw: number;
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
  /** Fehlt bei aelteren Servern. */
  uncontrolled: UncontrolledCharging | null;
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
    !(raw.comparison_contract?.total_vehicles > 0) ||
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
  return { ...raw, variants, uncontrolled: uncontrolledFromApi(raw.uncontrolled) };
}

function uncontrolledFromApi(raw: unknown): UncontrolledCharging | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { basis, grid_sizing: sizing } = raw as { basis?: unknown; grid_sizing?: unknown };
  const preview = previewFromApi(basis);
  if (!preview || typeof sizing !== "object" || sizing === null) return null;
  const s = sizing as UncontrolledCharging["grid_sizing"];
  if (!Number.isFinite(s.peak_kw)) return null;
  return { ...preview, grid_sizing: s };
}

/** Vorab gerechneter Anschlussbedarf je Reglerstellung (backend/app/exchange/electrification_atlas.py). */
export type Atlas = {
  axes: {
    electric_share_pct: number[];
    storage_kwh: number[];
    pv_kwp: number[];
    parking_sessions: number[];
  };
  /** Schluessel "Anteil|Speicher|PV|Parkhaus": Bedarf in kW fuer direkt, vorausschauend, mit Speicher. */
  entries: Record<string, [number | null, number | null, number | null]>;
  /** Schluessel "Anteil|PV|Parkhaus": Bedarf in kW ganz ohne Steuerung. */
  peaks: Record<string, number | null>;
  gridMaxKw: number;
  /** Raster der Anschlusssuche: 25 kW beim Beispiel, bei grossen Flughaefen groeber. */
  gridStepKw: number;
};

export async function getAtlas(airport: string | null, signal?: AbortSignal): Promise<Atlas> {
  const raw = await request<{
    available: boolean;
    axes?: Atlas["axes"];
    entries?: Atlas["entries"];
    peaks?: Atlas["peaks"];
    grid_max_kw?: number;
    grid_step_kw?: number;
  }>(
    `/demo/electrification/atlas${airport ? `?airport=${encodeURIComponent(airport)}` : ""}`,
    { signal },
    { timeoutMs: 20000 },
  );
  if (!raw.available || !raw.axes || !raw.entries || !raw.peaks)
    throw new Error("Die vorab gerechneten Werte fehlen auf dem Server.");
  return {
    axes: raw.axes,
    entries: raw.entries,
    peaks: raw.peaks,
    gridMaxKw: raw.grid_max_kw ?? 8000,
    gridStepKw: raw.grid_step_kw ?? 25,
  };
}

/** Begruendung eines Steckbriefwerts: eigene Worte, oeffentliche Quellen, ggf. Annahme. */
export type Basis = { text: string; sources: string[]; assumption: boolean };

/** Steckbrief eines echten Flughafens (backend/app/exchange/airport_spec.py). */
export type AirportProfile = {
  id: string;
  name: string;
  full_name: string;
  as_of: string;
  departures_per_day: number;
  departures_basis: Basis;
  profile_basis: Basis;
  coverage_pct: Record<string, number>;
  coverage_basis: Basis;
  electric_share_now_pct: number | null;
  electric_share_basis: Basis;
  parking_sessions_per_day: number;
  parking_basis: Basis;
  reserve_kw_public: number | null;
  reserve_basis: Basis | null;
  facts: { label: string; value: string; source: string }[];
  fleet: { vehicles: Record<string, number>; chargers: Record<string, number>; basis: Basis };
};

export async function getAirports(signal?: AbortSignal): Promise<AirportProfile[]> {
  const raw = await request<AirportProfile[]>("/demo/airports", { signal }, { timeoutMs: 20000 });
  return Array.isArray(raw) ? raw.filter((a) => a && typeof a.id === "string" && a.fleet) : [];
}
