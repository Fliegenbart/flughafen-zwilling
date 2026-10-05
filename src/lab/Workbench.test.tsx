import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Workbench from "./Workbench";
import { chartSamples } from "./chart";

const bench = {
  name: "Lab 01",
  min_power_kw: 0,
  max_power_kw: 120,
  grid_limit_kw: 80,
  ramp_kw_per_s: 20,
  response_delay_s: 1,
  noise_kw: 0.15,
};
const criteria = {
  tolerance_kw: 2,
  tracking_mae_max_kw: 3,
  response_max_s: 10,
  settling_s: 3,
  grace_s: 10,
  limit_violation_budget_s: 1,
  min_coverage_pct: 98,
  expected_interval_s: 1,
  max_gap_s: 3,
};
const catalog = {
  product: "FlexLab Workbench",
  read_only: true,
  live_connection: false,
  cases: [
    {
      id: "setpoint-step",
      name: "Sollwertsprung",
      description: "Reaktion prüfen",
      tag: "Regelverhalten",
    },
    { id: "flex-reduction", name: "Flex-Abregelung", description: "Abregeln", tag: "Flexibilität" },
  ],
  default_bench: bench,
  default_criteria: criteria,
  csv_columns: ["ts_s", "power_kw", "setpoint_kw", "limit_kw"],
};
const complete = {
  run_id: "test-id",
  state: "completed",
  label: "Mein Test",
  source: "simulation",
  case_id: "setpoint-step",
  bench,
  criteria,
  created_ts: "2026-10-02T10:00:00Z",
  progress: 1,
  comparison_key: "same-profile",
  request: { seed: 42, duration_s: 180, playback_speed: 20 },
  artifacts: ["record.json", "trace.csv", "report.html"],
  recovery_count: 0,
  provenance: "Keine Live-Anbindung",
  analysis: {
    verdict: "pass",
    metrics: {
      peak_power_kw: 80,
      energy_import_kwh: 3.5,
      energy_export_kwh: 0,
      tracking_mae_kw: 0.1,
      response_time_s: 4,
      limit_violation_s: 0,
      observed_duration_s: 180,
    },
    quality: {
      coverage_pct: 100,
      sampling_coverage_pct: 100,
      missing_samples: 0,
      sample_count: 181,
      max_gap_s: 1,
      reasons: [],
    },
    checks: [
      {
        id: "quality",
        name: "Datenqualität",
        state: "pass",
        actual: 100,
        threshold: 98,
        unit: "%",
        detail: "Vollständig",
      },
    ],
  },
};

