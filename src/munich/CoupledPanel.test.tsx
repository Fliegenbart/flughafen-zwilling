import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoupledPanel from "./CoupledPanel";
import { plan } from "./__fixtures__/flightplan";
import { buildCoupledHtml, coupledPair, modelTime } from "./coupledReport";
import type { CoupledRecord } from "./coupledTypes";
import { config } from "./__fixtures__/coupledConfig";

const hash = "c".repeat(64);
const records = (["uncontrolled", "mission_priority"] as const).map(
  (policy, i): CoupledRecord => ({
    status: {
      run_id: String(i + 1).repeat(32),
      state: "completed",
      progress: 100,
      error: null,
      pass_fail: false,
    },
    request: { seed: 42, realtime_mode: "sil", adapters: [] },
    model_pack_snapshot: {
      parameter_set: { policy },
      calibration_meta: {
        flight_plan_snapshot: plan,
        coupled_world: {
          engine_version: "airport_coupled_v1",
          seed: 42,
          world_hash: hash,
          source_plan_sha256: plan.content_sha256,
          config,
          day_start_utc: "2026-10-02T22:00:00+00:00",
          day_minutes: 1440,
          start_min: -120,
          end_min: 1680,
          warnings: ["Nicht kalibriert <script>"],
        },
      },
    },
    build_meta: { execution_backend_git_commit: "abc123" },
    summary: {
      domain: "airport_coupled_v1",
      energy_world_hash: hash,
      audit_fingerprint_sha256: hash,
      coupled_kpis: {
        evidence_level: "schedule_driven_assumptions_uncalibrated",
        published_entry_count: 2,
        mission_count: 2,
        missions_completed: 2,
        missions_on_time: 1 + i,
        missions_uncompleted: 0,
        mission_on_time_pct: (i + 1) * 50,
        completed_mission_delay_avg_min: 5 - i * 5,
        modeled_departure_count: 1,
        departures_ready_on_time: i,
        departure_readiness_pct: i * 100,
        departures_uncompleted: 0,
        energy_wait_total_min: 15 - i * 10,
        resource_wait_total_min: 0,
        fleet_consumed_kwh: 16,
        fleet_initial_kwh: 300,
        fleet_final_kwh: 300,
        fleet_charged_kwh: 16,
        fleet_energy_balance_error_kwh: 0,
        fleet_reserve_violations: 0,
        transformer_loss_kwh: 1,
        model_horizon_hours: 30,
        departure_deadline_violation_lower_bound_avg_min: 10 - i * 10,
      },
      energy_kpis: {
        evidence_level: "synthetic_uncalibrated",
        model_hours: 30,
        grid_import_kwh: 0,
        grid_export_kwh: 0,
        charging_requested_kwh: 0,
        charging_delivered_kwh: 0,
        charging_loss_kwh: 0,
        bus_ready_count: 0,
        bus_session_count: 0,
        pv_generated_kwh: 0,
        pv_used_kwh: 0,
        pv_export_kwh: 0,
        pv_curtailed_kwh: 0,
        chp_generated_kwh: 0,
        battery_initial_kwh: 0,
        battery_final_kwh: 0,
        battery_charge_kwh: 0,
        battery_discharge_kwh: 0,
        battery_loss_kwh: 0,
        balance_error_max_kw: 0,
        grid_peak_kw: 3500,
        charging_unmet_kwh: i * 5,
        background_unserved_kwh: 0,
        parking_ready_count: 200 - i,
        parking_session_count: 200,
        chp_unabsorbed_kwh: 0,
      },
    },
  }),
);
const comparison = {
  engine_version: "airport_coupled_v1",
  comparison_id: "test",
  world_hash: hash,
  flight_plan_snapshot_id: plan.snapshot_id,
  runs: records.map((r) => ({ ...r.status, state: "queued" })),
};

