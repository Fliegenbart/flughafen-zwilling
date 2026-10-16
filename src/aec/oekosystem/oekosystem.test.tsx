import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import reference from "../model/__fixtures__/livePowerReference.json";

const AXES = {
  electric_share_pct: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  storage_kwh: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000],
  pv_kwp: [0, 500, 1000, 2000, 4000],
  parking_sessions: [0, 40, 100, 200],
};
// Erster Wert: direkt, am Anschluss begrenzt (nur Fachansicht). Die Kundenseite nimmt PEAKS.
const ENTRIES: Record<string, [number | null, number | null, number | null]> = {
  "50|2000|500|40": [875, 800, 675],
  "50|0|500|40": [875, 800, 800],
  "50|2000|2000|40": [875, 775, 600],
  "100|2000|500|40": [1400, 1225, 1150],
};
const PEAKS: Record<string, number | null> = {
  "50|500|40": 1625,
  "50|2000|40": 1575,
  "100|500|40": 1850,
};

function comparison(body: Record<string, number>, feasible = true) {
  return {
    comparison_id: "c1",
    inputs: body,
    comparison_contract: {
      total_vehicles: 100,
      electric_vehicles: body.electric_share_pct,
      non_electric_vehicles: 100 - body.electric_share_pct!,
      mission_count: 500,
      fleet: [],
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
      metadata: { config: {} },
      grid_sizing: { status: "feasible", required_grid_kw: 800, step_kw: 25, max_kw: 8000 },
      checks: feasible
        ? { feasible: true, reasons: [] }
        : { feasible: false, reasons: ["service_deadlines"] },
      metrics: {
        ready_departures: 100,
        departures_total: 100,
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

const bodies: Record<string, number>[] = [];
function serve({ atlas = true, feasible = true } = {}) {
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
        return new Response(JSON.stringify(comparison(body, feasible)));
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

const open = () => {
  window.history.replaceState(null, "", "/");
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
    expect(slider("Photovoltaik")).toHaveAttribute("aria-valuetext", "2.000 kWp");
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