describe("FlexLab Workbench", () => {
  beforeEach(() => {
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url);
      const data = path.endsWith("/catalog")
        ? catalog
        : path.endsWith("/trace")
          ? []
          : path.endsWith("/runs") && !init?.method
            ? []
            : complete;
      return { ok: true, json: async () => data } as Response;
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a read-only energy workbench and configured cases", async () => {
    render(<Workbench />);
    expect(await screen.findByText(/FlexLab Workbench/)).toBeInTheDocument();
    expect(screen.getByText("Keine Live-Anbindung")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Flex-Abregelung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test starten" })).toBeEnabled();
  });

  it("starts a test, displays evidence and persists selection", async () => {
    render(<Workbench />);
    fireEvent.click(await screen.findByRole("button", { name: "Test starten" }));
    expect(await screen.findByText("Mein Test")).toBeInTheDocument();
    expect((await screen.findAllByText("Bestanden")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /HTML-Bericht/ })).toHaveAttribute(
      "href",
      expect.stringContaining("test-id/artifacts/report.html"),
    );
    expect(localStorage.getItem("flexlab:selected")).toBe("test-id");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([, init]) =>
            init?.method === "POST" && JSON.parse(String(init.body)).criteria.tolerance_kw === 2,
        ),
    ).toBe(true);
  });

  it("provides the measurement import contract without hardware actuation", async () => {
    render(<Workbench />);
    await screen.findByRole("button", { name: "Test starten" });
    fireEvent.click(screen.getByRole("button", { name: "Messdaten" }));
    expect(screen.getByText("ts_s,power_kw,setpoint_kw,limit_kw")).toBeInTheDocument();
    expect(screen.getByLabelText("CSV-Datei auswählen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CSV-Vorlage" })).toBeInTheDocument();
  });

  it("disables execution when the backend is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<Workbench />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Test starten" })).toBeDisabled(),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("polls a queued test to completion without allowing another accidental start", async () => {
    let polls = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url);
      const data = path.endsWith("/catalog")
        ? catalog
        : path.endsWith("/trace")
          ? []
          : path.endsWith("/runs") && !init?.method
            ? []
            : init?.method === "POST"
              ? { ...complete, state: "queued", analysis: null }
              : ++polls < 2
                ? { ...complete, state: "running", analysis: null, progress: 0.3 }
                : complete;
      return { ok: true, json: async () => data } as Response;
    });
    render(<Workbench />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Test starten" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Test starten" }));
    expect(await screen.findByRole("button", { name: "Test abbrechen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test starten" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bestanden"), {
      timeout: 3000,
    });
  });

  it("does not reopen old evidence when a new test is being prepared", async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith("/catalog")
              ? catalog
              : String(url).endsWith("/trace")
                ? []
                : String(url).endsWith("/runs")
                  ? [complete]
                  : complete,
        }) as Response,
    );
    render(<Workbench />);
    fireEvent.click(await screen.findByRole("button", { name: "Neuen Test vorbereiten" }));
    fireEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
    await waitFor(() =>
      expect(screen.getByText("PROFILVORSCHAU / KEINE MESSUNG")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Mein Test")).not.toBeInTheDocument();
  });

  it("keeps CSV validation errors visible and does not invent a result", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/imports")
        ? ({
            ok: false,
            status: 422,
            json: async () => ({ detail: "CSV Zeile 2: NaN/Infinity nicht erlaubt" }),
          } as Response)
        : ({
            ok: true,
            json: async () => (String(url).endsWith("/catalog") ? catalog : []),
          } as Response),
    );
    render(<Workbench />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Test starten" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Messdaten" }));
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "bad" });
    fireEvent.change(screen.getByLabelText("CSV-Datei auswählen"), { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Messdaten auswerten" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Messdaten auswerten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CSV Zeile 2");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders baseline deltas and a downloadable comparison report", async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith("/catalog")
              ? catalog
              : String(url).endsWith("/runs")
                ? [complete, { ...complete, run_id: "baseline-id", label: "Referenz" }]
                : String(url).endsWith("/trace")
                  ? []
                  : String(url).includes("/compare?")
                    ? {
                        baseline_id: "baseline-id",
                        candidate_id: "test-id",
                        deltas: {
                          peak_power_kw: -5,
                          tracking_mae_kw: -1,
                          response_time_s: -2,
                          limit_violation_s: -3,
                        },
                        note: "Kein kausaler Nachweis",
                      }
                    : complete,
        }) as Response,
    );
    render(<Workbench />);
    const select = await screen.findByLabelText("Vergleichbarer Referenzlauf");
    fireEvent.change(select, { target: { value: "baseline-id" } });
    expect(await screen.findByText("Δ Sollabweichung")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vergleichsbericht HTML" })).toHaveAttribute(
      "href",
      expect.stringContaining("baseline_id=baseline-id"),
    );
  });
});

it("never bridges a timestamp gap in measurement charts", () => {
  const points = [
    { ts_s: 0, power_kw: 20, setpoint_kw: 20, limit_kw: 80 },
    { ts_s: 1, power_kw: 21, setpoint_kw: 20, limit_kw: 80 },
    { ts_s: 10, power_kw: 25, setpoint_kw: 20, limit_kw: 80 },
  ];
  expect(
    chartSamples(points, 3).some(
      (point) => point.power_kw === null && point.ts_s > 1 && point.ts_s < 10,
    ),
  ).toBe(true);
});

it("retains extrema while downsampling large CSV charts", () => {
  const points = Array.from({ length: 10000 }, (_, i) => ({
    ts_s: i,
    power_kw: i === 5555 ? 500 : 20,
    setpoint_kw: 20,
    limit_kw: 80,
  }));
  expect(chartSamples(points, 3).some((point) => point.power_kw === 500)).toBe(true);
  expect(chartSamples(points, 3).length).toBeLessThan(2500);
});
