import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RobustnessPanel from "./RobustnessPanel";
import { config } from "./__fixtures__/coupledConfig";
import { plan } from "./__fixtures__/flightplan";

const suite = {
  suite_id: "a".repeat(32),
  engine_version: "airport_coupled_v1",
  seed: 42,
  flight_plan_snapshot_id: plan.snapshot_id,
  source_plan_sha256: plan.content_sha256,
  scenarios: [
    {
      key: "baseline",
      label: "Basis",
      varied_parameters: {},
      demand_invariant: true,
      mission_signature: "m".repeat(64),
      runs: [
        {
          policy: "uncontrolled",
          run_id: "1".repeat(32),
          status: { run_id: "1".repeat(32), state: "completed", progress: 100 },
          integrity_verified: true,
          completed_summary: {
            departure_readiness_pct: 80,
            grid_peak_kw: 3200,
            charging_unmet_kwh: 4,
            background_unserved_kwh: 0,
          },
          delta_to_baseline: null,
        },
      ],
    },
    {
      key: "grid_import_minus_20_pct",
      label: "Netzimport -20 %",
      varied_parameters: { "power.grid_import_limit_kw": 2800 },
      demand_invariant: true,
      mission_signature: "m".repeat(64),
      runs: [
        {
          policy: "uncontrolled",
          run_id: "2".repeat(32),
          status: { run_id: "2".repeat(32), state: "completed", progress: 100 },
          integrity_verified: true,
          completed_summary: {
            departure_readiness_pct: 70,
            grid_peak_kw: 2800,
            charging_unmet_kwh: 9,
            background_unserved_kwh: 2,
          },
          delta_to_baseline: {
            departure_readiness_pct: -10,
            grid_peak_kw: -400,
            charging_unmet_kwh: 5,
            background_unserved_kwh: -0.01,
          },
        },
      ],
    },
  ],
};

describe("RobustnessPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires a selected snapshot and shows completed deterministic stress metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify(suite), { status: 202 });
        return new Response(JSON.stringify(suite));
      }),
    );
    const { rerender } = render(<RobustnessPanel snapshot={null} config={config} pollMs={10} />);
    expect(screen.getByRole("button", { name: "Robustness-Suite starten" })).toBeDisabled();

    rerender(<RobustnessPanel snapshot={plan} config={config} pollMs={10} />);
    fireEvent.click(screen.getByRole("button", { name: "Robustness-Suite starten" }));
    expect(await screen.findByText("Netzimport -20 %")).toBeVisible();
    expect(screen.getByText("70 %")).toBeVisible();
    expect(screen.getByText("2 kWh")).toBeVisible();
    expect(screen.getByText("Δ -10 pp")).toBeVisible();
    expect(screen.getByText("Δ 0 kWh")).toBeVisible();
    expect(screen.getAllByText("Integrität bestätigt")).toHaveLength(2);
    expect(screen.getByText(/deterministischer Stress-Screen/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Suite-Status (GET)" })).toHaveAttribute(
      "href",
      `/api/v1/munich/robustness-suites/${suite.suite_id}`,
    );
    expect(screen.getByRole("link", { name: "Suite JSON" })).toHaveAttribute(
      "href",
      `/api/v1/munich/robustness-suites/${suite.suite_id}/artifact.json`,
    );
    expect(screen.getAllByRole("link", { name: "Run-Nachweis" })).toHaveLength(2);
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]?.body))).toMatchObject({
        flight_plan_snapshot_id: plan.snapshot_id,
        seed: 42,
        config,
      });
    });
  });
});
