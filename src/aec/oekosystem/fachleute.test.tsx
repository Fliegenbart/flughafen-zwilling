import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { bodies, serve } from "./__fixtures__/server";

const open = (search = "?seite=fachleute") => {
  window.history.replaceState(null, "", `/${search}`);
  return render(<AirportEnergyCheck basePath="/" />);
};
const slider = (name: string) => screen.getByRole("slider", { name });

beforeEach(() => {
  bodies.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Seite für Fachleute", () => {
  it("nimmt die Einstellung von der Übersicht mit und zurück", async () => {
    serve();
    open("");
    await screen.findByText(/überlasten/);
    fireEvent.change(slider("Netzanschluss heute"), { target: { value: "650" } });
    await waitFor(() => expect(window.location.search).toBe("?anschluss=650"));
    fireEvent.click(screen.getByRole("link", { name: "Ausführlicher Vergleich für Fachleute" }));
    await waitFor(() => expect(window.location.search).toBe("?seite=fachleute&anschluss=650"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Der Vergleich im Detail" }),
    ).toBeVisible();
    expect(await screen.findByText(/^Ihr Anschluss muss um 25\skW wachsen/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /Bei Ihren 650\skW/ })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Zur Übersicht" }));
    await waitFor(() => expect(window.location.search).toBe("?anschluss=650"));
    expect(slider("Netzanschluss heute")).toHaveValue("650");
  });

  it("stellt vier Rechnungen mit Bedarf und Urteil nebeneinander", async () => {
    serve();
    open();
    const table = (await screen.findByText("Vier Rechnungen mit derselben Flotte"))
      .closest("section")!
      .querySelector("table")!;
    await waitFor(() => expect(table).not.toHaveTextContent("wird gerechnet"));
    const lines = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(lines).toEqual([
      expect.stringMatching(/^1Ohne Steuerung.*1.625\skWÜberlast, Spitze 1.614\skW$/),
      expect.stringMatching(/^Einfache Leistungsbegrenzung.*875\skWreicht$/),
      expect.stringMatching(/^2Lademanagement.*Diesen Wert zeigt die Übersicht\.800\skWreicht$/),
      expect.stringMatching(/^3\+ Speicher.*2,0 MWh Speicher mit 1.000\skW.*675\skWreicht$/),
    ]);
  });

  it("zeigt Kurve und Kennzahlen der gewählten Rechnung", async () => {
    serve();
    open();
    expect(
      await screen.findByRole("heading", { name: /Ohne Steuerung bei Ihren 1.500\skW/ }),
    ).toBeVisible();
    expect(screen.getByText("Über Ihrem Anschluss").nextSibling).toHaveTextContent(
      /bis zu 114\skW/,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Lademanagement/ }));
    expect(
      screen.getByRole("heading", { name: "Netzlast über drei Tage, Lademanagement" }),
    ).toBeVisible();
    expect(
      screen.getByText("Abflüge mit allen Fahrzeugen rechtzeitig bereit").nextSibling,
    ).toHaveTextContent("540 von 540");
    expect(screen.getByText(/grau zum Vergleich ohne Steuerung/)).toBeVisible();
  });

  it("begründet den Bedarf mit Flotte, Flugplan und Annahmen der Regler", async () => {
    serve();
    open("?seite=fachleute&pv=2000&parkhaus=100");
    const fleet = (await screen.findByText("Vorfeldflotte des Beispielflughafens")).closest(
      "table",
    )!;
    expect(within(fleet).getByRole("row", { name: /Gepäckschlepper/ })).toHaveTextContent(
      /^Gepäckschlepper35185\d kWh7,7 kWh12 × 22\skW$/,
    );
    const basis = within(
      screen.getByRole("heading", { name: "Woraus der Bedarf entsteht" }).closest("section")!,
    );
    expect(basis.getByText(/Photovoltaik: 2.000 kWp/)).toHaveTextContent(
      /höchstens 20 % der Nennleistung/,
    );
    expect(basis.getByText(/Parkhaus: 100 Ladevorgänge am Tag mit je 11\skW/)).toBeVisible();
    expect(basis.getByText(/180 Abflüge am Tag in drei Wellen/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Wann ein Anschluss reicht" })).toBeVisible();
    expect(screen.getByRole("link", { name: "He et al. (2026)" })).toHaveAttribute(
      "href",
      "https://doi.org/10.1038/x",
    );
    expect(bodies[bodies.length - 1]).toMatchObject({ pv_kwp: 2000, parking_sessions: 100 });
  });

  it("setzt eine Stellung aus der Adresse auf die gerechneten Werte", async () => {
    serve();
    open("?seite=fachleute&anteil=47&anschluss=1490&pv=abc");
    await screen.findByText(/überlasten/);
    expect(slider("Elektrische Fahrzeuge im Vorfeld")).toHaveAttribute(
      "aria-valuetext",
      "50\u00a0%",
    );
    expect(slider("Netzanschluss heute")).toHaveValue("1500");
    await waitFor(() => expect(window.location.search).toBe("?seite=fachleute"));
  });

  it("zeigt keine Messdaten-Werkzeuge, Läufe oder Altprojekte", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    const text = document.body.textContent ?? "";
    for (const word of ["SIL", "Messdatei", "Lauf", "Eigene Projekte", "Lastprofil & Messdaten"])
      expect(text).not.toContain(word);
  });
});
