/** Server-Attrappe fuer Startseite und Fachleute: vorab gerechnete Tabelle und Vergleich. */
import { vi } from "vitest";
import reference from "../../model/__fixtures__/livePowerReference.json";

export const AXES = {
  electric_share_pct: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  storage_kwh: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000],
  pv_kwp: [0, 500, 1000, 2000, 4000],
  parking_sessions: [0, 40, 100, 200],
};
// Erster Wert: direkt, am Anschluss begrenzt (nur Fachansicht). Die Kundenseite nimmt PEAKS.
export const ENTRIES: Record<string, [number | null, number | null, number | null]> = {
  "50|2000|500|40": [875, 800, 675],
  "50|0|500|40": [875, 800, 800],
  "50|2000|2000|40": [875, 775, 600],
  "100|2000|500|40": [1400, 1225, 1150],
  "50|2000|500|200": [1300, 1300, 1400],
};
export const PEAKS: Record<string, number | null> = {
  "50|500|40": 1625,
  "50|2000|40": 1575,
  "100|500|40": 1850,
  "50|500|200": 2475,
};

const FLEETS = [
  {
    kind: "bus",
    vehicles: 20,
    chargers: 8,
    charger_kw: 80,
    battery_capacity_kwh: 300,
    mission_energy_kwh: 8,
    initial_soc_pct: 85,
  },
  {
    kind: "baggage_tractor",
    vehicles: 35,
    chargers: 12,
    charger_kw: 22,
    battery_capacity_kwh: 50,
    mission_energy_kwh: 7.7,
    initial_soc_pct: 85,
  },
  {
    kind: "pushback_tug",
    vehicles: 10,
    chargers: 4,
    charger_kw: 80,
    battery_capacity_kwh: 72,
    mission_energy_kwh: 15.6,
    initial_soc_pct: 85,
  },
  {
    kind: "gpu",
    vehicles: 35,
    chargers: 14,
    charger_kw: 50,
    battery_capacity_kwh: 160,
    mission_energy_kwh: 50.6,
    initial_soc_pct: 85,
  },
];

export function comparison(body: Record<string, number>, feasible = true) {
  return {
    comparison_id: "c1",
    inputs: body,
    comparison_contract: {
      total_vehicles: 100,
      electric_vehicles: body.electric_share_pct,
      non_electric_vehicles: 100 - body.electric_share_pct!,
      mission_count: 500,
      fleet: FLEETS.map((f) => ({
        kind: f.kind,
        total: f.vehicles,
        electric: Math.round((f.vehicles * body.electric_share_pct!) / 100),
        non_electric: f.vehicles - Math.round((f.vehicles * body.electric_share_pct!) / 100),
        chargers: f.chargers,
      })),
    },
    limitations: ["Synthetischer Vorfeldbereich."],
    reference: { days: 3, resource_baseline_feasible: true, grid_step_kw: 25 },
    sources: [{ title: "He et al. (2026)", url: "https://doi.org/10.1038/x" }],
    compute_ms: 100,
    uncontrolled: {
      grid_sizing: { status: "feasible", required_grid_kw: 1625, peak_kw: 1613.6 },
      basis: { ...reference.basis, departures: reference.departures },
    },
    variants: ["direct", "managed", "managed_storage"].map((solution) => ({
      ...reference.basis,
      departures: reference.departures,
      kpis: reference.kpis,
      solution,
      calculation_id: solution,
      input_hash: solution,
      metadata: {
        config: {
          fleets: FLEETS,
          power: {
            background_load_kw: 250,
            pv_capacity_kwp: body.pv_kwp,
            pv_peak_factor: 0.2,
            parking_sessions: body.parking_sessions,
            parking_charger_kw: 11,
            battery_initial_soc_pct: 50,
          },
        },
      },
      grid_sizing: { status: "feasible", required_grid_kw: 800, step_kw: 25, max_kw: 8000 },
      checks: feasible
        ? { feasible: true, reasons: [] }
        : { feasible: false, reasons: ["service_deadlines"] },
      metrics: {
        ready_departures: 540,
        departures_total: 540,
        energy_wait_min: 0,
        restricted_charging_min: 0,
        peak_grid_kw: 1500,
        apron_charged_kwh: 500,
        background_unserved_kwh: 0,
        parking_unmet_kwh: 0,
        horizon_hours: 72,
      },
    })),
  };
}

export const bodies: Record<string, number>[] = [];
export function serve({
  atlas = true,
  feasible = true,
  failCompare = () => false,
}: { atlas?: boolean; feasible?: boolean; failCompare?: () => boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/demo/electrification/atlas"))
        return new Response(
          JSON.stringify(
            atlas
              ? { available: true, axes: AXES, entries: ENTRIES, peaks: PEAKS, grid_max_kw: 8000 }
              : { available: false },
          ),
        );
      if (url.endsWith("/demo/electrification")) {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (failCompare())
          return new Response(
            JSON.stringify({ detail: "Demo ausgelastet. Vergleich erneut versuchen." }),
            { status: 429 },
          );
        return new Response(JSON.stringify(comparison(body, feasible)));
      }
      return new Response("{}", { status: 404 });
    }),
  );
}
