import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dossier from "../../data/references/munich_public_facts_v1.json";
import { DEFAULTS } from "./config";
import { parseTelemetry } from "./api";
import { buildCompareHtml } from "./report";
import MunichPilot from "./MunichPilot";
import type { EnergyKpis, EnergyRecord } from "./types";
import { plan } from "./__fixtures__/flightplan";
import { config } from "./__fixtures__/coupledConfig";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div>Leistungsgrafik</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
}));

const kpis = {
  grid_peak_kw: 2500,
  bus_ready_count: 0,
  bus_session_count: 50,
  parking_ready_count: 200,
  parking_session_count: 200,
  charging_unmet_kwh: 5000,
  pv_generated_kwh: 29000,
  pv_used_kwh: 20000,
  pv_export_kwh: 0,
  pv_curtailed_kwh: 0,
  background_unserved_kwh: 0,
  chp_unabsorbed_kwh: 0,
  balance_error_max_kw: 0,
  battery_initial_kwh: 0,
  battery_final_kwh: 0,
  battery_loss_kwh: 0,
} as EnergyKpis;
const base: EnergyRecord = {
  status: { run_id: "base-run", state: "completed", progress: 100, error: null, pass_fail: false },
  request: { seed: 42 },
  scenario_snapshot: {
    domain: "airport_energy_v1",
    metadata: { policy: "uncontrolled", comparison_id: "compare-1" },
  },
  model_pack_snapshot: {
    calibration_meta: {
      munich_assumptions: DEFAULTS,
      reference_dossier: dossier,
      world_hash: "same-world",
    },
  },
  summary: {
    energy_kpis: kpis,
    energy_sessions: [],
    energy_world_hash: "same-world",
    audit_fingerprint_sha256: "audit-base",
  },
};
const priority: EnergyRecord = {
  ...base,
  status: { ...base.status, run_id: "priority-run", pass_fail: true },
  scenario_snapshot: {
    ...base.scenario_snapshot,
    metadata: { policy: "bus_priority", comparison_id: "compare-1" },
  },
  summary: {
    ...base.summary!,
    energy_kpis: { ...kpis, bus_ready_count: 50, charging_unmet_kwh: 0 },
  },
};

