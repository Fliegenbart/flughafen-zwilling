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
const basis = (text: string, assumption = false) => ({
  text,
  sources: assumption ? [] : ["https://example.org/quelle"],
  assumption,
});
/** Erfundener Testflughafen "TST" mit dem Aufbau eines echten Steckbriefs. */
export const TEST_AIRPORT = {
  id: "TST",
  name: "Teststadt",
  full_name: "Flughafen Teststadt",
  as_of: "2026-10",
  departures_per_day: 420,
  departures_basis: basis("420 Abflüge an einem typischen Tag im August"),
  profile_basis: basis("Morgenwelle 6 bis 8 Uhr, Nachtruhe 23 bis 6 Uhr", true),
  coverage_pct: { bus: 40, baggage_tractor: 100, pushback_tug: 100, gpu: 40 },
  coverage_basis: basis("60 Prozent der Positionen mit festem 400-Hz-Strom"),
  equipment_basis: basis("Förderbänder bei jedem Flug, Treppen ohne Brücke"),
  widebody_share_pct: 10,
  freight_widebody_share_pct: 0,
  widebody_basis: basis("Destatis, Flüge über 175 t"),
  electric_share_now_pct: 32,
  electric_share_basis: basis("Rund ein Drittel der Abfertigungsflotte fährt elektrisch"),
  parking_sessions_per_day: 150,
  parking_basis: basis("150 öffentliche Ladepunkte, je ein Vorgang am Tag", true),
  reserve_kw_public: null,
  reserve_basis: null,
  facts: [
    { label: "Passagiere 2025", value: "21 Mio.", source: "https://example.org/passagiere" },
    { label: "Nachtruhe", value: "23 bis 6 Uhr", source: "https://example.org/nacht" },
    { label: "Stromnetz", value: "eigenes Verteilnetz", source: "https://example.org/netz" },
  ],
  fleet: {
    vehicles: { bus: 37, baggage_tractor: 49, pushback_tug: 16, gpu: 35 },
    chargers: { bus: 15, baggage_tractor: 17, pushback_tug: 7, gpu: 14 },
    basis: basis("Aus dem Modell bemessen", true),
  },
};
const TEST_AXES = {
  electric_share_pct: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  storage_kwh: [0, 1000, 2500, 4500, 7000, 9500, 14000],
  pv_kwp: [0],
  parking_sessions: [0, 150],
};
const TEST_ENTRIES: Record<string, [number | null, number | null, number | null]> = {
  "30|4500|0|0": [1000, 950, 900],
  "30|0|0|0": [1000, 950, 950],
  "50|4500|0|0": [1300, 1200, 1100],
  "30|4500|0|150": [1600, 1500, 1400],
};
const TEST_PEAKS: Record<string, number | null> = {
  "30|0|0": 1850,
  "50|0|0": 2400,
  "30|0|150": 3500,
};

export function serve({
  atlas = true,
  feasible = true,
  failCompare = () => false,
  airports = false,
}: {
  atlas?: boolean;
  feasible?: boolean;
  failCompare?: () => boolean;
  /** Mit Testflughafen "TST" in der Auswahl. */
  airports?: boolean;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/demo/airports"))
        return new Response(JSON.stringify(airports ? [TEST_AIRPORT] : []));
      if (url.endsWith("/demo/electrification/atlas?airport=TST"))
        return new Response(
          JSON.stringify({
            available: true,
            axes: TEST_AXES,
            entries: TEST_ENTRIES,
            peaks: TEST_PEAKS,
            grid_max_kw: 28000,
            grid_step_kw: 50,
          }),
        );
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
