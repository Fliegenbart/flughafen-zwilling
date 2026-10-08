import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { changesFor, extraVehiclesFor } from "../api/preview";
import { parseRoute, toSearch } from "../routes";
import { SAMPLE_PROJECT } from "../sample";

describe("Arbeitsplatz", () => {
  it("hat eine eigene Adresse", () => {
    expect(parseRoute("?projekt=p1&ansicht=neu")).toEqual({ page: "arbeitsplatz", projekt: "p1" });
    expect(toSearch({ page: "arbeitsplatz", projekt: "p1" })).toBe("?projekt=p1&ansicht=neu");
  });

  it("schickt nur geaenderte Regler an die genaue Rechnung", () => {
    const today = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1 };
    expect(changesFor(today, today)).toEqual({});
    expect(changesFor({ ...today, gridLimitKw: 4000, batteryKwh: 2000 }, today)).toEqual({
      grid_import_limit_kw: 4000,
      storage_kwh: 2000,
      storage_kw: 1000,
    });
    const extra = extraVehiclesFor({ ...today, extraVehicles: 10 })!;
    expect(Object.values(extra).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("zeigt den Beispieltag, reagiert auf den Regler und kann zuruecksetzen", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}&ansicht=neu`);
    render(<AirportEnergyCheck basePath="/" />);
    const outcome = await screen.findByRole("table");
    expect(within(outcome).getAllByRole("row").length).toBeGreaterThan(4);
    expect(screen.getByRole("img", { name: /fehlen bis zu/ })).toBeInTheDocument();
    const [grid] = screen.getAllByRole("slider");
    fireEvent.change(grid!, { target: { value: "6000" } });
    expect(
      await screen.findByRole("img", { name: "Der Anschluss reicht den ganzen Tag." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Beispieltag: Die Kurve folgt den Reglern/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auf heute zurücksetzen" }));
    expect(await screen.findByRole("img", { name: /fehlen bis zu/ })).toBeInTheDocument();
  });
});
