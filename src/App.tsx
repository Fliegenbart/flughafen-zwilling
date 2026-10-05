/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./ui/operationsStudio.css";
import "./App.css";
import { chartTokens } from "./ui/chartTheme";
import { REPORT_STYLES } from "./ui/reportStyles";
import { StudioHeader } from "./ui/StudioHeader";

export type RemoteRunState = "queued" | "running" | "completed" | "failed" | null;
export type RemoteApiStatus = "unknown" | "checking" | "ok" | "down";
export type PlannerJobState = "queued" | "running" | "completed" | "failed" | null;
export type PlannerMode = "scenario" | "forecast";
export type ForecastSourceKind = "config_snapshot" | "run_snapshot";

interface CapabilitiesResponse {
  playbook_synth_enabled?: boolean;
  telemetry_stream_enabled?: boolean;
  grafana_base_url?: string | null;
}

interface TelemetrySliceResponse {
  items?: any[];
  next_cursor?: number;
  complete?: boolean;
}

interface PlaybookActionClient {
  at_ms: number;
  target: string;
  action: "inject" | "set";
  value: number;
  cost_component: number;
}

interface AirportKpiSummaryClient {
  otp_rate_pct: number;
  avg_turnaround_min: number;
  gate_utilization_avg_pct: number;
  delay_avg_min: number;
}

interface PlaybookDeltaClient {
  otp_rate_pct_delta: number;
  avg_turnaround_min_delta: number;
  gate_utilization_avg_pct_delta: number;
  delay_avg_min_delta: number;
  intervention_cost_delta: number;
}

interface PlaybookOptionClient {
  option_id: string;
  feasible: boolean;
  violation_penalty: number;
  intervention_cost: number;
  estimated_airport_kpis: AirportKpiSummaryClient;
  // Backend-Feldname bleibt (Rueckwaertskompatibilitaet); Inhalt = KPIs des
  // modellinternen Gegenpruef-Laufs, keine empirisch validierten Werte.
  validated_airport_kpis?: AirportKpiSummaryClient | null;
  delta_to_baseline?: PlaybookDeltaClient | null;
  actions: PlaybookActionClient[];
  validation_run_id: string | null;
  validation_pass_fail: boolean | null;
}

interface PlaybookRequestClient {
  seed?: number;
  scenario_id?: string | null;
  model_pack_id?: string | null;
  source_kind?: "scenario" | "config_snapshot" | "run_snapshot";
  forecast_horizon_min?: number | null;
  source_run_id?: string | null;
  config_snapshot?: Record<string, number | string | boolean> | null;
}

interface PlaybookJobPayloadClient extends PlaybookRequestClient {
  seed: number;
  search_budget_sec: number;
  max_options: number;
  constraints: {
    otp_min_pct: number;
    turnaround_max_min: number;
    gate_utilization_max_pct: number;
  };
  metadata: Record<string, string>;
}

interface PlaybookRecordClient {
  status: {
    job_id: string;
    state: Exclude<PlannerJobState, null>;
    progress: number;
    error?: string | null;
  };
  request?: PlaybookRequestClient;
  model_pack_snapshot?: { parameter_set: Record<string, number | string | boolean> } | null;
  baseline_option?: PlaybookOptionClient | null;
  best_option: PlaybookOptionClient | null;
  pareto_options: PlaybookOptionClient[];
  artifacts: string[];
  build_meta?: Record<string, unknown>;
}

interface AirportConfig {
  gatesTotal: number;
  gatesOpenPct: number;
  arrivalsPerHour: number;
  departuresPerHour: number;
  baseTurnaroundMin: number;
  groundCrewTeams: number;
  crewCapacityFlightsPerHour: number;
  baggageCapacityFlightsPerHour: number;
  runwaySlotsPerHour: number;
  twinApiBaseUrl: string;
  twinProfileId: string;
  twinRealtimeMode: "hil_realtime" | "sil";
  twinSeedBase: number;
}

interface ChartPoint {
  t: number;
  otp: number;
  turnaround: number;
  gateUtil: number;
  crewUtil: number;
  depQueue: number;
  bagQueue: number;
  delay: number;
}

interface AirportState {
  dataLog: ChartPoint[];
  remoteRunId: string | null;
  remoteRunState: RemoteRunState;
  remoteRunProgress: number;
  remoteApiStatus: RemoteApiStatus;
  remoteApiLatencyMs: number | null;
  passFail: boolean | null;
  tickDriftAvgMs: number;
  tickDriftMaxMs: number;
  tickDriftP99Ms: number;
  auditFingerprintSha256: string;
  watchdogConfigLoaded: boolean;
  watchdogTicksOk: number;
  watchdogMisses: number;
  watchdogFailSafe: boolean;
  watchdogFailReason: string;
  otpRatePct: number;
  avgTurnaroundMin: number;
  gateUtilizationAvgPct: number;
  groundCrewUtilizationAvgPct: number;
  departureQueueAvgFlights: number;
  baggageQueueAvgFlights: number;
  delayAvgMin: number;
}

type CaseDisturbanceTarget =
  | "gate_blockage_pct"
  | "weather_restriction_pct"
  | "baggage_jam_pct"
  | "staffing_shortage_pct"
  | "security_delay_min"
  | "deicing_delay_min"
  | "runway_slot_reduction_pct";

interface CaseDefinition {
  id: number;
  name: string;
  description: string;
  scenarioId: string;
  durationMs: number;
  tickMs: number;
  timelineEvents: Array<{
    at_ms: number;
    action: "set" | "toggle" | "inject";
    target: string;
    value: number;
  }>;
  disturbances: Array<{
    name: string;
    target: CaseDisturbanceTarget;
    start_ms: number;
    duration_ms: number;
    magnitude: number;
  }>;
  expectedAssertions: Array<{
    name: string;
    metric: string;
    op: "<" | "<=" | ">" | ">=" | "==" | "!=";
    threshold: number;
  }>;
}

const CHART_COLORS = {
  otp: chartTokens.series.primary,
  turnaround: chartTokens.series.amber,
  delay: chartTokens.series.red,
  gate: chartTokens.series.green,
  crew: chartTokens.series.teal,
  dep: chartTokens.series.red,
  bag: chartTokens.series.amber,
  axis: chartTokens.axis,
  grid: chartTokens.grid,
  tooltipBg: chartTokens.tooltip.background,
};

const DEFAULT_CASE_ASSERTIONS: CaseDefinition["expectedAssertions"] = [
  { name: "OTP", metric: "airport_kpis.otp_rate_pct", op: ">=", threshold: 85 },
  { name: "Turnaround", metric: "airport_kpis.avg_turnaround_min", op: "<=", threshold: 55 },
  {
    name: "Gate Utilization",
    metric: "airport_kpis.gate_utilization_avg_pct",
    op: "<=",
    threshold: 92,
  },
];