function mockApi() {
  const polls = new Map<string, number>();
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.endsWith("/coupled-reference")) return new Response(JSON.stringify({ defaults: config }));
    if (init?.method === "POST") return new Response(JSON.stringify(comparison), { status: 202 });
    const record = records.find((r) => p.includes(r.status.run_id));
    if (p.endsWith("/safety"))
      return new Response(
        JSON.stringify({
          audit: {
            fingerprint_match: true,
            artifact_hashes_match: true,
            report_consistent_match: true,
            result_audit_scope: "data_and_reports_v2",
          },
        }),
      );
    if (p.endsWith("/record")) return new Response(JSON.stringify(record));
    if (p.endsWith("/coupled-evidence.json"))
      return new Response(
        JSON.stringify({
          policy: record!.model_pack_snapshot.parameter_set.policy,
          world_hash: hash,
          source_plan_sha256: plan.content_sha256,
          day_start_utc: "2026-10-02T22:00:00+00:00",
          start_min: -120,
          end_min: 1680,
          series: [],
          missions: [
            {
              mission_id: "bus-source",
              kind: "bus",
              flight_number: "XY102",
              vehicle_id: "bus-001",
              source_pages: [1],
              published_min: 540,
              deadline_min: 530,
              actual_start_min: 500,
              actual_complete_min: 515,
              deadline_met: true,
              wait_cause: "energy",
              energy_wait_min: 5,
              resource_wait_min: 0,
              delay_min: 0,
              delay_is_lower_bound: false,
              consumed_kwh: 8,
            },
          ],
        }),
      );
    const count = (polls.get(p) ?? 0) + 1;
    polls.set(p, count);
    return new Response(
      JSON.stringify({
        ...record?.status,
        state: count === 1 ? "queued" : count === 2 ? "running" : "completed",
      }),
    );
  });
}

