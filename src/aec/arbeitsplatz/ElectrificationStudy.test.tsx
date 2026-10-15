import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import reference from "../model/__fixtures__/livePowerReference.json";

function payload(share = 50) {
  return {
    comparison_id: "study-1",
    inputs: { electric_share_pct: share, grid_import_limit_kw: 3500, storage_kwh: 2000 },
    comparison_contract: {
      total_vehicles: 100,
      electric_vehicles: share,
      non_electric_vehicles: 100 - share,
      mission_count: 500,
      fleet: [],
    },
    limitations: ["Synthetischer Tag"],
    compute_ms: 100,
    variants: ["direct", "managed", "managed_storage"].map((solution, i) => ({
      ...reference.basis,
      departures: reference.departures,
      kpis: reference.kpis,
      solution,
      calculation_id: solution,
      input_hash: solution,
      metadata: { config: {} },
      metrics: {
        ready_departures: 80 + i * 5,
        departures_total: 100,
        energy_wait_min: 100 - i * 10,
        restricted_charging_min: 20 - i * 10,
        peak_grid_kw: 3500 - i * 100,
        apron_charged_kwh: 500,
        background_unserved_kwh: 0,
        parking_unmet_kwh: 0,
        horizon_hours: 30,
      },
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("compares three solutions with a fixed fleet, suppresses stale results and recalculates", async () => {
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          url.includes("/demo/electrification")
            ? payload(JSON.parse(String(init?.body)).electric_share_pct)
            : [],
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState(null, "", "/");
  render(<AirportEnergyCheck basePath="/" />);
  expect(
    await screen.findByText(
      "50 elektrische und 50 nicht-elektrische Fahrzeuge · Vergleich berechnet",
    ),
  ).toBeVisible();
  expect(screen.getAllByRole("slider")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "Direkt laden" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Gesteuert laden" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Gesteuert + Speicher" })).toBeVisible();
  expect(screen.getByText("90 / 100")).toBeVisible();
  fireEvent.change(screen.getByRole("slider", { name: "Elektroanteil" }), {
    target: { value: "70" },
  });
  expect(screen.queryByText("90 / 100")).toBeNull();
  expect(screen.getByText(/Einstellungen geändert/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Drei Varianten berechnen" }));
  await screen.findByText(
    "70 elektrische und 30 nicht-elektrische Fahrzeuge · Vergleich berechnet",
  );
  const requests = fetcher.mock.calls.filter(([url]) => url.includes("/demo/electrification"));
  expect(JSON.parse(String(requests[requests.length - 1]?.[1]?.body))).toEqual({
    electric_share_pct: 70,
    grid_import_limit_kw: 3500,
    storage_kwh: 2000,
  });
});

it("shows a retryable error instead of invented comparison results", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<AirportEnergyCheck basePath="/" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
  expect(screen.queryByText("90 / 100")).toBeNull();
  expect(screen.getByRole("button", { name: "Erneut berechnen" })).toBeEnabled();
});
