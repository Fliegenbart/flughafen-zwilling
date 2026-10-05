import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import App, {
  INITIAL_STATE,
  buildPlaybookJobPayload,
  generateTestReport,
  parseTelemetryJsonl,
  stateFromTwinRecord,
} from "./App";

describe("HMI smoke", () => {
  function mockJsonResponse(payload: unknown, status = 200): Promise<Response> {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "ERR",
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(typeof payload === "string" ? payload : JSON.stringify(payload)),
    } as Response);
  }

  function mockTextResponse(payload: string, status = 200): Promise<Response> {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "ERR",
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(payload),
    } as Response);
  }

  it("renders the HMI dashboard without crashing", () => {
    render(<App />);
    expect(screen.getByText(/Airport Twin Core/i)).toBeInTheDocument();
  });

  it("uses a compact studio header without presenting initial zeros as evidence", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Was hält die Abfertigung aus?", level: 1 })).toBeVisible();
    const band = screen.getByRole("region", { name: "Airport-Modell-KPIs" });
    expect(within(band).getAllByText("n/a")).toHaveLength(4);
    expect(within(band).queryByText("0.00")).toBeNull();
    expect(screen.getByRole("button", { name: "Backend Run starten" })).toBeVisible();
  });

  it("shows all 8 airport cases in the test profile dropdown", () => {
    render(<App />);

    const names = [
      "Spitzenwelle",
      "Guillotine-Test",
      "Wetter-Kompression",
      "Gepaeckstau",
      "Personalengpass",
      "Sicherheitswelle",
      "Enteisungsfenster",
      "Schwarzstart",
    ];

    for (const name of names) {
      expect(screen.getByRole("option", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
  });

  it("renders core run controls", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /API pruefen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Backend Run starten/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Demo Live starten/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bericht erzeugen/i })).toBeInTheDocument();
  });

  it("does not offer a localhost Grafana link when hosted monitoring is disabled", async () => {
    globalThis.__TWIN_CONFIG__ = { grafanaBaseUrl: "" };
    const status = {
      run_id: "hosted-run",
      state: "completed",
      progress: 1,
      artifacts: {},
      pass_fail: true,
    };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/capabilities"))
        return mockJsonResponse({ grafana_base_url: "", playbook_synth_enabled: false });
      if (url.endsWith("/telemetry")) return mockTextResponse("");
      if (url.endsWith("/record")) return mockJsonResponse({ status, summary: {} });
      if (url.endsWith("/runs") || url.endsWith("/runs/hosted-run"))
        return mockJsonResponse(status);
      return mockJsonResponse({ status: "ok" });
    });
    try {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Backend Run starten" }));
      await waitFor(() => expect(screen.getByRole("link", { name: "PDF-Bericht" })).toBeVisible());
      expect(screen.queryByRole("link", { name: /Grafana/i })).toBeNull();
    } finally {
      delete globalThis.__TWIN_CONFIG__;
    }
  });

  it("uses the same-origin API without probing an unrelated local service by default", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockClear();
    delete (globalThis as { __TWIN_CONFIG__?: unknown }).__TWIN_CONFIG__;
    fetchMock.mockImplementation(() => mockJsonResponse({ playbook_synth_enabled: true }));

    render(<App />);
    await screen.findByText("Playbook Synthesizer");
    expect(screen.getByDisplayValue(window.location.origin)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith(window.location.origin)),
    ).toBe(true);
  });

  it("exports the completed run's case and configuration rather than edited form values", async () => {
    const status = { run_id: "frozen-run", state: "completed", progress: 100, pass_fail: true };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/telemetry")) return mockTextResponse("");
      if (url.endsWith("/capabilities")) return mockJsonResponse({ playbook_synth_enabled: false });
      if (url.endsWith("/record")) return mockJsonResponse({ status, summary: {} });
      if (url.endsWith("/runs") || url.endsWith("/runs/frozen-run"))
        return mockJsonResponse(status);
      return mockJsonResponse({ status: "ok" });
    });
    const blobs: Blob[] = [];
    const blobSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:report";
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText("Testprofil"), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "Backend Run starten" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Bericht erzeugen" })).toBeEnabled(),
      );
      fireEvent.change(screen.getByLabelText("Testprofil"), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Gates Total"), { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: "Bericht erzeugen" }));
      const html = await blobs[0]!.text();
      expect(html).toContain('data-report-theme="operations-studio"');
      expect(html).toContain("<b>Szenario:</b> Guillotine-Test");
      expect(html).toContain("Gates: 28");
      expect(screen.getByRole("link", { name: "PDF-Bericht" })).toHaveAttribute(
        "href",
        `${window.location.origin}/api/v1/runs/frozen-run/artifacts/report.pdf`,
      );
    } finally {
      blobSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it("keeps frozen scenario playbook provenance visible after the selected case changes", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const frozenRequest = {
      seed: 2028,
      scenario_id: "airport_case_02_guillotine_v1",
      model_pack_id: "airport_medium_eu_v1",
      source_kind: "scenario",
    };
    const option = {
      option_id: "opt-frozen",
      feasible: true,
      violation_penalty: 0,
      intervention_cost: 4,
      estimated_airport_kpis: {
        otp_rate_pct: 88,
        avg_turnaround_min: 51,
        gate_utilization_avg_pct: 89,
        delay_avg_min: 7,
      },
      delta_to_baseline: {
        otp_rate_pct_delta: 2,
        avg_turnaround_min_delta: -2,
        gate_utilization_avg_pct_delta: -1,
        delay_avg_min_delta: -1,
        intervention_cost_delta: 4,
      },
      actions: [],
    };

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/capabilities")) return mockJsonResponse({ playbook_synth_enabled: true });
      if (url.endsWith("/scenarios") && init?.method === "POST")
        return mockJsonResponse({ id: frozenRequest.scenario_id });
      if (url.endsWith("/model-packs") && init?.method === "POST")
        return mockJsonResponse({ id: frozenRequest.model_pack_id });
      if (url.endsWith("/playbook-jobs") && init?.method === "POST") {
        return mockJsonResponse({ job_id: "pb-frozen", state: "completed", progress: 100 });
      }
      if (url.endsWith("/playbook-jobs/pb-frozen"))
        return mockJsonResponse({ state: "completed", progress: 100 });
      if (url.endsWith("/playbook-jobs/pb-frozen/record")) {
        return mockJsonResponse({
          status: { job_id: "pb-frozen", state: "completed", progress: 100 },
          request: frozenRequest,
          best_option: option,
          pareto_options: [],
          artifacts: [],
        });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    fireEvent.change(screen.getByLabelText("Testprofil"), { target: { value: "2" } });
    await screen.findByText("Playbook Synthesizer");
    fireEvent.click(screen.getByRole("button", { name: "Playbook synthetisieren" }));

    const comparison = await screen.findByRole("region", { name: "Playbook-Vergleich" });
    fireEvent.change(screen.getByLabelText("Testprofil"), { target: { value: "8" } });

    expect(
      within(comparison).getByRole("heading", { name: "Eingefrorener Playbook-Vergleich" }),
    ).toBeInTheDocument();
    expect(within(comparison).getByText("airport_case_02_guillotine_v1")).toBeInTheDocument();
    expect(within(comparison).getByText("airport_medium_eu_v1")).toBeInTheDocument();
    expect(within(comparison).getByText("2028")).toBeInTheDocument();
    expect(within(comparison).getByText(/nicht automatisch der aktuelle Run/i)).toBeInTheDocument();
  });

  it("shows a failed model criterion separately from a completed technical run", async () => {
    const status = {
      run_id: "criteria-false",
      state: "completed",
      progress: 100,
      pass_fail: false,
    };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/capabilities")) return mockJsonResponse({ playbook_synth_enabled: false });
      if (url.endsWith("/telemetry")) return mockTextResponse("");
      if (url.endsWith("/record")) return mockJsonResponse({ status, summary: {} });
      if (url.endsWith("/runs") || url.endsWith("/runs/criteria-false"))
        return mockJsonResponse(status);
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Backend Run starten" }));

    await waitFor(() => {
      expect(screen.getByText("Status: completed")).toBeInTheDocument();
      expect(screen.getByText("Modellkriterien: nicht erfüllt")).toBeInTheDocument();
    });
    expect(screen.getByText(/Modellwerte, kein empirischer Nachweis/i)).toBeInTheDocument();
  });

  it("only switches to the local observability backend when fallback is explicitly enabled", async () => {
    const fetchMock = vi.mocked(global.fetch);
    globalThis.__TWIN_CONFIG__ = {
      apiBaseUrl: "http://127.0.0.1:8001",
      allowLocalApiFallback: true,
    };

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/api/v1/capabilities") {
        return mockJsonResponse({
          playbook_synth_enabled: false,
          telemetry_stream_enabled: false,
          grafana_base_url: "http://127.0.0.1:3000",
        });
      }
      if (url === "http://127.0.0.1:8000/api/v1/capabilities") {
        return mockJsonResponse({
          playbook_synth_enabled: true,
          telemetry_stream_enabled: true,
          grafana_base_url: "http://127.0.0.1:3000",
        });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("http://127.0.0.1:8000")).toBeInTheDocument();
      expect(screen.getByText(/Grafana STREAM ON/i)).toBeInTheDocument();
    });

    delete (globalThis as { __TWIN_CONFIG__?: { apiBaseUrl?: string } }).__TWIN_CONFIG__;
  });

  it("does not leave the demo backend when local API fallback is disabled", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockClear();
    Object.assign(globalThis, {
      __TWIN_CONFIG__: {
        apiBaseUrl: "http://127.0.0.1:8001",
        allowLocalApiFallback: false,
      },
    });
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      mockJsonResponse({
        playbook_synth_enabled: false,
        telemetry_stream_enabled: String(input).startsWith("http://127.0.0.1:8000"),
      }),
    );
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByText(/Grafana STREAM OFF/i)).toBeInTheDocument());
      expect(screen.getByDisplayValue("http://127.0.0.1:8001")).toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8000")),
      ).toBe(false);
    } finally {
      delete (globalThis as { __TWIN_CONFIG__?: unknown }).__TWIN_CONFIG__;
    }
  });

  it("keeps planner panel hidden when capability is disabled", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({ playbook_synth_enabled: false });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.queryByText(/Playbook Synthesizer/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /Pareto Alternativen/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows planner panel when capability is enabled", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({ playbook_synth_enabled: true });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Playbook Synthesizer/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Playbook synthetisieren/i })).toBeInTheDocument();
  });

  it("renders forecast controls when planner mode is switched to forecast", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({ playbook_synth_enabled: true });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Playbook Synthesizer/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: /Planner Modus/i }), {
      target: { value: "forecast" },
    });

    expect(screen.getByRole("combobox", { name: /Forecast Quelle/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Forecast Horizont/i })).toBeInTheDocument();
  });

  it("builds a config snapshot forecast payload from the current configuration", () => {
    const payload = buildPlaybookJobPayload({
      plannerMode: "forecast",
      forecastSource: "config_snapshot",
      forecastHorizonMin: 120,
      selectedTest: 2,
      selectedCaseName: "Guillotine-Test",
      remoteRunId: null,
      config: {
        gatesTotal: 28,
        gatesOpenPct: 92,
        arrivalsPerHour: 25,
        departuresPerHour: 22,
        baseTurnaroundMin: 46,
        groundCrewTeams: 15,
        crewCapacityFlightsPerHour: 2,
        baggageCapacityFlightsPerHour: 24,
        runwaySlotsPerHour: 26,
        twinApiBaseUrl: "http://127.0.0.1:8000",
        twinProfileId: "airport_medium_eu_v1",
        twinRealtimeMode: "hil_realtime",
        twinSeedBase: 2026,
      },
    });

    expect(payload.source_kind).toBe("config_snapshot");
    expect(payload.forecast_horizon_min).toBe(120);
    expect(payload.scenario_id).toBe("airport_case_02_guillotine_v1");
    expect(payload.model_pack_id).toBe("airport_medium_eu_v1");
    expect(payload.config_snapshot).toMatchObject({
      gates_open_pct: 92,
      departures_per_hour: 22,
      ground_crew_teams: 15,
    });
  });

  it("builds a run snapshot forecast payload from the latest run", () => {
    const payload = buildPlaybookJobPayload({
      plannerMode: "forecast",
      forecastSource: "run_snapshot",
      forecastHorizonMin: 30,
      selectedTest: 8,
      selectedCaseName: "Schwarzstart",
      remoteRunId: "run-source-1",
      config: {
        gatesTotal: 28,
        gatesOpenPct: 96,
        arrivalsPerHour: 24,
        departuresPerHour: 24,
        baseTurnaroundMin: 44,
        groundCrewTeams: 14,
        crewCapacityFlightsPerHour: 1.8,
        baggageCapacityFlightsPerHour: 26,
        runwaySlotsPerHour: 28,
        twinApiBaseUrl: "http://127.0.0.1:8000",
        twinProfileId: "airport_medium_eu_v1",
        twinRealtimeMode: "hil_realtime",
        twinSeedBase: 2026,
      },
    });

    expect(payload.source_kind).toBe("run_snapshot");
    expect(payload.source_run_id).toBe("run-source-1");
    expect(payload.forecast_horizon_min).toBe(30);
    expect(payload.metadata).toMatchObject({
      planner_mode: "forecast",
      forecast_source: "run_snapshot",
      case_name: "Schwarzstart",
    });
  });

  it("polls planner job and renders recommendation with actions and KPI summary", async () => {
    const fetchMock = vi.mocked(global.fetch);
    let statusPolls = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({
          playbook_synth_enabled: !url.startsWith("http://capability-off.test"),
        });
      }
      if (url.endsWith("/api/v1/scenarios") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_case_02_guillotine_v1" });
      }
      if (url.endsWith("/api/v1/model-packs") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_medium_eu_v1" });
      }
      if (url.endsWith("/api/v1/playbook-jobs") && init?.method === "POST") {
        return mockJsonResponse({ job_id: "pb-1", state: "queued", progress: 0 });
      }
      if (url.endsWith("/api/v1/playbook-jobs/pb-1/record")) {
        return mockJsonResponse({
          status: { job_id: "pb-1", state: "completed", progress: 100 },
          baseline_option: {
            option_id: "baseline",
            feasible: false,
            violation_penalty: 6,
            intervention_cost: 0,
            estimated_airport_kpis: {
              otp_rate_pct: 82.4,
              avg_turnaround_min: 56.8,
              gate_utilization_avg_pct: 93.3,
              delay_avg_min: 12.7,
            },
            validated_airport_kpis: {
              otp_rate_pct: 82.2,
              avg_turnaround_min: 57.1,
              gate_utilization_avg_pct: 93.1,
              delay_avg_min: 12.9,
            },
            delta_to_baseline: {
              otp_rate_pct_delta: 0,
              avg_turnaround_min_delta: 0,
              gate_utilization_avg_pct_delta: 0,
              delay_avg_min_delta: 0,
              intervention_cost_delta: 0,
            },
            actions: [],
            validation_run_id: "run-baseline",
            validation_pass_fail: true,
          },
          best_option: {
            option_id: "opt_001",
            feasible: true,
            violation_penalty: 0,
            intervention_cost: 12,
            estimated_airport_kpis: {
              otp_rate_pct: 88.5,
              avg_turnaround_min: 51.2,
              gate_utilization_avg_pct: 89.1,
              delay_avg_min: 7.3,
            },
            validated_airport_kpis: {
              otp_rate_pct: 88.1,
              avg_turnaround_min: 51.4,
              gate_utilization_avg_pct: 89.0,
              delay_avg_min: 7.5,
            },
            delta_to_baseline: {
              otp_rate_pct_delta: 5.9,
              avg_turnaround_min_delta: -5.7,
              gate_utilization_avg_pct_delta: -4.1,
              delay_avg_min_delta: -5.4,
              intervention_cost_delta: 12,
            },
            actions: [
              {
                at_ms: 8000,
                target: "gates_open_pct",
                action: "inject",
                value: 4,
                cost_component: 4,
              },
            ],
            validation_run_id: "run-best",
            validation_pass_fail: true,
          },
          pareto_options: [
            {
              option_id: "opt_002",
              feasible: true,
              violation_penalty: 0,
              intervention_cost: 14,
              estimated_airport_kpis: {
                otp_rate_pct: 89.2,
                avg_turnaround_min: 50.4,
                gate_utilization_avg_pct: 88.8,
                delay_avg_min: 6.8,
              },
              validated_airport_kpis: {
                otp_rate_pct: 88.9,
                avg_turnaround_min: 50.6,
                gate_utilization_avg_pct: 88.5,
                delay_avg_min: 6.9,
              },
              delta_to_baseline: {
                otp_rate_pct_delta: 6.7,
                avg_turnaround_min_delta: -6.5,
                gate_utilization_avg_pct_delta: -4.6,
                delay_avg_min_delta: -6,
                intervention_cost_delta: 14,
              },
              actions: [],
              validation_run_id: "run-alt",
              validation_pass_fail: true,
            },
          ],
          artifacts: ["playbook.md", "summary.csv"],
        });
      }
      if (url.endsWith("/api/v1/playbook-jobs/pb-1")) {
        statusPolls += 1;
        if (statusPolls === 1) {
          return mockJsonResponse({ job_id: "pb-1", state: "running", progress: 45 });
        }
        return mockJsonResponse({ job_id: "pb-1", state: "completed", progress: 100 });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/Playbook Synthesizer/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Playbook synthetisieren/i }));

    await waitFor(() => expect(screen.getByText(/Job RUNNING/i)).toBeInTheDocument());
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: /Baseline/i })).toBeInTheDocument();
        expect(screen.getByText(/Empfehlung: opt_001/i)).toBeInTheDocument();
        expect(screen.getByText(/^Delta OTP:/i)).toBeInTheDocument();
        expect(screen.getByText(/gates_open_pct/i)).toBeInTheDocument();
        expect(screen.getByText(/Pareto Alternativen/i)).toBeInTheDocument();
        expect(screen.getByText(/opt_002/i)).toBeInTheDocument();
        const paretoRegion = screen.getByRole("region", { name: /Pareto Alternativen/i });
        expect(paretoRegion).toHaveAttribute("tabindex", "0");
        expect(paretoRegion).toContainElement(screen.getByRole("table"));
      },
      { timeout: 8000 },
    );

    fireEvent.change(screen.getByLabelText("API Base URL"), {
      target: { value: "http://capability-off.test" },
    });
    await waitFor(() => {
      expect(screen.queryByText(/Playbook Synthesizer/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /Pareto Alternativen/i }),
      ).not.toBeInTheDocument();
    });
  }, 10000);

  it("renders a clearer forecast narrative for forecast planner results", async () => {
    const fetchMock = vi.mocked(global.fetch);
    let statusPolls = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({ playbook_synth_enabled: true });
      }
      if (url.endsWith("/api/v1/scenarios") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_case_08_schwarzstart_v1" });
      }
      if (url.endsWith("/api/v1/model-packs") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_medium_eu_v1" });
      }
      if (url.endsWith("/api/v1/playbook-jobs") && init?.method === "POST") {
        return mockJsonResponse({ job_id: "pb-forecast", state: "queued", progress: 0 });
      }
      if (url.endsWith("/api/v1/playbook-jobs/pb-forecast/record")) {
        return mockJsonResponse({
          status: { job_id: "pb-forecast", state: "completed", progress: 100 },
          request: {
            source_kind: "config_snapshot",
            forecast_horizon_min: 60,
          },
          build_meta: {
            forecast_mode: true,
            forecast_source_kind: "config_snapshot",
            forecast_horizon_min: 60,
            derived_forecast_scenario_id: "forecast_pb-forecast_config_snapshot_v1",
            derived_forecast_model_pack_id: "forecast_pb-forecast_model_v1",
          },
          baseline_option: {
            option_id: "baseline",
            feasible: true,
            violation_penalty: 0,
            intervention_cost: 0,
            estimated_airport_kpis: {
              otp_rate_pct: 84.4,
              avg_turnaround_min: 56.2,
              gate_utilization_avg_pct: 92.6,
              delay_avg_min: 11.8,
            },
            validated_airport_kpis: {
              otp_rate_pct: 84.2,
              avg_turnaround_min: 56.1,
              gate_utilization_avg_pct: 92.8,
              delay_avg_min: 12.1,
            },
            delta_to_baseline: {
              otp_rate_pct_delta: 0,
              avg_turnaround_min_delta: 0,
              gate_utilization_avg_pct_delta: 0,
              delay_avg_min_delta: 0,
              intervention_cost_delta: 0,
            },
            actions: [],
            validation_run_id: "run-forecast-baseline",
            validation_pass_fail: true,
          },
          best_option: {
            option_id: "opt_003",
            feasible: true,
            violation_penalty: 0,
            intervention_cost: 8,
            estimated_airport_kpis: {
              otp_rate_pct: 87.5,
              avg_turnaround_min: 52.7,
              gate_utilization_avg_pct: 89.4,
              delay_avg_min: 8.1,
            },
            validated_airport_kpis: {
              otp_rate_pct: 87.2,
              avg_turnaround_min: 52.4,
              gate_utilization_avg_pct: 89.2,
              delay_avg_min: 8.0,
            },
            delta_to_baseline: {
              otp_rate_pct_delta: 3,
              avg_turnaround_min_delta: -3.7,
              gate_utilization_avg_pct_delta: -3.6,
              delay_avg_min_delta: -4.1,
              intervention_cost_delta: 8,
            },
            actions: [
              {
                at_ms: 12000,
                target: "ground_crew_teams",
                action: "inject",
                value: 2,
                cost_component: 12,
              },
            ],
            validation_run_id: "run-forecast-best",
            validation_pass_fail: true,
          },
          pareto_options: [],
          artifacts: [],
        });
      }
      if (url.endsWith("/api/v1/playbook-jobs/pb-forecast")) {
        statusPolls += 1;
        if (statusPolls === 1) {
          return mockJsonResponse({ job_id: "pb-forecast", state: "running", progress: 32 });
        }
        return mockJsonResponse({ job_id: "pb-forecast", state: "completed", progress: 100 });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/Playbook Synthesizer/i)).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: /Planner Modus/i }), {
      target: { value: "forecast" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Playbook synthetisieren/i }));

    await waitFor(
      () => {
        expect(screen.getByText(/Forecast Entscheidung/i)).toBeInTheDocument();
        expect(screen.getByText(/Projektion ohne Eingriff/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Empfohlener Eingriff/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Erwarteter Effekt/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/Forecast Baseline/i)).toBeInTheDocument();
        expect(screen.getByText(/Forecast Empfehlung/i)).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it("renders a Grafana live link for the active run when telemetry streaming is available", async () => {
    const fetchMock = vi.mocked(global.fetch);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({
          playbook_synth_enabled: false,
          telemetry_stream_enabled: true,
          grafana_base_url: "http://127.0.0.1:3000",
        });
      }
      if (url.includes("/api/v1/health")) {
        return mockJsonResponse({ status: "ok" });
      }
      if (url.endsWith("/api/v1/scenarios") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_case_01_spitzenwelle_v1" });
      }
      if (url.endsWith("/api/v1/model-packs") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_medium_eu_v1" });
      }
      if (url.endsWith("/api/v1/runs") && init?.method === "POST") {
        return mockJsonResponse({ run_id: "run-grafana", state: "completed", progress: 100 });
      }
      if (url.endsWith("/api/v1/runs/run-grafana")) {
        return mockJsonResponse({
          run_id: "run-grafana",
          state: "completed",
          progress: 100,
          pass_fail: true,
        });
      }
      if (url.endsWith("/api/v1/runs/run-grafana/record")) {
        return mockJsonResponse({
          status: { run_id: "run-grafana", state: "completed", progress: 100, pass_fail: true },
          summary: {
            tick_drift_avg_ms: 1.1,
            tick_drift_max_ms: 2.2,
            tick_drift_p99_ms: 2.0,
            audit_fingerprint_sha256: "hash",
            airport_kpis: {
              otp_rate_pct: 88.1,
              avg_turnaround_min: 47.3,
              gate_utilization_avg_pct: 83.4,
              ground_crew_utilization_avg_pct: 71.2,
              departure_queue_avg_flights: 1.2,
              baggage_queue_avg_flights: 0.8,
              delay_avg_min: 6.1,
            },
          },
        });
      }
      if (url.endsWith("/api/v1/runs/run-grafana/safety")) {
        return mockJsonResponse({
          watchdog_summary: {
            watchdog_config_loaded: true,
            watchdog_ticks_ok: 12,
            watchdog_misses: 0,
            watchdog_fail_safe: false,
            fail_reason: "",
          },
        });
      }
      if (url.endsWith("/api/v1/runs/run-grafana/telemetry")) {
        return mockTextResponse(
          [JSON.stringify({ ts: 40, metric: "otp_pct", value: 88.1 })].join("\n"),
        );
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Backend Run starten/i }));

    await waitFor(() => {
      const grafanaLink = screen.getByRole("link", { name: /Grafana Live/i });
      expect(grafanaLink).toHaveAttribute(
        "href",
        expect.stringContaining("var-run_id=run-grafana"),
      );
    });
  });

  it("requests telemetry slices while a run is still running", async () => {
    const fetchMock = vi.mocked(global.fetch);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({
          playbook_synth_enabled: false,
          telemetry_stream_enabled: true,
          grafana_base_url: "http://127.0.0.1:3000",
        });
      }
      if (url.includes("/api/v1/health")) {
        return mockJsonResponse({ status: "ok" });
      }
      if (url.endsWith("/api/v1/scenarios") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_case_02_guillotine_v1" });
      }
      if (url.endsWith("/api/v1/model-packs") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_medium_eu_v1" });
      }
      if (url.endsWith("/api/v1/runs") && init?.method === "POST") {
        return mockJsonResponse({ run_id: "run-live", state: "queued", progress: 0 });
      }
      if (url.endsWith("/api/v1/runs/run-live")) {
        return mockJsonResponse({
          run_id: "run-live",
          state: "running",
          progress: 25,
          pass_fail: null,
        });
      }
      if (url.endsWith("/api/v1/runs/run-live/record")) {
        return mockJsonResponse({
          status: { run_id: "run-live", state: "running", progress: 25, pass_fail: null },
          summary: null,
        });
      }
      if (url.endsWith("/api/v1/runs/run-live/safety")) {
        return mockJsonResponse({
          watchdog_summary: {
            watchdog_config_loaded: true,
            watchdog_ticks_ok: 4,
            watchdog_misses: 0,
            watchdog_fail_safe: false,
            fail_reason: "",
          },
        });
      }
      if (url.includes("/api/v1/runs/run-live/telemetry-slice")) {
        return mockJsonResponse({
          items: [
            {
              ts: 40,
              metric: "otp_pct",
              value: 86.4,
              source: "sim",
              asset_id: "airport",
              quality: "good",
              unit: "%",
              run_id: "run-live",
            },
            {
              ts: 40,
              metric: "turnaround_avg_min",
              value: 48.5,
              source: "sim",
              asset_id: "airport",
              quality: "good",
              unit: "min",
              run_id: "run-live",
            },
          ],
          next_cursor: 256,
          complete: false,
        });
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Backend Run starten/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/api/v1/runs/run-live/telemetry-slice"),
        ),
      ).toBe(true);
      expect(screen.getByText(/Run RUNNING/i)).toBeInTheDocument();
    });
  });

  it("starts demo mode in hil realtime and opens Grafana for the created run", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const popup = {
      closed: false,
      location: { replace: vi.fn() },
      document: { title: "", body: { innerHTML: "" } },
      close: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    let runPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/capabilities")) {
        return mockJsonResponse({
          playbook_synth_enabled: false,
          telemetry_stream_enabled: true,
          grafana_base_url: "http://127.0.0.1:3000",
        });
      }
      if (url.includes("/api/v1/health")) {
        return mockJsonResponse({ status: "ok" });
      }
      if (url.endsWith("/api/v1/scenarios") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_case_01_spitzenwelle_v1" });
      }
      if (url.endsWith("/api/v1/model-packs") && init?.method === "POST") {
        return mockJsonResponse({ id: "airport_medium_eu_v1" });
      }
      if (url.endsWith("/api/v1/runs") && init?.method === "POST") {
        runPayload = JSON.parse(String(init.body || "{}"));
        return mockJsonResponse({ run_id: "run-demo", state: "completed", progress: 100 });
      }
      if (url.endsWith("/api/v1/runs/run-demo")) {
        return mockJsonResponse({
          run_id: "run-demo",
          state: "completed",
          progress: 100,
          pass_fail: true,
        });
      }
      if (url.endsWith("/api/v1/runs/run-demo/record")) {
        return mockJsonResponse({
          status: { run_id: "run-demo", state: "completed", progress: 100, pass_fail: true },
          summary: {
            tick_drift_avg_ms: 1.0,
            tick_drift_max_ms: 2.0,
            tick_drift_p99_ms: 1.8,
            audit_fingerprint_sha256: "demo-hash",
            airport_kpis: {
              otp_rate_pct: 91.2,
              avg_turnaround_min: 46.8,
              gate_utilization_avg_pct: 84.4,
              ground_crew_utilization_avg_pct: 72.5,
              departure_queue_avg_flights: 1.0,
              baggage_queue_avg_flights: 0.5,
              delay_avg_min: 5.2,
            },
          },
        });
      }
      if (url.endsWith("/api/v1/runs/run-demo/safety")) {
        return mockJsonResponse({
          watchdog_summary: {
            watchdog_config_loaded: true,
            watchdog_ticks_ok: 12,
            watchdog_misses: 0,
            watchdog_fail_safe: false,
            fail_reason: "",
          },
        });
      }
      if (url.endsWith("/api/v1/runs/run-demo/telemetry")) {
        return mockTextResponse(
          [JSON.stringify({ ts: 40, metric: "otp_pct", value: 91.2 })].join("\n"),
        );
      }
      return mockJsonResponse({ status: "ok" });
    });

    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: /Run Mode/i }), {
      target: { value: "sil" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Demo Live starten/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Demo Live starten/i }));

    await waitFor(() => {
      expect(runPayload?.realtime_mode).toBe("hil_realtime");
      expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
      expect(popup.location.replace).toHaveBeenCalledWith(
        expect.stringContaining("var-run_id=run-demo"),
      );
    });

    openSpy.mockRestore();
  });

  it("maps airport telemetry and KPI summary into UI state", () => {
    const telemetry = parseTelemetryJsonl(
      [
        JSON.stringify({ ts: 40, metric: "otp_pct", value: 87.5 }),
        JSON.stringify({ ts: 40, metric: "turnaround_avg_min", value: 49.2 }),
        JSON.stringify({ ts: 40, metric: "gate_utilization_pct", value: 88.0 }),
      ].join("\n"),
    );

    const next = stateFromTwinRecord(
      INITIAL_STATE,
      {
        status: { run_id: "run-1", state: "completed", progress: 100, pass_fail: true },
        summary: {
          tick_drift_avg_ms: 1.2,
          tick_drift_max_ms: 3.4,
          tick_drift_p99_ms: 2.2,
          audit_fingerprint_sha256: "abc123",
          airport_kpis: {
            otp_rate_pct: 87.5,
            avg_turnaround_min: 49.2,
            gate_utilization_avg_pct: 88,
            ground_crew_utilization_avg_pct: 73,
            departure_queue_avg_flights: 1.1,
            baggage_queue_avg_flights: 0.9,
            delay_avg_min: 7.4,
          },
        },
      },
      telemetry,
      {
        watchdog_summary: {
          watchdog_config_loaded: true,
          watchdog_ticks_ok: 12,
          watchdog_misses: 0,
          watchdog_fail_safe: false,
          fail_reason: "",
        },
      },
    );

    expect(next.remoteRunId).toBe("run-1");
    expect(next.otpRatePct).toBeCloseTo(87.5, 3);
    expect(next.avgTurnaroundMin).toBeCloseTo(49.2, 3);
    expect(next.dataLog).toHaveLength(1);
    expect(next.watchdogTicksOk).toBe(12);
  });

  it("embeds compare data in the HTML report when playbook data is present", async () => {
    const popup = {
      closed: false,
      addEventListener: vi.fn(),
      print: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    let reportBlob: Blob | null = null;
    const blobSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob?: Blob | MediaSource) => {
        reportBlob = blob instanceof Blob ? blob : null;
        return "blob:report";
      });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    generateTestReport(
      INITIAL_STATE,
      {
        gatesTotal: 28,
        gatesOpenPct: 96,
        arrivalsPerHour: 24,
        departuresPerHour: 24,
        baseTurnaroundMin: 44,
        groundCrewTeams: 14,
        crewCapacityFlightsPerHour: 2,
        baggageCapacityFlightsPerHour: 26,
        runwaySlotsPerHour: 28,
        twinApiBaseUrl: "http://127.0.0.1:8000",
        twinProfileId: "airport_medium_eu_v1",
        twinRealtimeMode: "hil_realtime",
        twinSeedBase: 2026,
      },
      2,
      {
        status: { job_id: "pb-1", state: "completed", progress: 100 },
        baseline_option: {
          option_id: "baseline",
          feasible: false,
          violation_penalty: 4,
          intervention_cost: 0,
          estimated_airport_kpis: {
            otp_rate_pct: 82,
            avg_turnaround_min: 57,
            gate_utilization_avg_pct: 93,
            delay_avg_min: 13,
          },
          validated_airport_kpis: {
            otp_rate_pct: 82,
            avg_turnaround_min: 57,
            gate_utilization_avg_pct: 93,
            delay_avg_min: 13,
          },
          delta_to_baseline: {
            otp_rate_pct_delta: 0,
            avg_turnaround_min_delta: 0,
            gate_utilization_avg_pct_delta: 0,
            delay_avg_min_delta: 0,
            intervention_cost_delta: 0,
          },
          actions: [],
          validation_run_id: "run-baseline",
          validation_pass_fail: true,
        },
        best_option: {
          option_id: "opt_001",
          feasible: true,
          violation_penalty: 0,
          intervention_cost: 12,
          estimated_airport_kpis: {
            otp_rate_pct: 88,
            avg_turnaround_min: 51,
            gate_utilization_avg_pct: 89,
            delay_avg_min: 7,
          },
          validated_airport_kpis: {
            otp_rate_pct: 88,
            avg_turnaround_min: 51,
            gate_utilization_avg_pct: 89,
            delay_avg_min: 7,
          },
          delta_to_baseline: {
            otp_rate_pct_delta: 6,
            avg_turnaround_min_delta: -6,
            gate_utilization_avg_pct_delta: -4,
            delay_avg_min_delta: -6,
            intervention_cost_delta: 12,
          },
          actions: [
            {
              at_ms: 8000,
              target: "gates_open_pct",
              action: "inject",
              value: 4,
              cost_component: 4,
            },
          ],
          validation_run_id: "run-best",
          validation_pass_fail: true,
        },
        pareto_options: [],
        artifacts: [],
      },
    );

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(reportBlob).not.toBeNull();
    const reportText = await reportBlob!.text();
    expect(reportText).toContain("Baseline vs. Empfehlung");
    expect(reportText).toContain("Empfohlene Actions");
    blobSpy.mockRestore();
    revokeSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("embeds forecast context in the HTML report when forecast playbook data is present", async () => {
    const popup = {
      closed: false,
      addEventListener: vi.fn(),
      print: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    let reportBlob: Blob | null = null;
    const blobSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob?: Blob | MediaSource) => {
        reportBlob = blob instanceof Blob ? blob : null;
        return "blob:forecast-report";
      });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    generateTestReport(
      { ...INITIAL_STATE, remoteRunId: "run-forecast-1" },
      {
        gatesTotal: 28,
        gatesOpenPct: 96,
        arrivalsPerHour: 24,
        departuresPerHour: 24,
        baseTurnaroundMin: 44,
        groundCrewTeams: 14,
        crewCapacityFlightsPerHour: 2,
        baggageCapacityFlightsPerHour: 26,
        runwaySlotsPerHour: 28,
        twinApiBaseUrl: "http://127.0.0.1:8000",
        twinProfileId: "airport_medium_eu_v1",
        twinRealtimeMode: "hil_realtime",
        twinSeedBase: 2026,
      },
      8,
      {
        status: { job_id: "pb-forecast-1", state: "completed", progress: 100 },
        request: {
          source_kind: "config_snapshot",
          forecast_horizon_min: 60,
        },
        build_meta: {
          forecast_mode: true,
          forecast_source_kind: "config_snapshot",
          forecast_horizon_min: 60,
          derived_forecast_scenario_id: "forecast_pb-forecast-1_config_snapshot_v1",
          derived_forecast_model_pack_id: "forecast_pb-forecast-1_model_v1",
        },
        baseline_option: {
          option_id: "baseline",
          feasible: true,
          violation_penalty: 0,
          intervention_cost: 0,
          estimated_airport_kpis: {
            otp_rate_pct: 86,
            avg_turnaround_min: 52,
            gate_utilization_avg_pct: 89,
            delay_avg_min: 8,
          },
          validated_airport_kpis: {
            otp_rate_pct: 86,
            avg_turnaround_min: 52,
            gate_utilization_avg_pct: 89,
            delay_avg_min: 8,
          },
          delta_to_baseline: {
            otp_rate_pct_delta: 0,
            avg_turnaround_min_delta: 0,
            gate_utilization_avg_pct_delta: 0,
            delay_avg_min_delta: 0,
            intervention_cost_delta: 0,
          },
          actions: [],
          validation_run_id: "run-forecast-baseline",
          validation_pass_fail: true,
        },
        best_option: {
          option_id: "opt_003",
          feasible: true,
          violation_penalty: 0,
          intervention_cost: 8,
          estimated_airport_kpis: {
            otp_rate_pct: 89,
            avg_turnaround_min: 49,
            gate_utilization_avg_pct: 86,
            delay_avg_min: 6,
          },
          validated_airport_kpis: {
            otp_rate_pct: 89,
            avg_turnaround_min: 49,
            gate_utilization_avg_pct: 86,
            delay_avg_min: 6,
          },
          delta_to_baseline: {
            otp_rate_pct_delta: 3,
            avg_turnaround_min_delta: -3,
            gate_utilization_avg_pct_delta: -3,
            delay_avg_min_delta: -2,
            intervention_cost_delta: 8,
          },
          actions: [
            {
              at_ms: 12000,
              target: "ground_crew_teams",
              action: "inject",
              value: 2,
              cost_component: 12,
            },
          ],
          validation_run_id: "run-forecast-best",
          validation_pass_fail: true,
        },
        pareto_options: [],
        artifacts: [],
      },
    );

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(reportBlob).not.toBeNull();
    const reportText = await reportBlob!.text();
    expect(reportText).toContain("Forecast-Kontext");
    expect(reportText).toContain("Forecast-Empfehlung");
    expect(reportText).toContain("Erwarteter Effekt");
    expect(reportText).toContain("Aktuelle Konfiguration");
    expect(reportText).toContain("forecast_pb-forecast-1_config_snapshot_v1");
    blobSpy.mockRestore();
    revokeSpy.mockRestore();
    openSpy.mockRestore();
  });
});