describe("München Referenzpilot", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear(),
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/munich/reference"))
        return new Response(JSON.stringify({ defaults: DEFAULTS, dossier }));
      if (path.endsWith("/munich/coupled-reference"))
        return new Response(JSON.stringify({ defaults: config }));
      if (path.endsWith("/munich/flight-plans")) return new Response("[]");
      if (path.endsWith("/munich/comparisons") && init?.method === "POST")
        return new Response(
          JSON.stringify({
            comparison_id: "compare-1",
            world_hash: "same-world",
            runs: [base.status, priority.status],
          }),
        );
      const record = path.includes("priority-run") ? priority : base;
      if (path.endsWith("/record")) return new Response(JSON.stringify(record));
      if (path.endsWith("/telemetry"))
        return new Response('{"ts":0,"metric":"grid_import_kw","value":2500}\n');
      if (path.includes("/runs/")) return new Response(JSON.stringify(record.status));
      return new Response("missing", { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a separate airport energy pilot with honest data provenance", async () => {
    render(<MunichPilot />);
    expect(screen.getByRole("heading", { name: "Flugplan, Flotte & Energie" })).toBeVisible();
    expect(screen.getByText("Flughafen München", { exact: true })).toBeVisible();
    await screen.findByText(/München besitzt bereits einen Energiezwilling/);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled(),
    );
    expect(screen.getByText(/Keine FMG-Betriebsdaten/)).toBeVisible();
    expect(screen.getByText("275 Ladepunkte", { exact: true })).toBeVisible();
  });

  it("runs the pair, displays tradeoffs and links to frozen validation evidence", async () => {
    render(<MunichPilot />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Synthetischer Testfall" }), {
      target: { value: "constraint" },
    });
    const legacy = screen.getByRole("region", { name: "Energie-v1 / statisch" });
    fireEvent.click(within(legacy).getByRole("button", { name: "Regeln vergleichen" }));
    expect(await screen.findByRole("heading", { name: "Buspriorität" })).toBeVisible();
    expect(screen.getByText("+50 Bus-Ladefristen")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Run-Nachweis" })[0]).toHaveAttribute(
      "href",
      "/api/v1/runs/base-run/artifacts/record.json",
    );
    expect(screen.getByRole("button", { name: "Vergleichsreport herunterladen" })).toBeEnabled();
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith("/comparisons") && init?.method === "POST",
      );
    expect(JSON.parse(String(call?.[1]?.body)).assumptions.grid_import_limit_kw).toBe(2500);
  });

  it("permits retry after a request failure", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/reference"))
        return new Response(JSON.stringify({ defaults: DEFAULTS, dossier }));
      if (String(input).endsWith("/munich/flight-plans")) return new Response("[]");
      return new Response(JSON.stringify({ detail: "Run-Queue voll" }), { status: 429 });
    });
    render(<MunichPilot />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Regeln vergleichen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Run-Queue voll");
    expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled();
  });

  it("shows queued then completed instead of pretending the runs are already finished", async () => {
    let pending = true;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (/\/runs\/(base-run|priority-run)$/.test(String(input)) && pending) {
        const status = String(input).includes("priority") ? priority.status : base.status;
        return new Response(JSON.stringify({ ...status, state: "queued", progress: 0 }));
      }
      return original(input, init);
    });
    render(<MunichPilot />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Regeln vergleichen" }));
    expect(await screen.findByText("Ungesteuert: Warteschlange")).toBeVisible();
    expect(screen.getByRole("button", { name: "Vergleich läuft…" })).toBeDisabled();
    pending = false;
    expect(
      await screen.findByRole("heading", { name: "Buspriorität" }, { timeout: 2500 }),
    ).toBeVisible();
  });

  it("restores the last comparison after a page reload without creating duplicate runs", async () => {
    const cacheKey = "airport-munich-comparison:/api/v1";
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        comparison_id: "compare-1",
        world_hash: "same-world",
        runs: [base.status, priority.status],
      }),
    );
    render(<MunichPilot />);
    expect(await screen.findByText("+50 Bus-Ladefristen")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("escapes source text and does not export executable source links", () => {
    const mutated = {
      ...base,
      model_pack_snapshot: {
        calibration_meta: {
          ...base.model_pack_snapshot.calibration_meta,
          reference_dossier: {
            ...dossier,
            sources: [
              {
                ...dossier.sources[0]!,
                title: "<script>attack</script>",
                url: "javascript:alert(1)",
              },
            ],
          },
        },
      },
    };
    const html = buildCompareHtml(mutated, priority);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not fabricate benefit and rejects mismatched worlds in reports", () => {
    const equal = { ...priority, summary: base.summary };
    const html = buildCompareHtml(base, equal);
    expect(html).toContain("Kein Vorteil bei Bus-Ladefristen");
    expect(html).toContain("Nicht kalibriert");
    expect(html).toContain("audit-base");
    expect(() =>
      buildCompareHtml(base, {
        ...priority,
        summary: { ...priority.summary!, energy_world_hash: "other" },
      }),
    ).toThrow();
  });

  it("parses simulation minutes rather than wall-clock timestamps", () => {
    expect(parseTelemetry('{"ts":300000,"metric":"bus_kw","value":50}\n')).toEqual([
      { minute: 5, bus_kw: 50 },
    ]);
    expect(() => parseTelemetry('{"ts":0,"metric":"bus_kw","value":"invalid"}')).toThrow();
  });

  it("includes a frozen flightplan in reports without claiming an energy or OTP coupling", () => {
    const withPlan = (record: EnergyRecord): EnergyRecord => ({
      ...record,
      model_pack_snapshot: {
        calibration_meta: {
          ...record.model_pack_snapshot.calibration_meta,
          flight_plan_snapshot: plan,
          flight_plan_usage: "context_only_not_driving_energy",
        },
      },
    });
    const html = buildCompareHtml(withPlan(base), withPlan(priority));
    expect(html).toContain("Flugplan-Kontext");
    expect(html).toContain("03.10.2026");
    expect(html).toContain(plan.content_sha256);
    expect(html).toContain("keine betrieblichen Auswirkungen");
    expect(buildCompareHtml(base, priority)).not.toContain("Flugplan-Kontext");
    expect(() => buildCompareHtml(withPlan(base), priority)).toThrow();
  });

  it("passes the explicitly selected plan to the next comparison", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/munich/flight-plans"))
        return new Response(JSON.stringify([plan]));
      if (String(input).endsWith(plan.snapshot_id)) return new Response(JSON.stringify(plan));
      return original(input, init);
    });
    render(<MunichPilot />);
    await screen.findByRole("option", { name: /03.10.2026/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Gespeicherter Flugplantag" }), {
      target: { value: plan.snapshot_id },
    });
    await screen.findByText("XY101");
    fireEvent.click(screen.getByRole("button", { name: "Regeln vergleichen" }));
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith("/munich/comparisons") && init?.method === "POST",
      );
    expect(JSON.parse(String(call?.[1]?.body)).flight_plan_snapshot_id).toBe(plan.snapshot_id);
  });

  it("blocks a comparison until the requested flight plan has loaded", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/munich/flight-plans"))
        return new Response(JSON.stringify([plan]));
      if (String(input).endsWith(plan.snapshot_id))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return original(input, init);
    });
    render(<MunichPilot />);
    await screen.findByRole("option", { name: /03.10.2026/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Gespeicherter Flugplantag" }), {
      target: { value: plan.snapshot_id },
    });
    expect(screen.getByRole("button", { name: "Flugplan abwarten…" })).toBeDisabled();
    finish(new Response(JSON.stringify(plan)));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regeln vergleichen" })).toBeEnabled(),
    );
  });
});
