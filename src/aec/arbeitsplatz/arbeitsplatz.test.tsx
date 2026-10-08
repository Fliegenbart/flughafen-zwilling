import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { changesFor, extraVehiclesFor } from "../api/preview";
import { parseRoute, toSearch } from "../routes";
import { SAMPLE_PROJECT } from "../sample";

describe("Arbeitsplatz", () => {
  it("hat eine eigene Adresse", () => {
    expect(parseRoute("?projekt=p1")).toEqual({ page: "arbeitsplatz", projekt: "p1", auto: true });
    expect(parseRoute("?projekt=p1&ansicht=neu")).toEqual({ page: "arbeitsplatz", projekt: "p1" });
    expect(toSearch({ page: "arbeitsplatz", projekt: "p1" })).toBe("?projekt=p1");
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
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
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

  it("schaltet den Praesentationsmodus mit Knopf und Taste P und beendet ihn mit Esc", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    const { container } = render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    const root = () => container.querySelector(".ap")!;
    expect(root()).not.toHaveAttribute("data-presenting");
    fireEvent.click(screen.getByRole("button", { name: "Präsentieren" }));
    expect(root()).toHaveAttribute("data-presenting");
    expect(screen.getByRole("button", { name: "Präsentation beenden" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(root()).not.toHaveAttribute("data-presenting");
    fireEvent.keyDown(window, { key: "p" });
    expect(root()).toHaveAttribute("data-presenting");
    // Beim Tippen in einem Feld darf P nichts umschalten.
    fireEvent.keyDown(screen.getAllByRole("combobox")[0]!, { key: "p" });
    expect(root()).toHaveAttribute("data-presenting");
  });

  it("druckt die Seite zum Hinterlassen mit Hinweis zur Sicherheit der Zahlen", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    expect(screen.getByText(/Beispieltag mit erfundenen Werten/)).toBeInTheDocument();
    expect(screen.getAllByText(/nicht an Messungen kalibriert/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Als PDF sichern" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("bietet Krisenfaelle nur mit eigenem Projekt an", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    const crisis = screen.getByRole("combobox", { name: /Krisenfall durchspielen/ });
    expect(crisis).toBeDisabled();
    expect(within(crisis).getAllByRole("option")).toHaveLength(9);
  });

  it("zeigt die knappen Phasen als Liste und weitere Zeilen im Vergleich", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    const list = await screen.findByRole("heading", { name: "Wann es knapp wird" });
    const phases = within(list.parentElement!).getAllByRole("listitem");
    expect(phases.length).toBeGreaterThan(0);
    expect(phases[0]).toHaveTextContent(/Uhr bis zu .* fehlen, zusammen \d+ kWh/);
    const outcome = screen.getByRole("table");
    for (const row of [
      "Minuten mit voll ausgelastetem Anschluss",
      "Woran die Wartezeit liegt",
      "Höchster Bezug aus dem Netz",
    ])
      expect(within(outcome).getByRole("rowheader", { name: row })).toBeVisible();
  });

  it("lässt sich mit dem Schieber unter der Kurve durch den Tag bewegen", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    const scrub = await screen.findByRole("slider", { name: "Uhrzeit im Tagesverlauf" });
    fireEvent.change(scrub, { target: { value: "385" } });
    expect(scrub.getAttribute("aria-valuetext")).toMatch(/^06:25 Uhr: .* gebraucht/);
    expect(screen.getByText(/^06:25 Uhr: /)).toBeInTheDocument();
  });

  it("behält die Regler beim Wechsel zu Daten und zurück", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    const { unmount } = render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    fireEvent.change(screen.getAllByRole("slider")[0]!, { target: { value: "6000" } });
    expect(
      await screen.findByRole("img", { name: "Der Anschluss reicht den ganzen Tag." }),
    ).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    expect(
      await screen.findByRole("img", { name: "Der Anschluss reicht den ganzen Tag." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/heute 3,50\sMW/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auf heute zurücksetzen" }));
    expect(sessionStorage.getItem(`aec.regler.${SAMPLE_PROJECT.id}`)).toBeNull();
  });

  it("bietet Vorschläge an, die sich mit einem zweiten Tipp zurücknehmen lassen", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    const chips = screen.getByRole("group", { name: "Vorschläge zum Ausprobieren" });
    const grid = within(chips).getByRole("button", { name: "1 MW mehr Anschluss" });
    fireEvent.click(grid);
    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("slider")[0]).toHaveValue("4500");
    fireEvent.click(grid);
    expect(grid).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("slider")[0]).toHaveValue("3500");
    // Ohne Server wirken Laderegel und Fahrzeuge nicht.
    expect(within(chips).getByRole("button", { name: "5 Schlepper mehr" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Laderegel" })).toBeDisabled();
  });

  it("kennt die Schritte und führt von Durchrechnen zur Zusage", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("table");
    const steps = screen.getByRole("navigation", { name: "Drei Schritte des Projekts" });
    expect(
      within(steps)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["A Daten", "B Durchrechnen", "C Zusage"]);
    fireEvent.click(within(steps).getByRole("link", { name: /Zusage/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /erst nach einer Messung/ }),
    ).toBeVisible();
    expect(window.location.search).toBe(`?projekt=${SAMPLE_PROJECT.id}&frage=nachweis`);
  });
});
