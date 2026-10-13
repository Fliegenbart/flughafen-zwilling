import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { changesFor, extraVehiclesFor, previewFromApi } from "../api/preview";
import { resultFromExact } from "../model/livePower";
import Outcome from "./Outcome";
import { parseRoute, toSearch } from "../routes";
import { SAMPLE_PROJECT } from "../sample";

import reference from "../model/__fixtures__/livePowerReference.json";
afterEach(() => vi.unstubAllGlobals());

describe("Arbeitsplatz", () => {
  it("zeigt berechnete Wartezeit auch ohne verspaetete Abfertigungen", () => {
    const preview = previewFromApi({
      ...reference.basis,
      kpis: {
        departures_total: 10,
        delayed_departures: 0,
        energy_wait_share_pct: 42,
      },
    })!;
    const result = resultFromExact(preview.basis);
    render(
      <Outcome
        today={result}
        todayPreview={preview}
        result={result}
        exact={preview}
        accuracy="genau"
        changed={true}
        sample={false}
      />,
    );
    fireEvent.click(screen.getByText("Alle Kennzahlen und Berechnungsnachweis"));
    expect(screen.getAllByText("42 %")).toHaveLength(2);
  });
  it("hat eine eigene Adresse", () => {
    expect(parseRoute("?projekt=p1&ansicht=neu")).toEqual({ page: "arbeitsplatz", projekt: "p1" });
    expect(toSearch({ page: "arbeitsplatz", projekt: "p1" })).toBe("?projekt=p1&ansicht=neu");
  });

  it("schickt nur geaenderte Regler an die genaue Rechnung", () => {
    const today = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1 };
    expect(changesFor(today, today)).toEqual({});
    expect(changesFor(today, { ...today, batteryKwh: 2000 })).toEqual({ storage_kwh: 0 });
    expect(changesFor({ ...today, gridLimitKw: 4000, batteryKwh: 2000 }, today)).toEqual({
      grid_import_limit_kw: 4000,
      storage_kwh: 2000,
      storage_kw: 1000,
    });
    const extra = extraVehiclesFor({ ...today, extraVehicles: 10 })!;
    expect(Object.values(extra).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("zeigt den Beispieltag, reagiert auf den Regler und kann zuruecksetzen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...reference.basis,
            departures: reference.departures,
            kpis: reference.kpis,
            calculation_id: "demo-test",
            input_hash: "a".repeat(64),
            engine_version: "airport_coupled_v2",
          }),
        ),
      ),
    );
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}&ansicht=neu`);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByText("Alle Kennzahlen und Berechnungsnachweis");
    fireEvent.click(screen.getByText("Alle Kennzahlen und Berechnungsnachweis"));
    fireEvent.click(screen.getByText("Tagesverlauf: Wann wird Strom knapp?"));
    const outcome = await screen.findByRole("table");
    expect(within(outcome).getAllByRole("row").length).toBeGreaterThan(4);
    expect(screen.getByRole("img", { name: /fehlen bis zu/ })).toBeInTheDocument();
    const grid = screen.getByRole("slider", { name: "Netzanschluss" });
    fireEvent.change(grid!, { target: { value: "6000" } });
    expect(
      await screen.findByRole("img", { name: "Der Anschluss reicht den ganzen Tag." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Vorläufige Netz-Näherung/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auf heute zurücksetzen" }));
    expect(await screen.findByRole("img", { name: /fehlen bis zu/ })).toBeInTheDocument();
  });
  it("oeffnet die Startseite direkt mit drei Reglern und Ergebnisvergleich", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...reference.basis,
              departures: reference.departures,
              kpis: reference.kpis,
              calculation_id: "focused-demo",
              input_hash: "a".repeat(64),
              engine_version: "airport_coupled_v2",
            }),
          ),
      ),
    );
    window.history.replaceState(null, "", "/");
    render(<AirportEnergyCheck basePath="/" />);
    expect(await screen.findByText("Was soll sich ändern?")).toBeVisible();
    expect(screen.getAllByRole("slider").filter((slider) => !slider.closest("details"))).toHaveLength(3);
    expect(screen.getByRole("slider", { name: "Photovoltaik" })).not.toBeVisible();
    expect(screen.getByText("Ungedeckter Ladebedarf")).toBeVisible();
    expect(screen.getByText("Abfertigungen mit Wartezeit")).toBeVisible();
    expect(screen.getByText("Höchste Netzlast")).toBeVisible();
    expect(
      screen.getByText("Eigene Projekte und weitere Untersuchungen").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "Messdaten-Abgleich" })).not.toBeVisible();
    fireEvent.click(screen.getByText("Weitere Werkzeuge"));
    expect(screen.getByRole("link", { name: "Messdaten-Abgleich" })).toBeVisible();
  });
});