const CASE_DEFINITIONS: CaseDefinition[] = [
  {
    id: 1,
    name: "Spitzenwelle",
    description: "Arrival/Departure-Injection plus moderate Gate-Blockade",
    scenarioId: "airport_case_01_spitzenwelle_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [
      { at_ms: 8000, action: "inject", target: "arrivals_per_hour", value: 3.5 },
      { at_ms: 18000, action: "inject", target: "departures_per_hour", value: 2.5 },
    ],
    disturbances: [
      {
        name: "stand-pressure",
        target: "gate_blockage_pct",
        start_ms: 12000,
        duration_ms: 17000,
        magnitude: 12.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 2,
    name: "Guillotine-Test",
    description: "Harter gleichzeitiger Einbruch von Gates, Slots und Personal",
    scenarioId: "airport_case_02_guillotine_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [],
    disturbances: [
      {
        name: "gate-collapse",
        target: "gate_blockage_pct",
        start_ms: 12000,
        duration_ms: 18000,
        magnitude: 34.0,
      },
      {
        name: "runway-collapse",
        target: "runway_slot_reduction_pct",
        start_ms: 12000,
        duration_ms: 18000,
        magnitude: 32.0,
      },
      {
        name: "staff-collapse",
        target: "staffing_shortage_pct",
        start_ms: 12000,
        duration_ms: 18000,
        magnitude: 30.0,
      },
      {
        name: "security-spike",
        target: "security_delay_min",
        start_ms: 12000,
        duration_ms: 9000,
        magnitude: 8.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 3,
    name: "Wetter-Kompression",
    description: "Wetter drueckt Runway-Slots und verlaengert Turnaround",
    scenarioId: "airport_case_03_wetter_kompression_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [],
    disturbances: [
      {
        name: "weather-window",
        target: "weather_restriction_pct",
        start_ms: 10000,
        duration_ms: 22000,
        magnitude: 20.0,
      },
      {
        name: "slot-cut",
        target: "runway_slot_reduction_pct",
        start_ms: 10000,
        duration_ms: 22000,
        magnitude: 18.0,
      },
      {
        name: "deicing-add",
        target: "deicing_delay_min",
        start_ms: 12000,
        duration_ms: 17000,
        magnitude: 4.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 4,
    name: "Gepaeckstau",
    description: "Gepaecksystem-Engpass mit Security-Verzoegerung und Arrival-Boost",
    scenarioId: "airport_case_04_gepaeckstau_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [{ at_ms: 9000, action: "inject", target: "arrivals_per_hour", value: 2.0 }],
    disturbances: [
      {
        name: "baggage-jam",
        target: "baggage_jam_pct",
        start_ms: 12000,
        duration_ms: 22000,
        magnitude: 33.0,
      },
      {
        name: "security-wave",
        target: "security_delay_min",
        start_ms: 14000,
        duration_ms: 17000,
        magnitude: 5.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 5,
    name: "Personalengpass",
    description: "Starker Personalausfall plus leichte Gate-Blockade",
    scenarioId: "airport_case_05_personalengpass_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [],
    disturbances: [
      {
        name: "staffing-shortage",
        target: "staffing_shortage_pct",
        start_ms: 9000,
        duration_ms: 24000,
        magnitude: 34.0,
      },
      {
        name: "light-gate-block",
        target: "gate_blockage_pct",
        start_ms: 11000,
        duration_ms: 17000,
        magnitude: 8.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 6,
    name: "Sicherheitswelle",
    description: "Hohe Security-Verzoegerung mit kleinem Personalengpass",
    scenarioId: "airport_case_06_sicherheitswelle_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [],
    disturbances: [
      {
        name: "security-burst",
        target: "security_delay_min",
        start_ms: 10000,
        duration_ms: 23000,
        magnitude: 10.0,
      },
      {
        name: "staffing-dip",
        target: "staffing_shortage_pct",
        start_ms: 12000,
        duration_ms: 17000,
        magnitude: 12.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 7,
    name: "Enteisungsfenster",
    description: "Enteisung plus Wetterrestriktion mit reduzierten Runway-Slots",
    scenarioId: "airport_case_07_enteisungsfenster_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [],
    disturbances: [
      {
        name: "deicing-window",
        target: "deicing_delay_min",
        start_ms: 10000,
        duration_ms: 25000,
        magnitude: 12.0,
      },
      {
        name: "weather-restrict",
        target: "weather_restriction_pct",
        start_ms: 10000,
        duration_ms: 25000,
        magnitude: 16.0,
      },
      {
        name: "slot-drop",
        target: "runway_slot_reduction_pct",
        start_ms: 10000,
        duration_ms: 25000,
        magnitude: 18.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
  {
    id: 8,
    name: "Schwarzstart",
    description: "Schwerer Startzustand mit restriktiver Phase und geplanter Recovery",
    scenarioId: "airport_case_08_schwarzstart_v1",
    durationMs: 60000,
    tickMs: 40,
    timelineEvents: [
      { at_ms: 28000, action: "inject", target: "ground_crew_teams", value: 3.0 },
      { at_ms: 30000, action: "inject", target: "gates_open_pct", value: 12.0 },
      { at_ms: 32000, action: "inject", target: "runway_slots_per_hour", value: 5.0 },
    ],
    disturbances: [
      {
        name: "initial-gate-lock",
        target: "gate_blockage_pct",
        start_ms: 0,
        duration_ms: 22000,
        magnitude: 44.0,
      },
      {
        name: "initial-staff-gap",
        target: "staffing_shortage_pct",
        start_ms: 0,
        duration_ms: 26000,
        magnitude: 40.0,
      },
      {
        name: "initial-slot-loss",
        target: "runway_slot_reduction_pct",
        start_ms: 0,
        duration_ms: 22000,
        magnitude: 42.0,
      },
      {
        name: "initial-weather-restriction",
        target: "weather_restriction_pct",
        start_ms: 0,
        duration_ms: 22000,
        magnitude: 34.0,
      },
    ],
    expectedAssertions: DEFAULT_CASE_ASSERTIONS,
  },
];

const CASE_BY_ID: Record<number, CaseDefinition> = Object.fromEntries(
  CASE_DEFINITIONS.map((testCase) => [testCase.id, testCase]),
);

const MQTT_TOPICS = [
  "airport/hil/turnaround/otp",
  "airport/hil/turnaround/avg_min",
  "airport/hil/gates/utilization",
  "airport/hil/ground/crew_utilization",
  "airport/hil/queue/departure",
  "airport/hil/queue/baggage",
  "airport/hil/delay/avg_min",
];

function resolveRuntimeConfigUrl(
  runtimeKey: "apiBaseUrl" | "grafanaBaseUrl",
  envKey: "VITE_TWIN_API_BASE_URL" | "VITE_TWIN_GRAFANA_BASE_URL",
  fallback: string,
) {
  const runtimeUrl = globalThis?.__TWIN_CONFIG__?.[runtimeKey];
  if (typeof runtimeUrl === "string" && runtimeUrl.trim()) {
    return runtimeUrl.trim();
  }

  const env =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : {};
  const envUrl = env?.[envKey] || "";
  if (typeof envUrl === "string" && envUrl.trim()) {
    return envUrl.trim();
  }

  return fallback;
}

function resolveTwinApiBaseUrl() {
  return resolveRuntimeConfigUrl("apiBaseUrl", "VITE_TWIN_API_BASE_URL", window.location.origin);
}

function resolveTwinGrafanaBaseUrl() {
  if (globalThis.__TWIN_CONFIG__?.grafanaBaseUrl === "") return "";
  return resolveRuntimeConfigUrl(
    "grafanaBaseUrl",
    "VITE_TWIN_GRAFANA_BASE_URL",
    "http://127.0.0.1:3000",
  );
}

function parseAbsoluteUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isLocalLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function suggestLocalObservabilityApiBase(currentApiBase: string) {
  if (globalThis.__TWIN_CONFIG__?.allowLocalApiFallback !== true) return "";
  const parsed = parseAbsoluteUrl(normalizeBaseUrl(currentApiBase));
  const pageHost = typeof window !== "undefined" ? window.location.hostname : "";
  const candidateHost =
    parsed && isLocalLoopbackHost(parsed.hostname)
      ? parsed.hostname
      : isLocalLoopbackHost(pageHost)
        ? pageHost
        : "";
  if (!candidateHost) {
    return "";
  }
  const protocol = parsed?.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${candidateHost}:8000`;
}

function buildGrafanaRunUrl(grafanaBase: string, runId: string | null) {
  const base = normalizeBaseUrl(grafanaBase);
  if (!base || !runId) {
    return "";
  }
  const params = new URLSearchParams({
    orgId: "1",
    from: "now-24h",
    to: "now",
    "var-run_id": runId,
  });
  return `${base}/d/airport-twin-cockpit/airport-twin-cockpit?${params.toString()}`;
}

const DEFAULT_CONFIG: AirportConfig = {
  gatesTotal: 28,
  gatesOpenPct: 96,
  arrivalsPerHour: 24,
  departuresPerHour: 24,
  baseTurnaroundMin: 44,
  groundCrewTeams: 14,
  crewCapacityFlightsPerHour: 1.8,
  baggageCapacityFlightsPerHour: 26,
  runwaySlotsPerHour: 28,
  twinApiBaseUrl: resolveTwinApiBaseUrl(),
  twinProfileId: "airport_medium_eu_v1",
  twinRealtimeMode: "hil_realtime",
  twinSeedBase: 20260221,
};

export const INITIAL_STATE: AirportState = {
  dataLog: [],
  remoteRunId: null,
  remoteRunState: null,
  remoteRunProgress: 0,
  remoteApiStatus: "unknown",
  remoteApiLatencyMs: null,
  passFail: null,
  tickDriftAvgMs: 0,
  tickDriftMaxMs: 0,
  tickDriftP99Ms: 0,
  auditFingerprintSha256: "",
  watchdogConfigLoaded: false,
  watchdogTicksOk: 0,
  watchdogMisses: 0,
  watchdogFailSafe: false,
  watchdogFailReason: "",
  otpRatePct: 0,
  avgTurnaroundMin: 0,
  gateUtilizationAvgPct: 0,
  groundCrewUtilizationAvgPct: 0,
  departureQueueAvgFlights: 0,
  baggageQueueAvgFlights: 0,
  delayAvgMin: 0,
};

function normalizeBaseUrl(url: string) {
  return (url || "").trim().replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url: string, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: ctrl.signal });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json())?.detail || "";
      } catch (_) {
        detail = "";
      }
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
    }
    if (response.status === 204) return null;
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseTelemetryJsonl(text: string): any[] {
  if (!text || !text.trim()) return [];
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function buildTwinScenario(testId: number, c: AirportConfig) {
  const testCase = CASE_BY_ID[testId] || CASE_DEFINITIONS[0]!;
  const base = {
    id: testCase.scenarioId,
    version: "1.0.0",
    domain: "airport_turnaround_v1",
    description: testCase.description,
    duration_ms: testCase.durationMs,
    tick_ms: testCase.tickMs,
    timeline_events: testCase.timelineEvents,
    disturbances: testCase.disturbances,
    expected_assertions: testCase.expectedAssertions,
    metadata: {
      test_id: testId,
      case_name: testCase.name,
      source: "airport-twin-ui",
      profile: c.twinProfileId,
    },
  };

  return base;
}

function buildTwinModelPack(c: AirportConfig) {
  return {
    id: "airport_medium_eu_v1",
    site_profile: "airport-medium-eu",
    assets: [
      {
        id: "gates-main",
        type: "gates",
        name: "Terminal Main Gates",
        limits: { count: c.gatesTotal },
      },
      {
        id: "ground-ops",
        type: "ground_ops",
        name: "Ground Operations",
        limits: { crew_teams: c.groundCrewTeams },
      },
      {
        id: "runway-ops",
        type: "runway",
        name: "Runway Slots",
        limits: { slots_per_hour: c.runwaySlotsPerHour },
      },
    ],
    parameter_set: {
      gates_total: c.gatesTotal,
      gates_open_pct: c.gatesOpenPct,
      arrivals_per_hour: c.arrivalsPerHour,
      departures_per_hour: c.departuresPerHour,
      base_turnaround_min: c.baseTurnaroundMin,
      ground_crew_teams: c.groundCrewTeams,
      crew_capacity_flights_per_hour: c.crewCapacityFlightsPerHour,
      baggage_capacity_flights_per_hour: c.baggageCapacityFlightsPerHour,
      runway_slots_per_hour: c.runwaySlotsPerHour,
    },
    calibration_meta: {
      source: "airport-twin-ui",
      profile: c.twinProfileId,
      ts: new Date().toISOString(),
    },
  };
}

function buildPlannerConfigSnapshot(c: AirportConfig) {
  return {
    gates_total: c.gatesTotal,
    gates_open_pct: c.gatesOpenPct,
    arrivals_per_hour: c.arrivalsPerHour,
    departures_per_hour: c.departuresPerHour,
    base_turnaround_min: c.baseTurnaroundMin,
    ground_crew_teams: c.groundCrewTeams,
    crew_capacity_flights_per_hour: c.crewCapacityFlightsPerHour,
    baggage_capacity_flights_per_hour: c.baggageCapacityFlightsPerHour,
    runway_slots_per_hour: c.runwaySlotsPerHour,
  };
}

function forecastSourceLabel(sourceKind: string | null | undefined) {
  if (sourceKind === "config_snapshot") return "Aktuelle Konfiguration";
  if (sourceKind === "run_snapshot") return "Letzten Run verwenden";
  return "Szenario";
}

export function buildPlaybookJobPayload(args: {
  plannerMode: PlannerMode;
  forecastSource: ForecastSourceKind;
  forecastHorizonMin: number;
  selectedTest: number;
  config: AirportConfig;
  selectedCaseName: string;
  remoteRunId: string | null;
}): PlaybookJobPayloadClient {
  const scenario = buildTwinScenario(args.selectedTest, args.config);
  const modelPack = buildTwinModelPack(args.config);
  const basePayload = {
    seed: args.config.twinSeedBase + args.selectedTest,
    search_budget_sec: 60,
    max_options: 5,
    constraints: {
      otp_min_pct: 85,
      turnaround_max_min: 55,
      gate_utilization_max_pct: 92,
    },
    metadata: {
      source: "airport-twin-ui",
      case_name: args.selectedCaseName,
      planner_mode: args.plannerMode,
    },
  };

  if (args.plannerMode === "scenario") {
    return {
      ...basePayload,
      source_kind: "scenario" as const,
      scenario_id: scenario.id,
      model_pack_id: modelPack.id,
    };
  }

  if (args.forecastSource === "config_snapshot") {
    return {
      ...basePayload,
      source_kind: "config_snapshot" as const,
      scenario_id: scenario.id,
      model_pack_id: modelPack.id,
      forecast_horizon_min: args.forecastHorizonMin,
      config_snapshot: buildPlannerConfigSnapshot(args.config),
      metadata: {
        ...basePayload.metadata,
        forecast_source: args.forecastSource,
      },
    };
  }

  if (!args.remoteRunId) {
    throw new Error("Kein Ausgangs-Run fuer Forecast verfuegbar.");
  }

  return {
    ...basePayload,
    source_kind: "run_snapshot" as const,
    source_run_id: args.remoteRunId,
    forecast_horizon_min: args.forecastHorizonMin,
    metadata: {
      ...basePayload.metadata,
      forecast_source: args.forecastSource,
    },
  };
}

// Drei Zustaende der modellinternen Gegenpruefung (Audit-Run im selben Modell).
// Das ist keine empirische Validierung gegen Messdaten.
const MODEL_CHECK_NOTE = "modellintern, keine empirische Validierung";

function modelCheckLabel(passFail: boolean | null | undefined): string {
  if (passFail === true) return "Modell-Gegenprüfung bestanden";
  if (passFail === false) return "Modell-Gegenprüfung nicht bestanden";
  return "Modell-Gegenprüfung nicht geprüft";
}

function modelCheckText(passFail: boolean | null | undefined): string {
  return `${modelCheckLabel(passFail)} (${MODEL_CHECK_NOTE})`;
}

function pickOptionKpis(
  option: PlaybookOptionClient | null | undefined,
): AirportKpiSummaryClient | null {
  if (!option) return null;
  return option.validated_airport_kpis || option.estimated_airport_kpis || null;
}

function formatSigned(value: number, digits = 2, unit = "") {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}${unit}`;
}

function deltaClass(value: number, direction: "higher_is_better" | "lower_is_better") {
  if (Math.abs(value) < 0.0001) return "delta delta--neutral";
  const isGood = direction === "higher_is_better" ? value > 0 : value < 0;
  return isGood ? "delta delta--good" : "delta delta--bad";
}

function actionTargetLabel(target: string) {
  if (target === "gates_open_pct") return "mehr Gates freischalten";
  if (target === "ground_crew_teams") return "Ground-Crew aufstocken";
  if (target === "runway_slots_per_hour") return "Runway-Slots erhoehen";
  if (target === "baggage_capacity_flights_per_hour") return "Gepaeckkapazitaet erhoehen";
  if (target === "departures_per_hour") return "Departures takten";
  return target;
}

function actionSummaryText(action: PlaybookActionClient) {
  const prefix = action.value > 0 ? "+" : "";
  return `t=${action.at_ms}ms ${actionTargetLabel(action.target)} (${prefix}${action.value})`;
}

function buildForecastNarrative(record: PlaybookRecordClient | null | undefined) {
  if (
    !record ||
    !(
      record.build_meta?.forecast_mode ||
      record.request?.source_kind === "config_snapshot" ||
      record.request?.source_kind === "run_snapshot"
    ) ||
    !record.baseline_option ||
    !record.best_option
  ) {
    return null;
  }

  const baseline = record.baseline_option;
  const best = record.best_option;
  const baselineKpis = pickOptionKpis(baseline);
  const bestKpis = pickOptionKpis(best);
  if (!baselineKpis || !bestKpis) {
    return null;
  }

  const sourceLabel = forecastSourceLabel(
    String(record.build_meta?.forecast_source_kind || record.request?.source_kind || "scenario"),
  );
  const horizon = String(
    record.build_meta?.forecast_horizon_min || record.request?.forecast_horizon_min || "n/a",
  );
  const delta = best.delta_to_baseline || {
    otp_rate_pct_delta: 0,
    avg_turnaround_min_delta: 0,
    gate_utilization_avg_pct_delta: 0,
    delay_avg_min_delta: 0,
    intervention_cost_delta: 0,
  };
  const actionPreview = best.actions.length
    ? best.actions
        .slice(0, 3)
        .map((action) => actionSummaryText(action))
        .join(" · ")
    : "Keine Intervention empfohlen.";

  const title =
    best.actions.length > 0
      ? `Forecast-Empfehlung fuer die naechsten ${horizon} Minuten`
      : `Forecast stabil ohne zusaetzlichen Eingriff`;
  const baselineLine = `Ohne Eingriff laeuft die Projektion bei OTP ${baselineKpis.otp_rate_pct.toFixed(
    1,
  )}%, Turnaround ${baselineKpis.avg_turnaround_min.toFixed(1)} min und Delay ${baselineKpis.delay_avg_min.toFixed(1)} min.`;
  const actionLine =
    best.actions.length > 0
      ? `Empfohlen wird ${best.actions.length}x Eingriff aus Quelle ${sourceLabel}: ${actionPreview}`
      : `Aus Quelle ${sourceLabel} ist im Forecast aktuell kein zusaetzlicher Eingriff notwendig.`;
  const effectLine =
    Math.abs(delta.otp_rate_pct_delta) < 0.01 &&
    Math.abs(delta.avg_turnaround_min_delta) < 0.01 &&
    Math.abs(delta.delay_avg_min_delta) < 0.01
      ? "Erwarteter Effekt: Die Baseline bleibt die beste Option innerhalb des aktuellen Forecast-Horizonts."
      : `Erwarteter Effekt: OTP ${formatSigned(delta.otp_rate_pct_delta, 2, "%")}, Turnaround ${formatSigned(
          delta.avg_turnaround_min_delta,
          2,
          " min",
        )}, Delay ${formatSigned(delta.delay_avg_min_delta, 2, " min")}.`;

  return {
    title,
    baselineLine,
    actionLine,
    effectLine,
  };
}

export function stateFromTwinRecord(
  prev: AirportState,
  record: any,
  telemetry: any[],
  safety: any,
): AirportState {
  const summary = record?.summary || {};
  const kpi = summary?.airport_kpis || {};
  const status = record?.status || {};
  const watchdog = safety?.watchdog_summary || record?.watchdog_summary || {};

  const byTs = new Map<number, ChartPoint>();
  for (const sample of telemetry) {
    if (!byTs.has(sample.ts)) {
      byTs.set(sample.ts, {
        t: sample.ts,
        otp: 0,
        turnaround: 0,
        gateUtil: 0,
        crewUtil: 0,
        depQueue: 0,
        bagQueue: 0,
        delay: 0,
      });
    }
    const row = byTs.get(sample.ts)!;
    if (sample.metric === "otp_pct") row.otp = Number(sample.value);
    else if (sample.metric === "turnaround_avg_min") row.turnaround = Number(sample.value);
    else if (sample.metric === "gate_utilization_pct") row.gateUtil = Number(sample.value);
    else if (sample.metric === "ground_crew_utilization_pct") row.crewUtil = Number(sample.value);
    else if (sample.metric === "departure_queue_flights") row.depQueue = Number(sample.value);
    else if (sample.metric === "baggage_queue_flights") row.bagQueue = Number(sample.value);
    else if (sample.metric === "delay_avg_min") row.delay = Number(sample.value);
  }

  const dataLog = Array.from(byTs.values()).sort((a, b) => a.t - b.t);
  const latestPoint = dataLog.length ? dataLog[dataLog.length - 1] : null;

  return {
    ...prev,
    dataLog,
    remoteRunId: status.run_id || prev.remoteRunId,
    remoteRunState: status.state || prev.remoteRunState,
    remoteRunProgress: Number(status.progress ?? prev.remoteRunProgress ?? 0),
    passFail: status.pass_fail ?? prev.passFail,
    otpRatePct: Number(kpi.otp_rate_pct ?? latestPoint?.otp ?? prev.otpRatePct ?? 0),
    avgTurnaroundMin: Number(
      kpi.avg_turnaround_min ?? latestPoint?.turnaround ?? prev.avgTurnaroundMin ?? 0,
    ),
    gateUtilizationAvgPct: Number(
      kpi.gate_utilization_avg_pct ?? latestPoint?.gateUtil ?? prev.gateUtilizationAvgPct ?? 0,
    ),
    groundCrewUtilizationAvgPct: Number(
      kpi.ground_crew_utilization_avg_pct ??
        latestPoint?.crewUtil ??
        prev.groundCrewUtilizationAvgPct ??
        0,
    ),
    departureQueueAvgFlights: Number(
      kpi.departure_queue_avg_flights ??
        latestPoint?.depQueue ??
        prev.departureQueueAvgFlights ??
        0,
    ),
    baggageQueueAvgFlights: Number(
      kpi.baggage_queue_avg_flights ?? latestPoint?.bagQueue ?? prev.baggageQueueAvgFlights ?? 0,
    ),
    delayAvgMin: Number(kpi.delay_avg_min ?? latestPoint?.delay ?? prev.delayAvgMin ?? 0),
    tickDriftAvgMs: Number(summary.tick_drift_avg_ms ?? prev.tickDriftAvgMs ?? 0),
    tickDriftMaxMs: Number(summary.tick_drift_max_ms ?? prev.tickDriftMaxMs ?? 0),
    tickDriftP99Ms: Number(summary.tick_drift_p99_ms ?? prev.tickDriftP99Ms ?? 0),
    auditFingerprintSha256: String(
      summary.audit_fingerprint_sha256 || prev.auditFingerprintSha256 || "",
    ),
    watchdogConfigLoaded: Boolean(watchdog.watchdog_config_loaded),
    watchdogTicksOk: Number(watchdog.watchdog_ticks_ok ?? 0),
    watchdogMisses: Number(watchdog.watchdog_misses ?? 0),
    watchdogFailSafe: Boolean(watchdog.watchdog_fail_safe),
    watchdogFailReason: String(watchdog.fail_reason || ""),
  };
}

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

function StatCard({ label, value, unit, tone }: StatCardProps) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">
        {value}
        <span className="stat-card__unit">{unit}</span>
      </div>
    </div>
  );
}

interface LabeledInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

function LabeledInput({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
}: LabeledInputProps) {
  return (
    <label className="control-field">
      <span className="control-field__label">{label}</span>
      <input
        className="control-field__input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function generateTestReport(
  state: AirportState,
  config: AirportConfig,
  testId: number,
  playbookRecord?: PlaybookRecordClient | null,
) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const test = CASE_BY_ID[testId] || { name: "Unbekannter Testfall", description: "n/a" };
  const pass = state.passFail === true;
  const baseline = playbookRecord?.baseline_option || null;
  const recommended = playbookRecord?.best_option || null;
  const baselineKpis = pickOptionKpis(baseline);
  const recommendedKpis = pickOptionKpis(recommended);
  const alternatives = playbookRecord?.pareto_options || [];
  const forecastMode = Boolean(
    playbookRecord?.build_meta?.forecast_mode ||
    playbookRecord?.request?.source_kind === "run_snapshot" ||
    playbookRecord?.request?.source_kind === "config_snapshot",
  );
  const forecastSource = String(
    playbookRecord?.build_meta?.forecast_source_kind ||
      playbookRecord?.request?.source_kind ||
      "scenario",
  );
  const forecastNarrative = buildForecastNarrative(playbookRecord);
  const forecastSection = forecastMode
    ? `
  <div class="config">
    <b>Forecast-Kontext</b><br />
    Quelle: ${forecastSourceLabel(forecastSource)}<br />
    Horizont: ${String(playbookRecord?.build_meta?.forecast_horizon_min || playbookRecord?.request?.forecast_horizon_min || "n/a")} min<br />
    Source Run ID: <span class="code">${String(playbookRecord?.build_meta?.source_run_id || playbookRecord?.request?.source_run_id || "n/a")}</span><br />
    Derived Scenario: <span class="code">${String(playbookRecord?.build_meta?.derived_forecast_scenario_id || "n/a")}</span><br />
    Derived Model Pack: <span class="code">${String(playbookRecord?.build_meta?.derived_forecast_model_pack_id || "n/a")}</span>
  </div>
  ${
    forecastNarrative
      ? `<div class="config">
    <b>${forecastNarrative.title}</b><br />
    ${forecastNarrative.baselineLine}<br />
    ${forecastNarrative.actionLine}<br />
    ${forecastNarrative.effectLine}
  </div>`
      : ""
  }`
    : "";
  const compareSection =
    baseline && recommended && baselineKpis && recommendedKpis
      ? `
  <div class="compare">
    <h2>Baseline vs. Empfehlung</h2>
    <table>
      <tr><th>Option</th><th>OTP</th><th>Turnaround</th><th>Gate Util</th><th>Delay</th><th>Kosten</th><th>Modell-Gegenprüfung (modellintern)</th></tr>
      <tr><td>Baseline</td><td>${baselineKpis.otp_rate_pct.toFixed(2)}%</td><td>${baselineKpis.avg_turnaround_min.toFixed(2)} min</td><td>${baselineKpis.gate_utilization_avg_pct.toFixed(2)}%</td><td>${baselineKpis.delay_avg_min.toFixed(2)} min</td><td>${baseline.intervention_cost.toFixed(2)}</td><td>${modelCheckText(baseline.validation_pass_fail)}</td></tr>
      <tr><td>Empfehlung</td><td>${recommendedKpis.otp_rate_pct.toFixed(2)}%</td><td>${recommendedKpis.avg_turnaround_min.toFixed(2)} min</td><td>${recommendedKpis.gate_utilization_avg_pct.toFixed(2)}%</td><td>${recommendedKpis.delay_avg_min.toFixed(2)} min</td><td>${recommended.intervention_cost.toFixed(2)}</td><td>${modelCheckText(recommended.validation_pass_fail)}</td></tr>
    </table>
    <div class="config">
      <b>Wichtigste Deltas</b><br />
      OTP: ${formatSigned(recommended.delta_to_baseline?.otp_rate_pct_delta || 0, 2, "%")} |
      Turnaround: ${formatSigned(recommended.delta_to_baseline?.avg_turnaround_min_delta || 0, 2, " min")} |
      Gate Util: ${formatSigned(recommended.delta_to_baseline?.gate_utilization_avg_pct_delta || 0, 2, "%")} |
      Delay: ${formatSigned(recommended.delta_to_baseline?.delay_avg_min_delta || 0, 2, " min")} |
      Kosten: ${formatSigned(recommended.delta_to_baseline?.intervention_cost_delta || 0)}
    </div>
    <div class="config">
      <b>Empfohlene Actions</b><br />
      ${
        recommended.actions.length
          ? recommended.actions
              .map(
                (action) =>
                  `t=${action.at_ms}ms · ${action.action} ${action.target} ${action.value > 0 ? "+" : ""}${action.value}`,
              )
              .join("<br />")
          : "Keine Intervention empfohlen."
      }
    </div>
    ${
      alternatives.length
        ? `<table>
      <tr><th>Alternative</th><th>OTP</th><th>Delay</th><th>Kosten</th><th>Delta OTP</th><th>Delta Delay</th></tr>
      ${alternatives
        .map((option) => {
          const optionKpis = pickOptionKpis(option);
          if (!optionKpis) return "";
          return `<tr><td>${option.option_id}</td><td>${optionKpis.otp_rate_pct.toFixed(2)}%</td><td>${optionKpis.delay_avg_min.toFixed(2)} min</td><td>${option.intervention_cost.toFixed(2)}</td><td>${formatSigned(option.delta_to_baseline?.otp_rate_pct_delta || 0, 2, "%")}</td><td>${formatSigned(option.delta_to_baseline?.delay_avg_min_delta || 0, 2, " min")}</td></tr>`;
        })
        .join("")}
    </table>`
        : ""
    }
  </div>`
      : "";

  const html = `<!DOCTYPE html><html data-report-theme="operations-studio"><head><meta charset="utf-8"><title>Airport Twin Core Report</title>
<style>${REPORT_STYLES}</style></head><body>
<div class="wrapper">
  <div class="head">
    <div class="brand">
      <h1>Airport Twin Core</h1>
      <small>Generiert: ${now}</small>
      <small>Unkalibriertes Demo-Modell. Keine Betriebsprognose oder empirische Validierung.</small>
    </div>
    <span class="badge ${pass ? "pass" : "fail"}">${pass ? "PASS" : "FAIL"}</span>
  </div>
  <div class="meta">
    <div><b>Szenario:</b> ${test.name}</div>
    <div><b>Beschreibung:</b> ${test.description}</div>
    <div><b>Run ID:</b> <span class="code">${state.remoteRunId || "n/a"}</span></div>
  </div>
  <table>
    <tr><th>KPI</th><th>Wert</th><th>Ziel</th><th>Status</th></tr>
    <tr><td>OTP</td><td>${state.otpRatePct.toFixed(2)}%</td><td>>= 85%</td><td class="${state.otpRatePct >= 85 ? "ok" : "ko"}">${state.otpRatePct >= 85 ? "PASS" : "FAIL"}</td></tr>
    <tr><td>Durchschnitt Turnaround</td><td>${state.avgTurnaroundMin.toFixed(2)} min</td><td><= 55 min</td><td class="${state.avgTurnaroundMin <= 55 ? "ok" : "ko"}">${state.avgTurnaroundMin <= 55 ? "PASS" : "FAIL"}</td></tr>
    <tr><td>Gate-Auslastung</td><td>${state.gateUtilizationAvgPct.toFixed(2)}%</td><td><= 92%</td><td class="${state.gateUtilizationAvgPct <= 92 ? "ok" : "ko"}">${state.gateUtilizationAvgPct <= 92 ? "PASS" : "FAIL"}</td></tr>
    <tr><td>Durchschnitt Delay</td><td>${state.delayAvgMin.toFixed(2)} min</td><td><= 12 min</td><td class="${state.delayAvgMin <= 12 ? "ok" : "ko"}">${state.delayAvgMin <= 12 ? "PASS" : "FAIL"}</td></tr>
  </table>
  <div class="config">
    <b>Konfiguration</b><br />
    Gates: ${config.gatesTotal} | Open: ${config.gatesOpenPct}% | Arrivals/h: ${config.arrivalsPerHour} | Departures/h: ${config.departuresPerHour}<br />
    Ground Crew Teams: ${config.groundCrewTeams} | Baggage Capacity/h: ${config.baggageCapacityFlightsPerHour} | Runway Slots/h: ${config.runwaySlotsPerHour}
  </div>
  ${forecastSection}
  ${compareSection}
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    const revoke = () => URL.revokeObjectURL(url);
    win.addEventListener("afterprint", revoke, { once: true });
    setTimeout(() => {
      if (!win.closed) win.print();
    }, 500);
    setTimeout(revoke, 5000);
  } else {
    URL.revokeObjectURL(url);
  }
}

export default function App() {
  const [config, setConfig] = useState<AirportConfig>(() => ({
    ...DEFAULT_CONFIG,
    twinApiBaseUrl: resolveTwinApiBaseUrl(),
  }));
  const [state, setState] = useState<AirportState>(INITIAL_STATE);
  const [hasKpiSummary, setHasKpiSummary] = useState(false);
  const [selectedTest, setSelectedTest] = useState<number>(1);
  const [reportContext, setReportContext] = useState<{
    testId: number;
    config: AirportConfig;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playbookEnabled, setPlaybookEnabled] = useState(false);
  const [playbookBusy, setPlaybookBusy] = useState(false);
  const [playbookJobId, setPlaybookJobId] = useState<string | null>(null);
  const [playbookJobState, setPlaybookJobState] = useState<PlannerJobState>(null);
  const [playbookJobProgress, setPlaybookJobProgress] = useState(0);
  const [playbookError, setPlaybookError] = useState("");
  const [playbookRecord, setPlaybookRecord] = useState<PlaybookRecordClient | null>(null);
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("scenario");
  const [forecastSource, setForecastSource] = useState<ForecastSourceKind>("config_snapshot");
  const [forecastHorizonMin, setForecastHorizonMin] = useState<number>(60);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse>({});
  const [grafanaBaseUrl, setGrafanaBaseUrl] = useState(resolveTwinGrafanaBaseUrl());
  const [observabilityHint, setObservabilityHint] = useState("");
  const telemetryCursorRef = useRef(0);
  const telemetrySamplesRef = useRef<any[]>([]);

  const apiBase = useMemo(() => normalizeBaseUrl(config.twinApiBaseUrl), [config.twinApiBaseUrl]);
  const localObservabilityApiBase = useMemo(
    () => suggestLocalObservabilityApiBase(apiBase),
    [apiBase],
  );
  const selectedCase = CASE_BY_ID[selectedTest] || {
    name: "Unbekannter Testfall",
    description: "n/a",
  };
  const latest = state.dataLog.length ? state.dataLog[state.dataLog.length - 1] : null;
  const grafanaRunUrl = useMemo(
    () => buildGrafanaRunUrl(grafanaBaseUrl, state.remoteRunId),
    [grafanaBaseUrl, state.remoteRunId],
  );
  const telemetryStreamEnabled = Boolean(capabilities.telemetry_stream_enabled);
  const preferredLiveApiBase = useMemo(() => {
    if (telemetryStreamEnabled) {
      return apiBase;
    }
    return localObservabilityApiBase || apiBase;
  }, [apiBase, localObservabilityApiBase, telemetryStreamEnabled]);

  useEffect(() => {
    let active = true;

    const fetchCapabilities = async (baseUrl: string) =>
      ((await fetchJsonWithTimeout(`${normalizeBaseUrl(baseUrl)}/api/v1/capabilities`, {}, 6000)) ||
        {}) as CapabilitiesResponse;

    const applyCapabilities = (next: CapabilitiesResponse) => {
      setCapabilities(next);
      setPlaybookEnabled(Boolean(next?.playbook_synth_enabled));
      setGrafanaBaseUrl(normalizeBaseUrl(next?.grafana_base_url || resolveTwinGrafanaBaseUrl()));
    };

    const loadCapabilities = async () => {
      try {
        const next = await fetchCapabilities(apiBase);
        if (!active) return;

        if (
          !next?.telemetry_stream_enabled &&
          localObservabilityApiBase &&
          localObservabilityApiBase !== apiBase
        ) {
          try {
            const localCaps = await fetchCapabilities(localObservabilityApiBase);
            if (!active) return;
            if (localCaps?.telemetry_stream_enabled) {
              setObservabilityHint(
                `Lokales Docker-Backend ${localObservabilityApiBase} erkannt und automatisch fuer Grafana-Live-Daten aktiviert.`,
              );
              setConfig((prev) =>
                normalizeBaseUrl(prev.twinApiBaseUrl) === apiBase
                  ? { ...prev, twinApiBaseUrl: localObservabilityApiBase }
                  : prev,
              );
              return;
            }
          } catch {
            // Fall through to the current backend capabilities.
          }

          applyCapabilities(next);
          setObservabilityHint(
            `Dieses Backend speist Grafana nicht automatisch. Fuer Live-Monitoring lokal ${localObservabilityApiBase} verwenden.`,
          );
          return;
        }

        applyCapabilities(next);
        setObservabilityHint(
          next?.telemetry_stream_enabled
            ? ""
            : "Dieses Backend speist Grafana derzeit nicht automatisch.",
        );
      } catch {
        if (localObservabilityApiBase && localObservabilityApiBase !== apiBase) {
          try {
            const localCaps = await fetchCapabilities(localObservabilityApiBase);
            if (!active) return;
            if (localCaps?.telemetry_stream_enabled) {
              setObservabilityHint(
                `API ${apiBase} nicht erreichbar. Lokales Docker-Backend ${localObservabilityApiBase} wurde aktiviert.`,
              );
              setConfig((prev) =>
                normalizeBaseUrl(prev.twinApiBaseUrl) === apiBase
                  ? { ...prev, twinApiBaseUrl: localObservabilityApiBase }
                  : prev,
              );
              return;
            }
          } catch {
            // Keep the original failure state.
          }
        }

        if (!active) return;
        setCapabilities({});
        setPlaybookEnabled(false);
        setObservabilityHint("");
      }
    };

    loadCapabilities();
    return () => {
      active = false;
    };
  }, [apiBase, localObservabilityApiBase]);

  const checkApiBase = useCallback(async (baseUrl: string) => {
    setState((prev) => ({ ...prev, remoteApiStatus: "checking" }));
    const t0 = performance.now();
    try {
      await fetchJsonWithTimeout(`${normalizeBaseUrl(baseUrl)}/api/v1/health`, {}, 8000);
      setState((prev) => ({
        ...prev,
        remoteApiStatus: "ok",
        remoteApiLatencyMs: Math.round(performance.now() - t0),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        remoteApiStatus: "down",
        remoteApiLatencyMs: Math.round(performance.now() - t0),
      }));
    }
  }, []);

  const checkApi = useCallback(async () => {
    await checkApiBase(apiBase);
  }, [apiBase, checkApiBase]);

  const resetTelemetryBuffer = useCallback(() => {
    telemetryCursorRef.current = 0;
    telemetrySamplesRef.current = [];
  }, []);

  const pullRunDataFromBase = useCallback(async (baseUrl: string, runId: string) => {
    const resolvedBase = normalizeBaseUrl(baseUrl);
    const status = await fetchJsonWithTimeout(`${resolvedBase}/api/v1/runs/${runId}`);
    const record = await fetchJsonWithTimeout(`${resolvedBase}/api/v1/runs/${runId}/record`);
    const safety = await fetchJsonWithTimeout(`${resolvedBase}/api/v1/runs/${runId}/safety`);
    let telemetry = telemetrySamplesRef.current;
    if (status.state === "queued" || status.state === "running") {
      const telemetrySlice = (await fetchJsonWithTimeout(
        `${resolvedBase}/api/v1/runs/${runId}/telemetry-slice?cursor=${telemetryCursorRef.current}&limit=1200`,
      )) as TelemetrySliceResponse;
      const nextItems = Array.isArray(telemetrySlice?.items) ? telemetrySlice.items : [];
      if (nextItems.length > 0) {
        telemetrySamplesRef.current = telemetrySamplesRef.current.concat(nextItems);
      }
      telemetryCursorRef.current = Number(
        telemetrySlice?.next_cursor ?? telemetryCursorRef.current,
      );
      telemetry = telemetrySamplesRef.current;
    } else if (status.state === "completed" || status.state === "failed") {
      const telemetryResponse = await fetch(`${resolvedBase}/api/v1/runs/${runId}/telemetry`);
      const telemetryText = telemetryResponse.ok ? await telemetryResponse.text() : "";
      telemetrySamplesRef.current = parseTelemetryJsonl(telemetryText);
      telemetryCursorRef.current = telemetryText.length;
      telemetry = telemetrySamplesRef.current;
    }
    setHasKpiSummary(Boolean(record?.summary?.airport_kpis));
    setState((prev) => stateFromTwinRecord(prev, record, telemetry, safety));
  }, []);

  const pullRunData = useCallback(
    async (runId: string) => {
      await pullRunDataFromBase(apiBase, runId);
    },
    [apiBase, pullRunDataFromBase],
  );

  const pullPlaybookData = useCallback(
    async (jobId: string) => {
      const status = await fetchJsonWithTimeout(`${apiBase}/api/v1/playbook-jobs/${jobId}`);
      const nextState = (status?.state as PlannerJobState) || null;
      const nextProgress = Number(status?.progress ?? 0);
      const nextError = String(status?.error || "");
      setPlaybookJobState(nextState);
      setPlaybookJobProgress(nextProgress);
      setPlaybookError(nextError);

      if (nextState === "completed") {
        const record = (await fetchJsonWithTimeout(
          `${apiBase}/api/v1/playbook-jobs/${jobId}/record`,
        )) as PlaybookRecordClient;
        setPlaybookRecord(record);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (!state.remoteRunId) return;
    if (state.remoteRunState !== "queued" && state.remoteRunState !== "running") return;

    const id = setInterval(() => {
      pullRunData(state.remoteRunId!).catch((err) => {
        setError(String(err.message || err));
      });
    }, 1200);
    return () => clearInterval(id);
  }, [pullRunData, state.remoteRunId, state.remoteRunState]);

  useEffect(() => {
    if (!playbookJobId) return;
    if (playbookJobState !== "queued" && playbookJobState !== "running") return;

    const id = setInterval(() => {
      pullPlaybookData(playbookJobId).catch((err) => {
        setPlaybookError(String(err.message || err));
      });
    }, 1200);
    return () => clearInterval(id);
  }, [playbookJobId, playbookJobState, pullPlaybookData]);

  const startScenarioRun = useCallback(
    async ({
      baseUrl,
      realtimeMode,
      autoOpenGrafana = false,
      grafanaWindow = null,
    }: {
      baseUrl: string;
      realtimeMode: AirportConfig["twinRealtimeMode"];
      autoOpenGrafana?: boolean;
      grafanaWindow?: Window | null;
    }) => {
      const resolvedBase = normalizeBaseUrl(baseUrl);
      await checkApiBase(resolvedBase);
      const scenario = buildTwinScenario(selectedTest, config);
      const modelPack = buildTwinModelPack(config);

      await fetchJsonWithTimeout(`${resolvedBase}/api/v1/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
      });

      await fetchJsonWithTimeout(`${resolvedBase}/api/v1/model-packs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelPack),
      });

      const runPayload = {
        scenario_id: scenario.id,
        model_pack_id: modelPack.id,
        seed: config.twinSeedBase + selectedTest,
        realtime_mode: realtimeMode,
        adapters: [
          {
            name: "modbus",
            enabled: true,
            endpoint: "sim://modbus-airport-medium-eu",
            profile: config.twinProfileId,
            transport: "sim",
            mapping: {},
            watchdog_enabled: true,
            watchdog_signal: "40100@1",
            watchdog_interval_ms: 500,
            watchdog_timeout_ms: 1000,
          },
          {
            name: "opcua",
            enabled: true,
            endpoint: "sim://opcua-airport-medium-eu",
            profile: config.twinProfileId,
            transport: "sim",
            mapping: {},
          },
        ],
        assertions: [],
      };

      const status = await fetchJsonWithTimeout(`${resolvedBase}/api/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runPayload),
      });

      resetTelemetryBuffer();
      setHasKpiSummary(false);
      setReportContext({
        testId: selectedTest,
        config: { ...config, twinApiBaseUrl: resolvedBase, twinRealtimeMode: realtimeMode },
      });

      setConfig((prev) => ({
        ...prev,
        twinApiBaseUrl: resolvedBase,
        twinRealtimeMode: realtimeMode,
      }));
      setState((prev) => ({
        ...prev,
        remoteRunId: status.run_id,
        remoteRunState: status.state,
        remoteRunProgress: status.progress || 0,
        passFail: null,
        dataLog: [],
        otpRatePct: 0,
        avgTurnaroundMin: 0,
        gateUtilizationAvgPct: 0,
        groundCrewUtilizationAvgPct: 0,
        departureQueueAvgFlights: 0,
        baggageQueueAvgFlights: 0,
        delayAvgMin: 0,
        tickDriftAvgMs: 0,
        tickDriftMaxMs: 0,
        tickDriftP99Ms: 0,
        auditFingerprintSha256: "",
        watchdogConfigLoaded: false,
        watchdogTicksOk: 0,
        watchdogMisses: 0,
        watchdogFailSafe: false,
        watchdogFailReason: "",
      }));

      const nextGrafanaRunUrl = buildGrafanaRunUrl(grafanaBaseUrl, status.run_id);
      if (autoOpenGrafana && nextGrafanaRunUrl) {
        if (grafanaWindow && !grafanaWindow.closed) {
          grafanaWindow.location.replace(nextGrafanaRunUrl);
        } else {
          window.open(nextGrafanaRunUrl, "_blank");
        }
      }

      await pullRunDataFromBase(resolvedBase, status.run_id);
    },
    [checkApiBase, config, grafanaBaseUrl, pullRunDataFromBase, resetTelemetryBuffer, selectedTest],
  );

  const runRemoteScenario = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await startScenarioRun({
        baseUrl: apiBase,
        realtimeMode: config.twinRealtimeMode,
      });
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }, [apiBase, config.twinRealtimeMode, startScenarioRun]);

  const runDemoLiveScenario = useCallback(async () => {
    setBusy(true);
    setError("");
    const demoPopup = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    if (demoPopup) {
      demoPopup.document.title = "Airport Twin Core Demo";
      demoPopup.document.body.innerHTML =
        "<p style='font-family:sans-serif;padding:16px'>Live-Dashboard wird vorbereitet...</p>";
    }
    try {
      await startScenarioRun({
        baseUrl: preferredLiveApiBase,
        realtimeMode: "hil_realtime",
        autoOpenGrafana: true,
        grafanaWindow: demoPopup,
      });
    } catch (err: any) {
      if (demoPopup && !demoPopup.closed) {
        demoPopup.close();
      }
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }, [preferredLiveApiBase, startScenarioRun]);

  const runPlaybookSynthesis = useCallback(async () => {
    if (!playbookEnabled) return;

    setPlaybookBusy(true);
    setPlaybookError("");
    setPlaybookRecord(null);

    try {
      const scenario = buildTwinScenario(selectedTest, config);
      const modelPack = buildTwinModelPack(config);

      if (plannerMode === "scenario" || forecastSource === "config_snapshot") {
        await fetchJsonWithTimeout(`${apiBase}/api/v1/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scenario),
        });

        await fetchJsonWithTimeout(`${apiBase}/api/v1/model-packs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(modelPack),
        });
      }

      const payload = buildPlaybookJobPayload({
        plannerMode,
        forecastSource,
        forecastHorizonMin,
        selectedTest,
        config,
        selectedCaseName: selectedCase.name,
        remoteRunId: state.remoteRunId,
      });

      const status = await fetchJsonWithTimeout(`${apiBase}/api/v1/playbook-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setPlaybookJobId(status?.job_id ? String(status.job_id) : null);
      setPlaybookJobState((status?.state as PlannerJobState) || "queued");
      setPlaybookJobProgress(Number(status?.progress ?? 0));
      if (status?.job_id) {
        await pullPlaybookData(String(status.job_id));
      }
    } catch (err: any) {
      setPlaybookError(String(err?.message || err));
    } finally {
      setPlaybookBusy(false);
    }
  }, [
    apiBase,
    config,
    forecastHorizonMin,
    forecastSource,
    plannerMode,
    playbookEnabled,
    pullPlaybookData,
    selectedCase.name,
    selectedTest,
    state.remoteRunId,
  ]);

  const apiTone =
    state.remoteApiStatus === "ok"
      ? "status-chip--ok"
      : state.remoteApiStatus === "down"
        ? "status-chip--bad"
        : state.remoteApiStatus === "checking"
          ? "status-chip--warn"
          : "";

  const runTone =
    state.remoteRunState === "completed"
      ? "status-chip--ok"
      : state.remoteRunState === "failed"
        ? "status-chip--bad"
        : state.remoteRunState === "running" || state.remoteRunState === "queued"
          ? "status-chip--warn"
          : "";

  const plannerTone =
    playbookJobState === "completed"
      ? "status-chip--ok"
      : playbookJobState === "failed"
        ? "status-chip--bad"
        : playbookJobState === "running" || playbookJobState === "queued"
          ? "status-chip--warn"
          : "";
  const plannerActionDisabled =
    playbookBusy ||
    (plannerMode === "forecast" && forecastSource === "run_snapshot" && !state.remoteRunId);
  const playbookForecastContext =
    playbookRecord &&
    (playbookRecord.build_meta?.forecast_mode ||
      playbookRecord.request?.source_kind === "config_snapshot" ||
      playbookRecord.request?.source_kind === "run_snapshot")
      ? {
          sourceLabel: forecastSourceLabel(
            String(
              playbookRecord.build_meta?.forecast_source_kind ||
                playbookRecord.request?.source_kind ||
                "scenario",
            ),
          ),
          horizon: String(
            playbookRecord.build_meta?.forecast_horizon_min ||
              playbookRecord.request?.forecast_horizon_min ||
              "n/a",
          ),
          sourceRunId: String(
            playbookRecord.build_meta?.source_run_id ||
              playbookRecord.request?.source_run_id ||
              "n/a",
          ),
          derivedScenarioId: String(
            playbookRecord.build_meta?.derived_forecast_scenario_id || "n/a",
          ),
          derivedModelPackId: String(
            playbookRecord.build_meta?.derived_forecast_model_pack_id || "n/a",
          ),
        }
      : null;
  const playbookForecastNarrative = buildForecastNarrative(playbookRecord);
  const reportPlaybook =
    playbookRecord?.request?.source_kind === "run_snapshot" &&
    playbookRecord.request.source_run_id === state.remoteRunId
      ? playbookRecord
      : reportContext &&
          playbookRecord?.request?.scenario_id ===
            buildTwinScenario(reportContext.testId, reportContext.config).id &&
          playbookRecord.request.seed ===
            reportContext.config.twinSeedBase + reportContext.testId &&
          Object.entries(buildPlannerConfigSnapshot(reportContext.config)).every(
            ([key, value]) => playbookRecord.model_pack_snapshot?.parameter_set[key] === value,
          )
        ? playbookRecord
        : null;
  const hasKpiEvidence = hasKpiSummary || state.dataLog.length > 0;

  return (
    <div className="app-shell">
      <div className="app-frame">
        <StudioHeader
          title="Was hält die Abfertigung aus?"
          location="Abfertigungssimulation · Airport Twin Core"
          lead="Die acht Krisenfälle im Detail durchspielen und Stellhebel suchen: Pünktlichkeit, Umlaufzeit und Gate-Auslastung im Modell."
          evidence="synthetic"
          evidenceLabel="Demo-Modell"
          warning="Unkalibriert. KPI-Werte sind Modellwerte, keine Betriebsprognose."
          context={
            <>
              <span className={`studio-status ${apiTone}`}>
                API {state.remoteApiStatus.toUpperCase()}
                {state.remoteApiLatencyMs != null ? ` / ${state.remoteApiLatencyMs} ms` : ""}
              </span>{" "}
              ·{" "}
              <span className={`studio-status ${runTone}`}>
                Run {(state.remoteRunState || "idle").toUpperCase()}
              </span>{" "}
              · <span>Grafana {telemetryStreamEnabled ? "STREAM ON" : "STREAM OFF"}</span>
            </>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() =>
                  reportContext &&
                  generateTestReport(
                    state,
                    reportContext.config,
                    reportContext.testId,
                    reportPlaybook,
                  )
                }
                disabled={state.remoteRunState !== "completed" || !reportContext}
              >
                Bericht erzeugen
              </button>
              <button
                type="button"
                className="studio-primary"
                onClick={runRemoteScenario}
                disabled={busy}
              >
                {busy ? "Starte..." : "Backend Run starten"}
              </button>
            </>
          }
        />

        <div className="layout-grid reveal reveal--2">
          <aside className="command-rail glass-panel">
            <section className="rail-section">
              <h2 className="section-title">Testlauf steuern</h2>
              <p className="section-subtitle">
                {selectedCase.name}: {selectedCase.description}
              </p>

              <details className="sim-proof sim-proof--inline">
                <summary>Details/Nachweis: Verbindung</summary>
              <label className="control-field">
                <span className="control-field__label">API Base URL</span>
                <input
                  className="control-field__input"
                  value={config.twinApiBaseUrl}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, twinApiBaseUrl: e.target.value }))
                  }
                />
              </label>
              </details>

              <label className="control-field">
                <span className="control-field__label">Testprofil</span>
                <select
                  className="control-field__input control-field__input--select"
                  value={selectedTest}
                  onChange={(e) => setSelectedTest(Number(e.target.value))}
                >
                  {CASE_DEFINITIONS.map((testCase) => (
                    <option key={testCase.id} value={testCase.id}>
                      {testCase.id} - {testCase.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-field">
                <span className="control-field__label">Run Mode</span>
                <select
                  className="control-field__input control-field__input--select"
                  value={config.twinRealtimeMode}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      twinRealtimeMode: e.target.value === "sil" ? "sil" : "hil_realtime",
                    }))
                  }
                >
                  <option value="hil_realtime">Echtzeit-Demo (simulierte Adapter, 60 s)</option>
                  <option value="sil">SIL Schnelllauf (Batch ohne Live-Effekt)</option>
                </select>
              </label>
              <p className="control-hint">
                {config.twinRealtimeMode === "sil"
                  ? "SIL Schnelllauf (Batch ohne Live-Effekt)"
                  : "Echtzeit-Demo (simulierte Adapter, 60 s)"}
              </p>

              <div className="button-stack">
                <button
                  className="btn btn--live"
                  onClick={runDemoLiveScenario}
                  disabled={busy || !telemetryStreamEnabled}
                >
                  {busy ? "Demo startet..." : "Demo Live starten"}
                </button>
                <button className="btn btn--secondary" onClick={checkApi}>
                  API pruefen
                </button>
              </div>

              {observabilityHint ? (
                <div className={telemetryStreamEnabled ? "info-note" : "warn-note"}>
                  {observabilityHint}
                </div>
              ) : null}

              {!telemetryStreamEnabled &&
              localObservabilityApiBase &&
              localObservabilityApiBase !== apiBase ? (
                <div className="inline-actions">
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() =>
                      setConfig((prev) => ({ ...prev, twinApiBaseUrl: localObservabilityApiBase }))
                    }
                  >
                    Auf Docker-Backend umstellen
                  </button>
                </div>
              ) : null}

              <div className="run-meta">
                <div>
                  Run ID: <span className="mono">{state.remoteRunId || "-"}</span>
                </div>
                <div>Status: {state.remoteRunState || "-"}</div>
                <div>
                  Modellkriterien:{" "}
                  {state.passFail === null
                    ? "noch nicht bewertet"
                    : state.passFail
                      ? "erfüllt"
                      : "nicht erfüllt"}
                </div>
                <div>Modellwerte, kein empirischer Nachweis.</div>
                <div>Progress: {state.remoteRunProgress.toFixed(0)}%</div>
                <div
                  className="progress-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={state.remoteRunProgress}
                >
                  <div
                    className="progress-bar__value"
                    style={{ width: `${Math.max(0, Math.min(100, state.remoteRunProgress))}%` }}
                  />
                </div>
              </div>

              {state.remoteRunId ? (
                <div className="planner-links run-links">
                  <span>Run Links:</span>
                  <a
                    href={`${apiBase}/api/v1/runs/${state.remoteRunId}/record`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                  >
                    Record
                  </a>
                  {state.remoteRunState === "completed" ? (
                    <>
                      <a
                        href={`${apiBase}/api/v1/runs/${state.remoteRunId}/artifacts/report.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        PDF-Bericht
                      </a>
                      <a
                        href={`${apiBase}/api/v1/runs/${state.remoteRunId}/telemetry.csv`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        Telemetrie-CSV
                      </a>
                    </>
                  ) : null}
                  {grafanaRunUrl ? (
                    <a href={grafanaRunUrl} target="_blank" rel="noreferrer" className="mono">
                      Grafana Live
                    </a>
                  ) : null}
                </div>
              ) : null}

              {playbookEnabled ? (
                <section className="planner-panel">
                  <div className="planner-panel__head">
                    <h3>Playbook Synthesizer</h3>
                    <span className={`status-chip ${plannerTone}`}>
                      Job {(playbookJobState || "idle").toUpperCase()}
                    </span>
                  </div>
                  <p className="section-subtitle">
                    Suche über Stellhebel im Modell (nur Empfehlung, modellinterne Gegenprüfung)
                  </p>
                  <div className="planner-controls">
                    <label className="control-field">
                      <span className="control-field__label">Planner Modus</span>
                      <select
                        aria-label="Planner Modus"
                        className="control-field__input control-field__input--select"
                        value={plannerMode}
                        onChange={(e) =>
                          setPlannerMode(e.target.value === "forecast" ? "forecast" : "scenario")
                        }
                      >
                        <option value="scenario">Szenario</option>
                        <option value="forecast">Forecast</option>
                      </select>
                    </label>

                    {plannerMode === "forecast" ? (
                      <>
                        <label className="control-field">
                          <span className="control-field__label">Forecast Quelle</span>
                          <select
                            aria-label="Forecast Quelle"
                            className="control-field__input control-field__input--select"
                            value={forecastSource}
                            onChange={(e) =>
                              setForecastSource(
                                e.target.value === "run_snapshot"
                                  ? "run_snapshot"
                                  : "config_snapshot",
                              )
                            }
                          >
                            <option value="config_snapshot">Aktuelle Konfiguration</option>
                            <option value="run_snapshot" disabled={!state.remoteRunId}>
                              Letzten Run verwenden
                            </option>
                          </select>
                        </label>

                        <label className="control-field">
                          <span className="control-field__label">Forecast Horizont</span>
                          <select
                            aria-label="Forecast Horizont"
                            className="control-field__input control-field__input--select"
                            value={forecastHorizonMin}
                            onChange={(e) => setForecastHorizonMin(Number(e.target.value))}
                          >
                            <option value={30}>30 min</option>
                            <option value={60}>60 min</option>
                            <option value={120}>120 min</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                  </div>

                  {plannerMode === "forecast" &&
                  forecastSource === "run_snapshot" &&
                  !state.remoteRunId ? (
                    <div className="warn-note">
                      Fuer Forecast aus Run-Snapshot zuerst einen Run starten.
                    </div>
                  ) : null}

                  <button
                    className="btn btn--primary"
                    onClick={runPlaybookSynthesis}
                    disabled={plannerActionDisabled}
                  >
                    {playbookBusy ? "Synthetisiere..." : "Playbook synthetisieren"}
                  </button>

                  <div className="run-meta planner-panel__meta">
                    <div>
                      Job ID: <span className="mono">{playbookJobId || "-"}</span>
                    </div>
                    <div>Status: {playbookJobState || "-"}</div>
                    <div>Progress: {playbookJobProgress.toFixed(0)}%</div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={playbookJobProgress}
                    >
                      <div
                        className="progress-bar__value"
                        style={{ width: `${Math.max(0, Math.min(100, playbookJobProgress))}%` }}
                      />
                    </div>
                  </div>

                  {playbookError ? <div className="error-note">{playbookError}</div> : null}
                </section>
              ) : null}

              <div className="control-divider" />

              <LabeledInput
                label="Gates Total"
                value={config.gatesTotal}
                onChange={(v: number) => setConfig((prev) => ({ ...prev, gatesTotal: v }))}
                min={5}
                max={120}
              />
              <LabeledInput
                label="Gates Open %"
                value={config.gatesOpenPct}
                onChange={(v: number) => setConfig((prev) => ({ ...prev, gatesOpenPct: v }))}
                min={40}
                max={100}
              />
              <LabeledInput
                label="Arrivals / hour"
                value={config.arrivalsPerHour}
                onChange={(v: number) => setConfig((prev) => ({ ...prev, arrivalsPerHour: v }))}
                min={1}
                max={80}
              />
              <LabeledInput
                label="Departures / hour"
                value={config.departuresPerHour}
                onChange={(v: number) => setConfig((prev) => ({ ...prev, departuresPerHour: v }))}
                min={1}
                max={80}
              />

              {error ? <div className="error-note">{error}</div> : null}
            </section>
          </aside>

          <main className="content-grid">
            <section
              className="kpi-band reveal reveal--3"
              role="region"
              aria-label="Airport-Modell-KPIs"
            >
              <StatCard
                label="OTP"
                value={hasKpiEvidence ? state.otpRatePct.toFixed(2) : "n/a"}
                unit={hasKpiEvidence ? "%" : ""}
                tone={!hasKpiEvidence ? "neutral" : state.otpRatePct >= 85 ? "good" : "bad"}
              />
              <StatCard
                label="Turnaround"
                value={hasKpiEvidence ? state.avgTurnaroundMin.toFixed(2) : "n/a"}
                unit={hasKpiEvidence ? "min" : ""}
                tone={!hasKpiEvidence ? "neutral" : state.avgTurnaroundMin <= 55 ? "good" : "bad"}
              />
              <StatCard
                label="Gate Utilization"
                value={hasKpiEvidence ? state.gateUtilizationAvgPct.toFixed(2) : "n/a"}
                unit={hasKpiEvidence ? "%" : ""}
                tone={
                  !hasKpiEvidence ? "neutral" : state.gateUtilizationAvgPct <= 92 ? "good" : "warn"
                }
              />
              <StatCard
                label="Delay Avg"
                value={hasKpiEvidence ? state.delayAvgMin.toFixed(2) : "n/a"}
                unit={hasKpiEvidence ? "min" : ""}
                tone={!hasKpiEvidence ? "neutral" : state.delayAvgMin <= 12 ? "warn" : "bad"}
              />
            </section>

            {playbookEnabled && playbookRecord?.best_option ? (
              <section className="playbook-result" role="region" aria-label="Playbook-Vergleich">
                <div className="info-note planner-context">
                  <h3>Eingefrorener Playbook-Vergleich</h3>
                  <small>
                    Szenario-ID:{" "}
                    <span className="mono">
                      {String(
                        playbookRecord.request?.scenario_id ||
                          playbookRecord.build_meta?.derived_forecast_scenario_id ||
                          "n/a",
                      )}
                    </span>
                    {" · "}Model-Pack-ID:{" "}
                    <span className="mono">
                      {String(
                        playbookRecord.request?.model_pack_id ||
                          playbookRecord.build_meta?.derived_forecast_model_pack_id ||
                          "n/a",
                      )}
                    </span>
                    {" · "}Seed:{" "}
                    <span className="mono">{String(playbookRecord.request?.seed ?? "n/a")}</span>
                  </small>
                  <small>Eigener eingefrorener Versuch; nicht automatisch der aktuelle Run.</small>
                </div>
                {playbookForecastContext ? (
                  <div className="info-note planner-context">
                    Forecast {playbookForecastContext.horizon} min · Quelle:{" "}
                    {playbookForecastContext.sourceLabel} · Source Run:{" "}
                    <span className="mono">{playbookForecastContext.sourceRunId}</span> · Derived
                    Scenario:{" "}
                    <span className="mono">{playbookForecastContext.derivedScenarioId}</span>
                  </div>
                ) : null}
                {playbookForecastNarrative ? (
                  <div className="playbook-brief">
                    <div className="playbook-brief__kicker">Forecast Entscheidung</div>
                    <h4 className="playbook-brief__title">{playbookForecastNarrative.title}</h4>
                    <div className="playbook-brief__grid">
                      <div className="playbook-brief__step">
                        <span className="playbook-brief__label">Projektion ohne Eingriff</span>
                        <p>{playbookForecastNarrative.baselineLine}</p>
                      </div>
                      <div className="playbook-brief__step">
                        <span className="playbook-brief__label">Empfohlener Eingriff</span>
                        <p>{playbookForecastNarrative.actionLine}</p>
                      </div>
                      <div className="playbook-brief__step">
                        <span className="playbook-brief__label">Erwarteter Effekt</span>
                        <p>{playbookForecastNarrative.effectLine}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="playbook-compare">
                  {playbookRecord.baseline_option ? (
                    <div className="playbook-result__card playbook-result__card--baseline">
                      <h4>{playbookForecastContext ? "Forecast Baseline" : "Baseline"}</h4>
                      {playbookForecastContext ? (
                        <div className="playbook-card__eyebrow">
                          Projektion ohne zusaetzliche Massnahme
                        </div>
                      ) : null}
                      <div className="playbook-kpi-grid">
                        <div>
                          OTP:{" "}
                          {pickOptionKpis(playbookRecord.baseline_option)?.otp_rate_pct?.toFixed(2)}
                          %
                        </div>
                        <div>
                          Turnaround:{" "}
                          {pickOptionKpis(
                            playbookRecord.baseline_option,
                          )?.avg_turnaround_min?.toFixed(2)}{" "}
                          min
                        </div>
                        <div>
                          Gate Util:{" "}
                          {pickOptionKpis(
                            playbookRecord.baseline_option,
                          )?.gate_utilization_avg_pct?.toFixed(2)}
                          %
                        </div>
                        <div>
                          Delay:{" "}
                          {pickOptionKpis(playbookRecord.baseline_option)?.delay_avg_min?.toFixed(
                            2,
                          )}{" "}
                          min
                        </div>
                        <div>
                          Kosten: {playbookRecord.baseline_option.intervention_cost.toFixed(2)}
                        </div>
                        <div>
                          Status:{" "}
                          {modelCheckText(playbookRecord.baseline_option.validation_pass_fail)}
                        </div>
                      </div>
                      <div className="planner-links">
                        <span>Gegenprüf-Lauf (modellintern):</span>
                        {playbookRecord.baseline_option.validation_run_id ? (
                          <a
                            href={`${apiBase}/api/v1/runs/${playbookRecord.baseline_option.validation_run_id}/record`}
                            target="_blank"
                            rel="noreferrer"
                            className="mono"
                          >
                            {playbookRecord.baseline_option.validation_run_id}
                          </a>
                        ) : (
                          <span className="mono">n/a</span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="playbook-result__card playbook-result__card--recommended">
                    <h4>
                      {playbookForecastContext
                        ? "Forecast Empfehlung"
                        : `Empfehlung: ${playbookRecord.best_option.option_id}`}
                    </h4>
                    <div className="playbook-card__eyebrow">
                      {playbookForecastContext
                        ? `Innerhalb von ${playbookForecastContext.horizon} min empfohlener Eingriff`
                        : `Option ${playbookRecord.best_option.option_id}`}
                    </div>
                    <div className="playbook-kpi-grid">
                      <div>
                        OTP: {pickOptionKpis(playbookRecord.best_option)?.otp_rate_pct?.toFixed(2)}%
                      </div>
                      <div>
                        Turnaround:{" "}
                        {pickOptionKpis(playbookRecord.best_option)?.avg_turnaround_min?.toFixed(2)}{" "}
                        min
                      </div>
                      <div>
                        Gate Util:{" "}
                        {pickOptionKpis(
                          playbookRecord.best_option,
                        )?.gate_utilization_avg_pct?.toFixed(2)}
                        %
                      </div>
                      <div>
                        Delay:{" "}
                        {pickOptionKpis(playbookRecord.best_option)?.delay_avg_min?.toFixed(2)} min
                      </div>
                      <div>Kosten: {playbookRecord.best_option.intervention_cost.toFixed(2)}</div>
                      <div>
                        Status: {modelCheckText(playbookRecord.best_option.validation_pass_fail)}
                      </div>
                    </div>
                    <div className="planner-links">
                      <span>Gegenprüf-Lauf (modellintern):</span>
                      {playbookRecord.best_option.validation_run_id ? (
                        <a
                          href={`${apiBase}/api/v1/runs/${playbookRecord.best_option.validation_run_id}/record`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                        >
                          {playbookRecord.best_option.validation_run_id}
                        </a>
                      ) : (
                        <span className="mono">n/a</span>
                      )}
                    </div>
                    <div className="playbook-delta-grid">
                      <div
                        className={deltaClass(
                          playbookRecord.best_option.delta_to_baseline?.otp_rate_pct_delta || 0,
                          "higher_is_better",
                        )}
                      >
                        Delta OTP:{" "}
                        {formatSigned(
                          playbookRecord.best_option.delta_to_baseline?.otp_rate_pct_delta || 0,
                          2,
                          "%",
                        )}
                      </div>
                      <div
                        className={deltaClass(
                          playbookRecord.best_option.delta_to_baseline?.avg_turnaround_min_delta ||
                            0,
                          "lower_is_better",
                        )}
                      >
                        Delta Turnaround:{" "}
                        {formatSigned(
                          playbookRecord.best_option.delta_to_baseline?.avg_turnaround_min_delta ||
                            0,
                          2,
                          " min",
                        )}
                      </div>
                      <div
                        className={deltaClass(
                          playbookRecord.best_option.delta_to_baseline
                            ?.gate_utilization_avg_pct_delta || 0,
                          "lower_is_better",
                        )}
                      >
                        Delta Gate Util:{" "}
                        {formatSigned(
                          playbookRecord.best_option.delta_to_baseline
                            ?.gate_utilization_avg_pct_delta || 0,
                          2,
                          "%",
                        )}
                      </div>
                      <div
                        className={deltaClass(
                          playbookRecord.best_option.delta_to_baseline?.delay_avg_min_delta || 0,
                          "lower_is_better",
                        )}
                      >
                        Delta Delay:{" "}
                        {formatSigned(
                          playbookRecord.best_option.delta_to_baseline?.delay_avg_min_delta || 0,
                          2,
                          " min",
                        )}
                      </div>
                      <div
                        className={deltaClass(
                          playbookRecord.best_option.delta_to_baseline?.intervention_cost_delta ||
                            0,
                          "lower_is_better",
                        )}
                      >
                        Delta Kosten:{" "}
                        {formatSigned(
                          playbookRecord.best_option.delta_to_baseline?.intervention_cost_delta ||
                            0,
                        )}
                      </div>
                    </div>
                    <div className="playbook-actions">
                      {(playbookRecord.best_option.actions || []).length ? (
                        (playbookRecord.best_option.actions || []).map((action, idx) => (
                          <div key={`${action.target}-${action.at_ms}-${idx}`} className="mono">
                            t={action.at_ms}ms · {action.action} {action.target}{" "}
                            {action.value > 0 ? "+" : ""}
                            {action.value}
                          </div>
                        ))
                      ) : (
                        <div className="mono">Keine Intervention empfohlen.</div>
                      )}
                    </div>
                  </div>
                </div>

                {playbookRecord.pareto_options?.length ? (
                  <div className="playbook-alt">
                    <h4>
                      {playbookForecastContext
                        ? "Pareto Alternativen im Forecast"
                        : "Pareto Alternativen"}
                    </h4>
                    <div
                      className="planner-table-wrap"
                      role="region"
                      aria-label="Pareto Alternativen"
                      tabIndex={0}
                    >
                      <table className="playbook-table">
                        <thead>
                          <tr>
                            <th>Option</th>
                            <th>OTP</th>
                            <th>Delay</th>
                            <th>Kosten</th>
                            <th>Delta OTP</th>
                            <th>Delta Delay</th>
                            <th>Run</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {playbookRecord.pareto_options.map((option) => (
                            <tr key={option.option_id}>
                              <td>{option.option_id}</td>
                              <td>{pickOptionKpis(option)?.otp_rate_pct?.toFixed(2)}%</td>
                              <td>{pickOptionKpis(option)?.delay_avg_min?.toFixed(2)} min</td>
                              <td>{option.intervention_cost.toFixed(2)}</td>
                              <td
                                className={deltaClass(
                                  option.delta_to_baseline?.otp_rate_pct_delta || 0,
                                  "higher_is_better",
                                )}
                              >
                                {formatSigned(
                                  option.delta_to_baseline?.otp_rate_pct_delta || 0,
                                  2,
                                  "%",
                                )}
                              </td>
                              <td
                                className={deltaClass(
                                  option.delta_to_baseline?.delay_avg_min_delta || 0,
                                  "lower_is_better",
                                )}
                              >
                                {formatSigned(
                                  option.delta_to_baseline?.delay_avg_min_delta || 0,
                                  2,
                                  " min",
                                )}
                              </td>
                              <td>
                                {option.validation_run_id ? (
                                  <a
                                    href={`${apiBase}/api/v1/runs/${option.validation_run_id}/record`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mono"
                                  >
                                    {option.validation_run_id}
                                  </a>
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td>{modelCheckText(option.validation_pass_fail)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {playbookRecord.artifacts?.length ? (
                  <div className="planner-links">
                    <span>Artefakte:</span>
                    {playbookRecord.artifacts.map((artifact) => (
                      <a
                        key={artifact}
                        href={`${apiBase}/api/v1/playbook-jobs/${playbookRecord.status.job_id}/artifacts/${artifact}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        {artifact}
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="glass-panel chart-panel reveal reveal--4">
              <div className="panel-head">
                <h3>KPI Verlauf</h3>
                <span className="panel-sub">OTP, Turnaround und Delay ueber Zeit</span>
              </div>
              <div className="chart-box chart-box--lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={state.dataLog}>
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      stroke={CHART_COLORS.axis}
                      tickFormatter={(v) => `${Math.round(v / 1000)}s`}
                    />
                    <YAxis stroke={CHART_COLORS.axis} />
                    <Tooltip
                      contentStyle={chartTokens.tooltip}
                      labelStyle={{ color: chartTokens.tooltip.color }}
                      labelFormatter={(v) => `t=${Math.round(Number(v) / 1000)}s`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="otp"
                      stroke={CHART_COLORS.otp}
                      strokeWidth={2.4}
                      dot={false}
                      name="OTP %"
                    />
                    <Line
                      type="monotone"
                      dataKey="turnaround"
                      stroke={CHART_COLORS.turnaround}
                      strokeWidth={2.2}
                      dot={false}
                      name="Turnaround min"
                    />
                    <Line
                      type="monotone"
                      dataKey="delay"
                      stroke={CHART_COLORS.delay}
                      strokeWidth={2.2}
                      dot={false}
                      name="Delay min"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="glass-panel chart-panel reveal reveal--5">
              <div className="panel-head">
                <h3>Queue und Ressourcen</h3>
                <span className="panel-sub">Gates, Crew und Queues im Vergleich</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={state.dataLog}>
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      stroke={CHART_COLORS.axis}
                      tickFormatter={(v) => `${Math.round(v / 1000)}s`}
                    />
                    <YAxis stroke={CHART_COLORS.axis} />
                    <Tooltip
                      contentStyle={chartTokens.tooltip}
                      labelStyle={{ color: chartTokens.tooltip.color }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="gateUtil"
                      stroke={CHART_COLORS.gate}
                      strokeWidth={2.2}
                      dot={false}
                      name="Gate Util %"
                    />
                    <Line
                      type="monotone"
                      dataKey="crewUtil"
                      stroke={CHART_COLORS.crew}
                      strokeWidth={2.2}
                      dot={false}
                      name="Crew Util %"
                    />
                    <Line
                      type="monotone"
                      dataKey="depQueue"
                      stroke={CHART_COLORS.dep}
                      strokeWidth={2.2}
                      dot={false}
                      name="Dep Queue"
                    />
                    <Line
                      type="monotone"
                      dataKey="bagQueue"
                      stroke={CHART_COLORS.bag}
                      strokeWidth={2.2}
                      dot={false}
                      name="Bag Queue"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <details className="sim-proof reveal reveal--6">
              <summary>Details/Nachweis: Watchdog, Tick-Drift, Telemetrie-Topics</summary>
            <section className="detail-grid">
              <article className="glass-panel detail-panel">
                <div className="panel-head">
                  <h3>Safety / Audit</h3>
                  <span className="panel-sub">Watchdog und Tick-Drift</span>
                </div>
                <div className="detail-list">
                  <div>
                    Watchdog Config Loaded: <span>{String(state.watchdogConfigLoaded)}</span>
                  </div>
                  <div>
                    Watchdog Ticks OK: <span>{state.watchdogTicksOk}</span>
                  </div>
                  <div>
                    Watchdog Misses: <span>{state.watchdogMisses}</span>
                  </div>
                  <div>
                    Watchdog Fail Safe: <span>{String(state.watchdogFailSafe)}</span>
                  </div>
                  <div>
                    Fail Reason: <span>{state.watchdogFailReason || "-"}</span>
                  </div>
                  <div>
                    Tick Drift Avg: <span>{state.tickDriftAvgMs.toFixed(3)} ms</span>
                  </div>
                  <div>
                    Tick Drift Max: <span>{state.tickDriftMaxMs.toFixed(3)} ms</span>
                  </div>
                  <div>
                    Tick Drift P99: <span>{state.tickDriftP99Ms.toFixed(3)} ms</span>
                  </div>
                </div>
                <p className="fingerprint mono">
                  Fingerprint: {state.auditFingerprintSha256 || "-"}
                </p>
              </article>

              <article className="glass-panel detail-panel">
                <div className="panel-head">
                  <h3>Protocol Topics</h3>
                  <span className="panel-sub">MQTT Telemetry Scope</span>
                </div>
                <div className="topic-list mono">
                  {MQTT_TOPICS.map((topic) => (
                    <div key={topic}>{topic}</div>
                  ))}
                </div>
                <div className="latest-point">
                  Letzter Punkt:{" "}
                  {latest
                    ? `${latest.otp.toFixed(2)}% OTP, ${latest.turnaround.toFixed(2)} min`
                    : "-"}
                </div>
              </article>
            </section>
            </details>
          </main>
        </div>
      </div>
    </div>
  );
}
