import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { bodies, serve } from "./__fixtures__/server";
import { forgetShared } from "./useOekosystem";

const open = () => {
  window.history.replaceState(null, "", "/");
  return render(<AirportEnergyCheck basePath="/" />);
};
const slider = (name: string) => screen.getByRole("slider", { name });

beforeEach(() => {
  bodies.length = 0;
  forgetShared();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Startseite für den Kundentermin", () => {
  it("beantwortet die Kernfrage mit einem Satz und der Treppe der Bausteine", async () => {
    serve();
    open();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Reicht der Anschluss, wenn das Vorfeld elektrisch fährt?",
      }),
    ).toBeVisible();
    expect(
      await screen.findByText(
        /^Ungesteuertes Laden würde Ihren Anschluss von 1.500\skW überlasten\. Mit Lademanagement reicht er/,
      ),
    ).toBeVisible();
    const stairs = screen.getByRole("figure", { name: "Benötigter Anschluss je Baustein" });
    const stages = within(stairs).getAllByRole("button");
    expect(stages.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/Ladeinfrastruktur.*nichts wird gesteuert.*1.625\skW$/),
      expect.stringMatching(/Lademanagement.*800\skW825\skW weniger/),
      expect.stringMatching(/Speicher.*675\skW950\skW weniger/),
    ]);
  });

  it("rechnet die Treppe sofort neu, ohne auf den Server zu warten", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    fireEvent.change(slider("Netzanschluss heute"), { target: { value: "650" } });
    expect(screen.getByText(/^Ihr Anschluss muss um 25\skW wachsen/)).toBeVisible();
    expect(screen.getByText(/Netzausbau: Der Anschluss braucht 25\skW mehr/)).toBeVisible();
    fireEvent.change(slider("Photovoltaik"), { target: { value: "3" } });
    expect(slider("Photovoltaik")).toHaveAttribute("aria-valuetext", "2.000\u00a0kWp");
    expect(screen.getByText(/^Erst mit Lademanagement und Speicher reicht/)).toBeVisible();
    fireEvent.change(slider("Photovoltaik"), { target: { value: "1" } });
    fireEvent.change(slider("Elektrische Fahrzeuge im Vorfeld"), { target: { value: "100" } });
    expect(screen.getByText(/Ihr Anschluss muss um 500\skW wachsen/)).toBeVisible();
    // Fehlt eine Stellung in der Tabelle, sagt die Seite das, statt zu raten.
    fireEvent.change(slider("Photovoltaik"), { target: { value: "4" } });
    expect(screen.getByText("Für diese Einstellung liegt noch keine Rechnung vor.")).toBeVisible();
  });

  it("zeigt die Tageskurve der gewählten Stufe, sobald der Server gerechnet hat", async () => {
    serve();
    open();
    expect(
      await screen.findByRole("img", {
        name: "Ohne Steuerung liegen die Ladespitzen über Ihrem Anschluss. Das wäre Überlast.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Netzlast über drei Tage, Ladeinfrastruktur" }),
    ).toBeVisible();
    expect(bodies[bodies.length - 1]).toEqual({
      electric_share_pct: 50,
      grid_import_limit_kw: 1500,
      storage_kwh: 2000,
      pv_kwp: 500,
      parking_sessions: 40,
    });
    fireEvent.click(screen.getByRole("button", { name: /\+\sSpeicher/ }));
    expect(
      screen.getByRole("heading", { name: /Netzlast über drei Tage, mit Speicher/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /\+\sSpeicher/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("img", { name: /alle Einsätze bleiben pünktlich|reicht an allen/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/grau zum Vergleich ohne Steuerung/)).toBeVisible();
  });

  it("zeigt, wenn der Anschluss auch ungesteuertes Laden trägt", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    fireEvent.change(slider("Netzanschluss heute"), { target: { value: "5000" } });
    expect(
      await screen.findByRole("img", { name: "Der Anschluss trägt auch ungesteuertes Laden." }),
    ).toBeInTheDocument();
  });

  it("sagt über der Kurve, wenn der Anschluss für die Stufe nicht reicht", async () => {
    serve({ feasible: false });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /\+\sLademanagement/ }));
    expect(
      await screen.findByRole("img", {
        name: "Hier reicht der Anschluss nicht: nicht alle Einsätze werden rechtzeitig fertig.",
      }),
    ).toBeInTheDocument();
  });

  it("schaltet ohne Speicher die dritte Stufe ab", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    fireEvent.change(slider("Speicher"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /\+\sSpeicher/ })).toBeDisabled();
    expect(screen.getByText("kein Speicher eingestellt")).toBeVisible();
  });

  it("schaltet die Speicherstufe ab, wenn der Speicher den Bedarf nicht senkt", async () => {
    serve();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /\+\sSpeicher/ }));
    fireEvent.change(slider("Laden im Parkhaus"), { target: { value: "3" } });
    const storage = screen.getByRole("button", { name: /\+\sSpeicher/ });
    expect(storage).toBeDisabled();
    expect(storage).toHaveTextContent("2,0 MWh Speicher senken hier den Bedarf nicht");
    expect(storage).not.toHaveTextContent("1.400");
    expect(screen.getByRole("button", { name: /\+\sLademanagement/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Mit Lademanagement reicht er, ohne Netzausbau\.$/)).toBeVisible();
  });

  it("meldet fehlende Vorab-Werte, statt Zahlen zu erfinden", async () => {
    serve({ atlas: false });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die vorab gerechneten Werte fehlen auf dem Server.",
    );
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("hat Präsentationsmodus, Druck und den Weg zur Fachansicht", async () => {
    serve();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { container } = open();
    await screen.findByText(/überlasten/);
    act(() => {
      fireEvent.keyDown(window, { key: "p" });
    });
    expect(container.querySelector(".oe")).toHaveAttribute("data-presenting");
    expect(screen.getByRole("button", { name: /Präsentieren/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Als PDF sichern" })[0]!);
    expect(print).toHaveBeenCalled();
    print.mockRestore();
    fireEvent.click(screen.getByRole("link", { name: "Ausführlicher Vergleich für Fachleute" }));
    await waitFor(() => expect(window.location.search).toBe("?seite=fachleute"));
  });

  it("zeigt keine Messdaten, Lauf-IDs oder Altwerkzeuge in der Kundensicht", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    const text = document.body.textContent ?? "";
    for (const word of ["SIL", "Messdatei", "Lauf-ID", "FlexLab", "Szenario-Bibliothek"])
      expect(text).not.toContain(word);
  });
});
