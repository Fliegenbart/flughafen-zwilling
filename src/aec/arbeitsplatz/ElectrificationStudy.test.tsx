import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import reference from "../model/__fixtures__/livePowerReference.json";
import FreeForm from "../views/loesungen/FreeForm";

function payload(share = 50) {
  return {
    comparison_id: "study-1",
    inputs: { electric_share_pct: share, grid_import_limit_kw: 1500, storage_kwh: 2000 },
    comparison_contract: {
      total_vehicles: 100,
      electric_vehicles: share,
      non_electric_vehicles: 100 - share,
      mission_count: 500,
      fleet: [],
    },
    limitations: ["Synthetischer Tag"],
    reference: { days: 3, resource_baseline_feasible: true, grid_step_kw: 25 },
    sources: [{ title: "He et al. (2026)", url: "https://doi.org/10.1038/s41467-026-71125-4" }],
    compute_ms: 100,
    variants: ["direct", "managed", "managed_storage"].map((solution, i) => ({
      ...reference.basis,
      departures: reference.departures,
      kpis: reference.kpis,
      solution,
      calculation_id: solution,
      input_hash: solution,
      metadata: { config: {} },
      grid_sizing: {
        status: "feasible",
        required_grid_kw: 1500 - i * 250,
        step_kw: 25,
        max_kw: 8000,
        evaluations: [],
      },
      checks: { feasible: true, reasons: [] },
      metrics: {
        ready_departures: 100,
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
  expect(
    screen.getByRole("heading", {
      name: "Flughafenflotte elektrifizieren.Den Anschlussbedarf vergleichen.",
    }),
  ).toBeVisible();
  expect(screen.getByText("100 Fahrzeuge")).toBeVisible();
  expect(screen.getByText("Identische Einsätze")).toBeVisible();
  expect(screen.getByText("Am Ende wieder geladen")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Direkt laden" })).toBeVisible();
  expect(screen.getByText("Sofort laden, am Anschluss begrenzt.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Vorausschauend laden" })).toBeVisible();
  expect(screen.getByText("Plant Ladezeiten passend zu den nächsten Einsätzen.")).toBeVisible();
  expect(screen.getByText(/Fahrzeugzuweisung, Anfangsladung und Einsatzplan/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Geplant + Speicher" })).toBeVisible();
  expect(screen.getByRole("slider", { name: "Netzanschluss" })).toHaveAttribute("step", "25");
  expect(screen.getByText("25-kW-Schritte für den abgegrenzten Modellbereich")).toBeVisible();
  expect(screen.getAllByRole("meter")).toHaveLength(3);
  expect(screen.getByText("Skala bis 1.500 kW")).toBeVisible();
  expect(screen.getByText("1.250 kW")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Lastverlauf anzeigen" })).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: "Lastverlauf anzeigen" })[0]).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.getAllByText("100 / 100")).toHaveLength(3);
  expect(screen.getByText("500 kW weniger als direktes Laden")).toBeVisible();
  expect(screen.getAllByText("Geprüfter Anschlussbedarf")).toHaveLength(3);
  expect(screen.queryByRole("heading", { name: "Lastverlauf: Vorausschauend laden" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Lastverlauf anzeigen" })[1]!);
  expect(screen.getByRole("heading", { name: "Lastverlauf: Vorausschauend laden" })).toBeVisible();
  fireEvent.change(screen.getByRole("slider", { name: "Elektroanteil" }), {
    target: { value: "70" },
  });
  expect(screen.queryByText("100 / 100")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Lastverlauf: Vorausschauend laden" })).toBeNull();
  expect(screen.getAllByRole("meter")[0]).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText(/Einstellungen geändert/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Anschlussbedarf vergleichen" }));
  await screen.findByText(
    "70 elektrische und 30 nicht-elektrische Fahrzeuge · Vergleich berechnet",
  );
  const requests = fetcher.mock.calls.filter(([url]) => url.includes("/demo/electrification"));
  expect(JSON.parse(String(requests[requests.length - 1]?.[1]?.body))).toEqual({
    electric_share_pct: 70,
    grid_import_limit_kw: 1500,
    storage_kwh: 2000,
  });
});

it("does not offer predictive charging in the legacy variant form", () => {
  render(<FreeForm busy={false} onAdd={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Was ändern Sie?" }), {
    target: { value: "laderegel" },
  });
  expect(screen.queryByRole("option", { name: /Vorausschauend/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Wer zuerst los muss/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Jedes Fahrzeug lädt/ })).toBeVisible();
});

it("shows a retryable error instead of invented comparison results", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<AirportEnergyCheck basePath="/" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
  expect(screen.queryByText("100 / 100")).toBeNull();
  expect(screen.getByRole("button", { name: "Erneut berechnen" })).toBeEnabled();
});

it("never presents a failed capacity search as a working solution", async () => {
  const data = payload();
  Object.assign(data.variants[2]!, {
    grid_sizing: {
      status: "not_found",
      required_grid_kw: null,
      step_kw: 25,
      max_kw: 8000,
      evaluations: [],
    },
    checks: { feasible: false, reasons: ["vehicle_recharge"] },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data))),
  );
  render(<AirportEnergyCheck basePath="/" />);
  expect(await screen.findByText("Nicht nachgewiesen bis 8.000 kW")).toBeVisible();
  fireEvent.click(screen.getAllByText("Prüfwerte")[2]!);
  expect(screen.getByText("Fahrzeugladung am Ende nicht wiederhergestellt")).toBeVisible();
});