describe("Gekoppelter Flugplan-/Energievergleich", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires an explicit plan and never starts a run on load", async () => {
    mockApi();
    render(<CoupledPanel plan={null} />);
    expect(
      await screen.findByRole("heading", { name: "Flugplan, Flotte & Energie" }),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByText("Weitere Modellannahmen")).toBeVisible());
    expect(screen.getByRole("button", { name: "Gekoppelten Vergleich starten" })).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("keeps coupled controls and its own action in one studio workspace", async () => {
    mockApi();
    render(<CoupledPanel plan={plan} flightPlanPanel={<p>Flugplan-Importslot</p>} pollMs={20} />);
    const configArea = await screen.findByRole("region", { name: "Testkonfiguration" });
    expect(within(configArea).getByText("Flugplan-Importslot")).toBeVisible();
    expect(within(configArea).getByLabelText(/Netzimportgrenze/)).toBeVisible();
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("heading", { name: "Fristenpriorität" });
    const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toContain("/munich/coupled-comparisons");
    expect(JSON.parse(String(posts[0]![1]?.body))).toMatchObject({
      flight_plan_snapshot_id: plan.snapshot_id,
      seed: 42,
      config: { power: config.power },
    });
  });

  it("freezes the selected day, polls and shows traceable results with tradeoffs", async () => {
    mockApi();
    render(<CoupledPanel plan={plan} pollMs={100} />);
    const start = await screen.findByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByText(/Ungesteuert: Warteschlange/)).toBeVisible();
    expect(await screen.findByText(/Ungesteuert: Berechnung/)).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Fristenpriorität" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ungesteuert" })).toBeVisible();
    expect(screen.getByText(/Δ Aufgabenbereitschaft/)).toHaveTextContent("+100 pp");
    expect(screen.getByText("0 / 1 modellierte Abflugseinträge rechtzeitig")).toBeVisible();
    expect(screen.getByText("1 / 1 modellierte Abflugseinträge rechtzeitig")).toBeVisible();
    expect(screen.getByText("XY102")).toBeVisible();
    expect(screen.getByRole("link", { name: "Fahrzeug-SOC CSV" })).toHaveAttribute(
      "href",
      `/api/v1/runs/${records[1]!.status.run_id}/artifacts/vehicles.csv`,
    );
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      flight_plan_snapshot_id: plan.snapshot_id,
      seed: 42,
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Modellaufgaben suchen" }), {
      target: { value: "unknown" },
    });
    expect(screen.getByText("Keine passenden Modellaufgaben.")).toBeVisible();
  });

  it("requires explicit acknowledgement for unresolved shared groups", async () => {
    mockApi();
    render(<CoupledPanel plan={{ ...plan, possible_shared_flight_groups: 1 }} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await screen.findByText("Weitere Modellannahmen");
    expect(start).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Mehrfachgruppen als unabhängige Nachfrage/ }),
    );
    expect(start).toBeEnabled();
  });

  it("submits explicit timed charger outages with the shared frozen configuration", async () => {
    mockApi();
    render(<CoupledPanel plan={plan} pollMs={20} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(screen.getByText("Weitere Modellannahmen"));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Zeitlich begrenzten Netz-/Ladepunktengpass prüfen",
      }),
    );
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Ladepunktausfall / Fahrzeugklasse",
      }),
      { target: { value: "bus" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: /Netzlimit während Störung/,
      }),
      { target: { value: "3500" } },
    );
    fireEvent.click(start);
    await screen.findByRole("heading", { name: "Fristenpriorität" });
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body)).config.stress_events).toEqual([
      {
        start_min: 360,
        end_min: 540,
        grid_import_limit_kw: 3500,
        fleet_kind: "bus",
        offline_chargers: 1,
      },
    ]);
  });

  it("reports API failure, with no fabricated result", async () => {
    mockApi();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (p, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ detail: "Run-Queue voll" }), { status: 429 })
        : original(p, init),
    );
    render(<CoupledPanel plan={plan} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("Run-Queue voll");
    expect(screen.queryByRole("heading", { name: "Fristenpriorität" })).not.toBeInTheDocument();
  });

  it.each(["seed", "offline_chargers"] as const)(
    "blocks incomplete numeric input: %s",
    async (field) => {
      mockApi();
      render(<CoupledPanel plan={plan} />);
      const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
      await waitFor(() => expect(start).toBeEnabled());
      fireEvent.click(screen.getByText("Weitere Modellannahmen"));
      if (field === "offline_chargers") {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: "Zeitlich begrenzten Netz-/Ladepunktengpass prüfen",
          }),
        );
        fireEvent.change(
          screen.getByRole("combobox", {
            name: "Ladepunktausfall / Fahrzeugklasse",
          }),
          { target: { value: "bus" } },
        );
      }
      fireEvent.change(
        screen.getByRole("spinbutton", {
          name: field === "seed" ? /Kopplungs-Seed/ : /Ausgefallene Ladepunkte/,
        }),
        { target: { value: "" } },
      );
      expect(start).toBeDisabled();
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    },
  );

  it("rejects unmatched worlds and escapes report input; handles DST using UTC", () => {
    expect(() => coupledPair(records, "wrong")).toThrow(/identische/);
    const html = buildCoupledHtml(records, hash);
    expect(html).toContain("Fairer Regelvergleich");
    expect(html).toContain("Nicht kalibriert &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Parkhaus: fehlende Ladeenergie");
    const nearZero = structuredClone(records);
    nearZero[0]!.summary!.energy_kpis.charging_unmet_kwh = 1e-9;
    nearZero[1]!.summary!.energy_kpis.charging_unmet_kwh = 0;
    expect(buildCoupledHtml(nearZero, hash)).not.toContain("<td>-0");
    expect(modelTime("2026-10-24T22:00:00Z", 180)).toContain("02:00");
    expect(modelTime("2026-10-24T22:00:00Z", 180)).toContain("MEZ");
  });

  it("withholds results when the result-artifact audit fails", async () => {
    mockApi();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) =>
      String(path).endsWith("/safety")
        ? new Response(
            JSON.stringify({ audit: { fingerprint_match: true, artifact_hashes_match: false } }),
          )
        : original(path, init),
    );
    render(<CoupledPanel plan={plan} pollMs={20} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("Integritätsprüfung fehlgeschlagen");
    expect(screen.queryByRole("heading", { name: "Fristenpriorität" })).not.toBeInTheDocument();
  });

  it("a terminal failed run does not become a successful comparison", async () => {
    mockApi();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) =>
      String(path).endsWith(records[0]!.status.run_id)
        ? new Response(
            JSON.stringify({ ...records[0]!.status, state: "failed", error: "Testausfall" }),
          )
        : original(path, init),
    );
    render(<CoupledPanel plan={plan} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("Testausfall");
    expect(screen.queryByText(/aktuelle SHA256-Prüfung konsistent/)).not.toBeInTheDocument();
  });

  it("withholds a comparison when displayed KPI/report evidence disagrees", async () => {
    mockApi();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) =>
      String(path).endsWith("/safety")
        ? new Response(
            JSON.stringify({
              audit: {
                fingerprint_match: true,
                artifact_hashes_match: true,
                report_consistent_match: false,
                result_audit_scope: "data_and_reports_v2",
              },
            }),
          )
        : original(path, init),
    );
    render(<CoupledPanel plan={plan} pollMs={20} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("Integritätsprüfung fehlgeschlagen");
    expect(screen.queryByRole("heading", { name: "Fristenpriorität" })).not.toBeInTheDocument();
  });

  it("does not claim sealed reports for older otherwise consistent runs", async () => {
    mockApi();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) =>
      String(path).endsWith("/safety")
        ? new Response(
            JSON.stringify({
              audit: {
                fingerprint_match: true,
                artifact_hashes_match: true,
                report_consistent_match: true,
                result_audit_scope: "data_and_report_consistency_v1",
              },
            }),
          )
        : original(path, init),
    );
    render(<CoupledPanel plan={plan} pollMs={20} />);
    const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("heading", { name: "Fristenpriorität" });
    expect(screen.getByText(/PDF\/Report-Dateien ohne ursprüngliche SHA256/)).toBeVisible();
  });
});
