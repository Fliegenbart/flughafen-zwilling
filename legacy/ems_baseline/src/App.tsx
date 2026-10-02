// @ts-nocheck
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ScatterChart, Scatter, Area, AreaChart, Legend, ReferenceLine } from "recharts";

export type EmsMode = "cloud" | "local" | "manual";
export type InvMode = "grid-following" | "grid-forming" | "off";
export type DieselState = "off" | "cranking" | "running" | "syncing" | "synced";
export type TestResult = "pass" | "fail" | null;
export type RemoteRunState = "queued" | "running" | "completed" | "failed" | null;
export type RemoteApiStatus = "unknown" | "disabled" | "misconfigured" | "checking" | "ok" | "down";

export type TestPhase =
  | "friedensbetrieb"
  | "disconnect"
  | "grid-forming"
  | "diesel"
  | "restoring"
  | "island"
  | "cranking"
  | "syncing"
  | "handover"
  | "running"
  | "emp"
  | "manual-start"
  | "manual-running"
  | "backend-prep"
  | "backend-running"
  | "complete"
  | null;

export interface HilConfig {
  nominalFreq: number;
  nominalVoltage: number;
  batteryCapacityKWh: number;
  batteryMaxPowerKW: number;
  batteryInitSOC: number;
  inverterSwitchTimeMs: number;
  batteryInertiaH: number;
  droopBattery: number;
  dieselMaxPowerKW: number;
  dieselStartDelayMs: number;
  dieselRampTimeMs: number;
  dieselInertiaH: number;
  droopDiesel: number;
  criticalLoadKW: number;
  nonCriticalLoadKW: number;
  motorLoadKW: number;
  motorInrushFactor: number;
  motorInrushMs: number;
  loadShedDelayMs: number;
  pvPeakKW: number;
  pvEnabled: boolean;
  loadProfileEnabled: boolean;
  loadProfile: number[];
  pvProfile: number[];
  syncFreqTolHz: number;
  syncPhaseTolDeg: number;
  syncMinDieselPct: number;
  logGrowthMBperDay: number;
  logMaxMB: number;
  certValidDays: number;
  phoneHomeEnabled: boolean;
  phoneHomeTimeoutDays: number;
  manualRelayAvailable: boolean;
  en50160FreqRange: [number, number];
  en50160FreqExtreme: [number, number];
  en50160VoltRange: [number, number];
  maxTransientMs: number;
  batchRuns: number;
  batchVariance: number;
  mqttBroker: string;
  mqttTopicPrefix: string;
  modbusIP: string;
  modbusPort: number;
  modbusUnitID: number;
  twinUseBackend: boolean;
  twinApiBaseUrl: string;
  twinRealtimeMode: "hil_realtime" | "sil";
  twinProfileId: string;
  twinUseModbus: boolean;
  twinUseOpcua: boolean;
  twinUseMqtt: boolean;
  twinModbusEndpoint: string;
  twinOpcuaEndpoint: string;
  twinMqttEndpoint: string;
  twinSeedBase: number;
}

export interface DataLogRow {
  t: number;
  f: number;
  v: number;
  b: number;
  d: number;
  soc: number;
  l: number;
  thd: number;
  pv: number;
  h: number;
}

export interface LogEntry {
  t: string;
  msg: string;
  level: string;
}

export interface BatchResult {
  run: number;
  freqNadir: number;
  blackoutMs: number;
  freqCompliance: number;
  pass: boolean;
}

export interface ProtocolMessage {
  mqtt: unknown;
  modbus: unknown;
  desc: string;
  val: number;
}

export interface HilState {
  gridOn: boolean;
  wanOn: boolean;
  emsMode: EmsMode;
  invMode: InvMode;
  invSwitching: boolean;
  dieselSt: DieselState;
  dieselKW: number;
  dieselRamp: number;
  dieselPhase: number;
  soc: number;
  battKW: number;
  critOn: boolean;
  ncritOn: boolean;
  motorInrush: boolean;
  motorTimer: number;
  loadShed: boolean;
  loadShedTimer: number;
  freq: number;
  volt: number;
  airDays: number;
  logMB: number;
  certDays: number;
  phoneDays: number;
  empDmg: boolean;
  manRelay: boolean;
  fH: number[];
  vH: number[];
  bH: number[];
  dH: number[];
  lH: number[];
  thd: number;
  harmonics: Record<string, number>;
  thdH: number[];
  simHour: number;
  dataLog: DataLogRow[];
  logs: LogEntry[];
  activeTest: number | null;
  testPhase: TestPhase;
  testResult: TestResult;
  switchMs: number;
  loadShedMs: number;
  dieselSyncMs: number;
  blackoutMs: number;
  freqNadirHz: number;
  voltNadirV: number;
  simTime: number;
  simSpeed: number;
  batchResults: BatchResult[] | null;
  batchRunning: boolean;
  protocolMsgs: ProtocolMessage[];
  remoteRunId: string | null;
  remoteRunState: RemoteRunState;
  remoteRunProgress: number;
  remoteApiStatus: RemoteApiStatus;
  remoteApiLatencyMs: number | null;
  tickDriftAvgMs: number;
  tickDriftMaxMs: number;
  tickDriftP99Ms: number;
  auditFingerprintSha256: string;
  watchdogConfigLoaded: boolean;
  watchdogTicksOk: number;
  watchdogMisses: number;
  watchdogFailSafe: boolean;
  watchdogFailReason: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  HiL TESTING LAB — STUFE 1 PROFITOOL
//  Features: Physics Engine, Load Profiles, Harmonics/THD, Batch Runner,
//            MQTT/Modbus Protocol, PDF Test Protocol Generator
// ═══════════════════════════════════════════════════════════════════════

const TICK_MS = 40;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const rng = (a) => (Math.random() - 0.5) * 2 * a;
const gaussRng = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ─── DEFAULT LOAD PROFILE (24h, normalized 0-1) ───
// Typical military base: low at night, morning ramp, midday peak, evening decline
const DEFAULT_LOAD_PROFILE = [
  0.35, 0.30, 0.28, 0.27, 0.28, 0.35, // 00-05
  0.50, 0.72, 0.85, 0.90, 0.88, 0.92, // 06-11
  0.95, 0.90, 0.85, 0.80, 0.78, 0.82, // 12-17
  0.88, 0.85, 0.75, 0.60, 0.48, 0.40, // 18-23
];

// PV generation curve (normalized, peaks at noon)
const DEFAULT_PV_PROFILE = [
  0, 0, 0, 0, 0, 0.02, // 00-05
  0.08, 0.20, 0.45, 0.70, 0.88, 0.95, // 06-11
  1.0, 0.95, 0.85, 0.68, 0.45, 0.20, // 12-17
  0.05, 0, 0, 0, 0, 0, // 18-23
];

// Diesel generator harmonic spectrum (% of fundamental)
const DIESEL_HARMONICS = { 3: 8.5, 5: 6.2, 7: 4.8, 9: 2.5, 11: 3.1, 13: 2.0, 15: 1.2 };
// Inverter harmonic spectrum (PWM-based)
const INVERTER_HARMONICS = { 3: 2.1, 5: 4.5, 7: 3.8, 9: 1.2, 11: 2.8, 13: 1.9, 15: 0.8 };

function resolveTwinApiBaseUrl() {
  const runtimeUrl = globalThis?.__TWIN_CONFIG__?.apiBaseUrl;
  if (typeof runtimeUrl === "string" && runtimeUrl.trim()) return runtimeUrl.trim();

  const envUrl = (typeof import.meta !== "undefined" && import.meta.env)
    ? import.meta.env.VITE_TWIN_API_BASE_URL
    : "";
  if (typeof envUrl === "string" && envUrl.trim()) return envUrl.trim();

  return "http://127.0.0.1:8000";
}

// ─── CONFIGURATION ───
const DEFAULT_CONFIG: HilConfig = {
  nominalFreq: 50.0, nominalVoltage: 400,
  batteryCapacityKWh: 500, batteryMaxPowerKW: 250, batteryInitSOC: 85,
  inverterSwitchTimeMs: 18, batteryInertiaH: 0.5, droopBattery: 0.04,
  dieselMaxPowerKW: 400, dieselStartDelayMs: 3500, dieselRampTimeMs: 14000,
  dieselInertiaH: 3.0, droopDiesel: 0.05,
  criticalLoadKW: 120, nonCriticalLoadKW: 180,
  motorLoadKW: 40, motorInrushFactor: 5, motorInrushMs: 300,
  loadShedDelayMs: 150,
  pvPeakKW: 100, pvEnabled: true,
  loadProfileEnabled: true, loadProfile: [...DEFAULT_LOAD_PROFILE], pvProfile: [...DEFAULT_PV_PROFILE],
  syncFreqTolHz: 0.15, syncPhaseTolDeg: 10, syncMinDieselPct: 0.5,
  logGrowthMBperDay: 4.8, logMaxMB: 512, certValidDays: 90,
  phoneHomeEnabled: false, phoneHomeTimeoutDays: 14,
  manualRelayAvailable: true,
  en50160FreqRange: [49.5, 50.5], en50160FreqExtreme: [47, 52],
  en50160VoltRange: [360, 440], maxTransientMs: 200,
  // Batch
  batchRuns: 50, batchVariance: 0.15,
  // MQTT
  mqttBroker: "mqtt://192.168.10.1:1883", mqttTopicPrefix: "kaserne/hil/",
  modbusIP: "192.168.10.10", modbusPort: 502, modbusUnitID: 1,
  // Twin Core API
  twinUseBackend: false,
  twinApiBaseUrl: resolveTwinApiBaseUrl(),
  twinRealtimeMode: "hil_realtime",
  twinProfileId: "eon_testinglab_essen_v1",
  twinUseModbus: true,
  twinUseOpcua: true,
  twinUseMqtt: false,
  twinModbusEndpoint: "sim://modbus-eon-testinglab",
  twinOpcuaEndpoint: "sim://opcua-eon-testinglab",
  twinMqttEndpoint: "sim://mqtt-eon-testinglab",
  twinSeedBase: 20260219,
};

const padSeries = (arr, len = 400, fill = 0) => {
  if (arr.length >= len) return arr.slice(arr.length - len);
  return [...Array(len - arr.length).fill(fill), ...arr];
};

function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.detail || ""; } catch (_) {}
      throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
    }
    if (res.status === 204) return null;
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildTwinScenario(testId, c) {
  const base = {
    id: `hil_test_${testId}_v1`,
    version: "1.0.0",
    duration_ms: testId === 3 ? 120000 : 60000,
    tick_ms: 40,
    timeline_events: [],
    disturbances: [],
    expected_assertions: [
      { name: "Frequency floor", metric: "freq_nadir_hz", op: ">=", threshold: c.en50160FreqExtreme[0] },
      { name: "Voltage floor", metric: "volt_nadir_v", op: ">=", threshold: 340 },
      { name: "Blackout budget", metric: "blackout_ms", op: "<=", threshold: 500 },
      { name: "Switch budget", metric: "switch_time_ms", op: "<=", threshold: 200 },
    ],
    metadata: { test_id: testId, source: "hil-stage1-ui" },
  };

  if (testId === 1) {
    base.description = "Guillotine-Schnitt: Netztrennung + Lastabwurf + Dieselanlauf";
    base.timeline_events = [
      { at_ms: 2500, action: "set", target: "grid_on", value: false },
      { at_ms: 2600, action: "set", target: "wan_on", value: false },
    ];
    base.disturbances = [
      { name: "Load step", target: "load_step_kw", start_ms: 2600, duration_ms: 5000, magnitude: c.nonCriticalLoadKW * 0.4 },
    ];
  } else if (testId === 2) {
    base.description = "Frequenz-Krieg: Inselbetrieb mit Synchronisationsrauschen";
    base.timeline_events = [
      { at_ms: 0, action: "set", target: "grid_on", value: false },
      { at_ms: 0, action: "set", target: "ncrit_on", value: false },
    ];
    base.disturbances = [
      { name: "Frequency jitter", target: "frequency_noise", start_ms: 2000, duration_ms: 18000, magnitude: 1.8 },
    ];
  } else if (testId === 3) {
    base.description = "Dunkelhaft: WAN-Ausfall, Long-Run Stabilität, Zertifikats-/Logdruck";
    base.timeline_events = [
      { at_ms: 0, action: "set", target: "wan_on", value: false },
    ];
    base.disturbances = [
      { name: "Mild random load", target: "load_step_kw", start_ms: 20000, duration_ms: 70000, magnitude: c.criticalLoadKW * 0.08 },
    ];
  } else {
    base.description = "Schwarzstart: Grid-Off, Diesel-derating, resiliente Wiederaufnahme";
    base.timeline_events = [
      { at_ms: 0, action: "set", target: "grid_on", value: false },
      { at_ms: 0, action: "set", target: "wan_on", value: false },
      { at_ms: 12000, action: "set", target: "ncrit_on", value: false },
    ];
    base.disturbances = [
      { name: "Diesel stress", target: "diesel_derate_pct", start_ms: 8000, duration_ms: 15000, magnitude: 15.0 },
      { name: "Voltage sag", target: "voltage_sag_pct", start_ms: 9000, duration_ms: 4000, magnitude: 3.5 },
    ];
  }
  return base;
}

function buildTwinModelPack(c) {
  return {
    id: "hil_live_model_pack_v1",
    site_profile: "kaserne-eon-testinglab",
    assets: [
      { id: "grid-1", type: "grid", name: "Grid Intertie", limits: { nominal_freq_hz: c.nominalFreq, nominal_voltage_v: c.nominalVoltage } },
      { id: "battery-1", type: "battery", name: "BESS 1", limits: { p_max_kw: c.batteryMaxPowerKW, soc_init_pct: c.batteryInitSOC } },
      { id: "diesel-1", type: "diesel", name: "NEA 1", limits: { p_max_kw: c.dieselMaxPowerKW } },
      { id: "load-1", type: "load", name: "Critical + Noncritical", limits: { p_critical_kw: c.criticalLoadKW, p_noncritical_kw: c.nonCriticalLoadKW } },
    ],
    parameter_set: {
      nominal_freq_hz: c.nominalFreq,
      nominal_voltage_v: c.nominalVoltage,
      critical_load_kw: c.criticalLoadKW,
      noncritical_load_kw: c.nonCriticalLoadKW,
      battery_capacity_kwh: c.batteryCapacityKWh,
      battery_soc_pct: c.batteryInitSOC,
      battery_max_kw: c.batteryMaxPowerKW,
      diesel_max_kw: c.dieselMaxPowerKW,
      diesel_start_delay_ms: c.dieselStartDelayMs,
      diesel_ramp_time_ms: c.dieselRampTimeMs,
      inverter_switch_time_ms: c.inverterSwitchTimeMs,
      load_shed_delay_ms: c.loadShedDelayMs,
      pv_peak_kw: c.pvPeakKW,
      grid_on: true,
      wan_on: true,
      ncrit_on: true,
      inv_mode: "grid_following",
    },
    calibration_meta: {
      profile: c.twinProfileId,
      source: "hil-stage1-ui",
      ts: new Date().toISOString(),
    },
  };
}

function parseTelemetryJsonl(text) {
  if (!text || !text.trim()) return [];
  return text.trim().split("\n").map(line => JSON.parse(line));
}

function stateFromTwinRecord(prev, record, telemetry, cfg, safety = null) {
  const summary = record?.summary || {};
  const status = record?.status || {};
  const watchdog = safety?.watchdog_summary || record?.watchdog_summary || {};
  const byTs = new Map();

  for (const s of telemetry) {
    if (!byTs.has(s.ts)) {
      byTs.set(s.ts, {
        t: s.ts, f: cfg.nominalFreq, v: cfg.nominalVoltage, b: 0, d: 0,
        soc: cfg.batteryInitSOC, l: cfg.criticalLoadKW + cfg.nonCriticalLoadKW,
        thd: 0, pv: 0, h: ((10 + s.ts / 3600000) % 24),
      });
    }
    const row = byTs.get(s.ts);
    if (s.metric === "frequency_hz") row.f = Number(s.value);
    else if (s.metric === "voltage_v") row.v = Number(s.value);
    else if (s.metric === "battery_power_kw") row.b = Number(s.value);
    else if (s.metric === "diesel_power_kw") row.d = Number(s.value);
    else if (s.metric === "battery_soc_pct") row.soc = Number(s.value);
    else if (s.metric === "load_kw") row.l = Number(s.value);
  }

  const dataLog = Array.from(byTs.values()).sort((a, b) => a.t - b.t);
  const fH = padSeries(dataLog.map(d => d.f), 400, cfg.nominalFreq);
  const vH = padSeries(dataLog.map(d => d.v), 400, cfg.nominalVoltage);
  const bH = padSeries(dataLog.map(d => d.b), 400, 0);
  const dH = padSeries(dataLog.map(d => d.d), 400, 0);
  const lH = padSeries(dataLog.map(d => d.l), 400, cfg.criticalLoadKW + cfg.nonCriticalLoadKW);
  const thdH = padSeries(dataLog.map(d => d.thd || 0), 400, 0);

  return {
    ...prev,
    dataLog,
    fH, vH, bH, dH, lH, thdH,
    freq: dataLog.length ? dataLog[dataLog.length - 1].f : prev.freq,
    volt: dataLog.length ? dataLog[dataLog.length - 1].v : prev.volt,
    battKW: dataLog.length ? dataLog[dataLog.length - 1].b : prev.battKW,
    dieselKW: dataLog.length ? dataLog[dataLog.length - 1].d : prev.dieselKW,
    soc: dataLog.length ? dataLog[dataLog.length - 1].soc : prev.soc,
    simTime: dataLog.length ? dataLog[dataLog.length - 1].t : prev.simTime,
    switchMs: Number(summary.switch_time_ms ?? prev.switchMs ?? 0),
    blackoutMs: Number(summary.blackout_ms ?? prev.blackoutMs ?? 0),
    freqNadirHz: Number(summary.freq_nadir_hz ?? prev.freqNadirHz ?? cfg.nominalFreq),
    voltNadirV: Number(summary.volt_nadir_v ?? prev.voltNadirV ?? cfg.nominalVoltage),
    testResult: status.pass_fail ? "pass" : "fail",
    testPhase: "complete",
    remoteRunId: status.run_id || prev.remoteRunId || null,
    remoteRunState: status.state || prev.remoteRunState || null,
    remoteRunProgress: status.progress ?? prev.remoteRunProgress ?? 0,
    tickDriftAvgMs: Number(summary.tick_drift_avg_ms ?? prev.tickDriftAvgMs ?? 0),
    tickDriftMaxMs: Number(summary.tick_drift_max_ms ?? prev.tickDriftMaxMs ?? 0),
    tickDriftP99Ms: Number(summary.tick_drift_p99_ms ?? prev.tickDriftP99Ms ?? 0),
    auditFingerprintSha256: String(summary.audit_fingerprint_sha256 || prev.auditFingerprintSha256 || ""),
    watchdogConfigLoaded: Boolean(watchdog.watchdog_config_loaded),
    watchdogTicksOk: Number(watchdog.watchdog_ticks_ok ?? 0),
    watchdogMisses: Number(watchdog.watchdog_misses ?? 0),
    watchdogFailSafe: Boolean(watchdog.watchdog_fail_safe),
    watchdogFailReason: String(watchdog.fail_reason || ""),
  };
}

// ─── COLOR SYSTEM ───
const C = {
  bg: "#04070d", panel: "#0a1019", panelAlt: "#0d1525", border: "#182440", borderHi: "#243660",
  accent: "#2563eb", green: "#10b981", greenDim: "#064e3b", red: "#ef4444", redDim: "#450a0a",
  amber: "#f59e0b", amberDim: "#451a03", cyan: "#06b6d4", purple: "#8b5cf6", pink: "#ec4899",
  text: "#94a3b8", textDim: "#475569", textBright: "#e2e8f0", white: "#f8fafc",
  scope: "#39ff14", scopeGrid: "#0a1f0a", scopeBg: "#010802",
};

// ═══════════════════════════════════════════════════════════════════════
//  PHYSICS ENGINE
// ═══════════════════════════════════════════════════════════════════════
function calcTHD(harmonics, loadPct = 1.0) {
  // THD increases at partial load for diesel, decreases for inverter
  const sumSq = Object.entries(harmonics).reduce((s, [, v]) => s + (v * loadPct) ** 2, 0);
  return Math.sqrt(sumSq);
}

function calcHarmonicsSpectrum(dieselPower, dieselMax, battPower, battMax) {
  const spectrum = {};
  const dieselLoad = dieselMax > 0 ? dieselPower / dieselMax : 0;
  const battLoad = battMax > 0 ? Math.abs(battPower) / battMax : 0;
  for (let h = 3; h <= 15; h += 2) {
    const dVal = (DIESEL_HARMONICS[h] || 0) * dieselLoad * (1.3 - 0.3 * dieselLoad); // Worse at partial load
    const iVal = (INVERTER_HARMONICS[h] || 0) * battLoad * 0.9;
    spectrum[h] = Math.sqrt(dVal ** 2 + iVal ** 2); // RSS combination
  }
  return spectrum;
}

function getLoadAtHour(config, hour) {
  if (!config.loadProfileEnabled) return config.criticalLoadKW + config.nonCriticalLoadKW;
  const idx = Math.floor(hour) % 24;
  const frac = hour - Math.floor(hour);
  const a = config.loadProfile[idx];
  const b = config.loadProfile[(idx + 1) % 24];
  const factor = lerp(a, b, frac);
  return (config.criticalLoadKW + config.nonCriticalLoadKW) * factor;
}

function getPVAtHour(config, hour) {
  if (!config.pvEnabled) return 0;
  const idx = Math.floor(hour) % 24;
  const frac = hour - Math.floor(hour);
  const a = config.pvProfile[idx];
  const b = config.pvProfile[(idx + 1) % 24];
  return config.pvPeakKW * lerp(a, b, frac);
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function Scope({ data, label, unit, nominal, lo, hi, compLo, compHi, color = C.scope, h = 110 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, ht = cv.height, range = hi - lo;
    ctx.fillStyle = C.scopeBg; ctx.fillRect(0, 0, w, ht);
    // Grid
    ctx.strokeStyle = C.scopeGrid; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = (i/4)*ht; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    for (let i = 0; i <= 8; i++) { const x = (i/8)*w; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ht); ctx.stroke(); }
    // Compliance band
    if (compLo != null) {
      const y1 = ht - ((compHi - lo)/range)*ht, y2 = ht - ((compLo - lo)/range)*ht;
      ctx.fillStyle = color + "08"; ctx.fillRect(0, y1, w, y2-y1);
      ctx.strokeStyle = color + "25"; ctx.lineWidth = 0.5; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(0,y1); ctx.lineTo(w,y1); ctx.moveTo(0,y2); ctx.lineTo(w,y2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Trace
    if (data.length > 1) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.shadowColor = color; ctx.shadowBlur = 3;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i/(data.length-1))*w, y = ht - ((v-lo)/range)*ht;
        i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      });
      ctx.stroke(); ctx.shadowBlur = 0;
    }
  }, [data, lo, hi, compLo, compHi, color]);
  const cur = data[data.length-1]||0;
  const ok = compLo == null || (cur >= compLo && cur <= compHi);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom: 2 }}>
        <span style={{ fontSize:9, color:C.textDim, textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
        <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
          <span style={{ fontSize:16, fontWeight:800, color: ok ? color : C.red }}>{cur.toFixed(2)}</span>
          <span style={{ fontSize:9, color:C.textDim }}>{unit}</span>
          <span style={{ width:7, height:7, borderRadius:"50%", background: ok ? C.green : C.red, boxShadow:`0 0 5px ${ok?C.green:C.red}` }} />
        </div>
      </div>
      <canvas ref={ref} width={380} height={h} style={{ width:"100%", height:h, borderRadius:3, border:`1px solid ${C.border}` }} />
    </div>
  );
}

function Bar2({ label, value, max, unit, color = C.cyan, warn, crit }) {
  const pct = clamp((value/max)*100,0,100);
  const c = crit && value >= crit ? C.red : warn && value >= warn ? C.amber : color;
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textDim, marginBottom:1 }}>
        <span>{label}</span>
        <span style={{ fontFamily:"monospace", color:c, fontWeight:700 }}>{value.toFixed(1)}{unit}</span>
      </div>
      <div style={{ height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:c, borderRadius:2, transition:"width 0.1s" }}/>
      </div>
    </div>
  );
}

function LED({ on, color=C.green, label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
      <div style={{ width:7, height:7, borderRadius:"50%", background: on?color:C.border, boxShadow: on?`0 0 6px ${color}88`:"none", transition:"all 0.3s" }}/>
      <span style={{ fontSize:10, color: on?C.text:C.textDim }}>{label}</span>
    </div>
  );
}

function Pnl({ title, icon, badge, hl, hlc, children, style:s2 }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${hl?(hlc||C.accent):C.border}`, borderRadius:5, padding:10, boxShadow: hl?`0 0 12px ${(hlc||C.accent)}12`:"none", transition:"all 0.3s", ...s2 }}>
      {title && <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7, paddingBottom:5, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          {icon&&<span style={{fontSize:12}}>{icon}</span>}
          <span style={{ fontSize:10, fontWeight:700, color:C.textBright, textTransform:"uppercase", letterSpacing:"0.06em" }}>{title}</span>
        </div>
        {badge}
      </div>}
      {children}
    </div>
  );
}

function Bdg({ children, color=C.green, pulse }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:color+"15", color, border:`1px solid ${color}30`, borderRadius:3, padding:"1px 6px", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>
      {pulse&&<span style={{ width:5,height:5,borderRadius:"50%",background:color,animation:"pulse 1.5s infinite" }}/>}
      {children}
    </span>
  );
}

function LogLine({ t, msg, level }) {
  const col = { info:C.cyan, warn:C.amber, error:C.red, success:C.green, metric:C.purple, protocol:C.pink }[level]||C.textDim;
  return (
    <div style={{ fontFamily:"monospace", fontSize:9.5, lineHeight:1.7, color:C.textDim, display:"flex", gap:5 }}>
      <span style={{ color:C.textDim, minWidth:48, flexShrink:0 }}>[{t}]</span>
      <span style={{ color:col }}>{level==="error"?"✕":level==="success"?"✓":level==="warn"?"⚠":level==="metric"?"◆":level==="protocol"?"⟶":"ℹ"}</span>
      <span style={{ color: level==="error"||level==="success"?col:C.text }}>{msg}</span>
    </div>
  );
}

function CfgField({ label, value, onChange, unit, min, max, step=1, disabled, type="number", width=58 }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:3 }}>
      <span style={{ fontSize:9, color:C.textDim, flex:1 }}>{label}</span>
      <div style={{ display:"flex", alignItems:"center", gap:3 }}>
        <input
          type={type}
          value={value}
          onChange={e=>onChange(type==="number" ? Number(e.target.value) : e.target.value)}
          min={type==="number" ? min : undefined}
          max={type==="number" ? max : undefined}
          step={type==="number" ? step : undefined}
          disabled={disabled}
          style={{ width, padding:"1px 3px", fontSize:10, fontFamily:"monospace", background:disabled?C.border:C.panelAlt, color:disabled?C.textDim:C.textBright, border:`1px solid ${C.border}`, borderRadius:2, textAlign:type==="number"?"right":"left" }}
        />
        <span style={{ fontSize:8, color:C.textDim, minWidth:22 }}>{unit}</span>
      </div>
    </div>
  );
}

// Tab button
function TabBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex:1, padding:"5px 0", fontSize:9, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer",
      background: active ? C.panelAlt : "transparent", color: active ? C.textBright : C.textDim,
      border:"none", borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
    }}>{label}</button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  BATCH RUNNER — Monte Carlo
// ═══════════════════════════════════════════════════════════════════════
function runBatchSimulation(baseConfig, numRuns, testId) {
  const results = [];
  for (let run = 0; run < numRuns; run++) {
    const v = baseConfig.batchVariance;
    // Vary parameters with Gaussian noise
    const cfg = { ...baseConfig };
    cfg.batteryInitSOC = clamp(cfg.batteryInitSOC + gaussRng() * v * 20, 10, 100);
    cfg.inverterSwitchTimeMs = clamp(cfg.inverterSwitchTimeMs * (1 + gaussRng() * v), 5, 500);
    cfg.dieselStartDelayMs = clamp(cfg.dieselStartDelayMs * (1 + gaussRng() * v), 1000, 15000);
    cfg.dieselRampTimeMs = clamp(cfg.dieselRampTimeMs * (1 + gaussRng() * v), 5000, 30000);
    cfg.batteryInertiaH = clamp(cfg.batteryInertiaH * (1 + gaussRng() * v * 0.5), 0.1, 5);
    cfg.criticalLoadKW = clamp(cfg.criticalLoadKW * (1 + gaussRng() * v * 0.3), 50, 500);
    cfg.nonCriticalLoadKW = clamp(cfg.nonCriticalLoadKW * (1 + gaussRng() * v * 0.3), 50, 1000);

    // Run simplified simulation for this config
    const result = simulateTest(cfg, testId);
    results.push({ run: run + 1, ...result, cfg });
  }
  return results;
}

function simulateTest(cfg, testId) {
  // Simplified physics simulation (faster than real-time)
  let freq = cfg.nominalFreq, volt = cfg.nominalVoltage;
  let freqNadir = freq, voltNadir = volt;
  let blackoutMs = 0, switchTimeMs = cfg.inverterSwitchTimeMs;
  let battSOC = cfg.batteryInitSOC;
  let dieselPower = 0, battPower = 0;
  let freqData = [], totalSteps = 500;

  const critLoad = cfg.criticalLoadKW;
  const totalLoad = critLoad + cfg.nonCriticalLoadKW;

  if (testId === 1) {
    // Simulate guillotine cut
    for (let i = 0; i < totalSteps; i++) {
      const t = i * 40; // ms
      let supply = 0, demand = totalLoad, H = 0, S = 0;

      if (t < 100) {
        // Grid still on
        freq = cfg.nominalFreq + rng(0.01);
        volt = cfg.nominalVoltage + rng(0.3);
      } else if (t < 100 + cfg.inverterSwitchTimeMs) {
        // Switching gap
        freq -= 0.05;
        volt -= 2;
      } else {
        // Island mode
        if (t < 100 + cfg.inverterSwitchTimeMs + cfg.loadShedDelayMs) {
          demand = totalLoad; // Before load shed
        } else {
          demand = critLoad; // After load shed
        }

        // Battery
        battPower = Math.min(cfg.batteryMaxPowerKW, demand);
        supply += battPower;
        H += cfg.batteryInertiaH;
        S += cfg.batteryMaxPowerKW;
        battSOC -= (battPower * 0.04) / (cfg.batteryCapacityKWh * 36);

        // Diesel ramp
        const dieselTime = t - 100 - cfg.inverterSwitchTimeMs - 500;
        if (dieselTime > cfg.dieselStartDelayMs) {
          const rampPct = Math.min(1, (dieselTime - cfg.dieselStartDelayMs) / cfg.dieselRampTimeMs);
          dieselPower = rampPct * cfg.dieselMaxPowerKW;
          supply += dieselPower;
          H += cfg.dieselInertiaH;
          S += cfg.dieselMaxPowerKW;
        }

        const dP = supply - demand;
        const df = S > 0 ? (dP / (2 * H * S)) * 0.04 * 50 : 0;
        freq += df;
        freq = lerp(freq, cfg.nominalFreq, 0.005);
        freq += rng(0.08);
        volt = cfg.nominalVoltage * (1 - (demand / (S || 1)) * 0.08) + rng(2);
      }

      freq = clamp(freq, 0, 55);
      volt = clamp(volt, 0, 460);
      freqNadir = Math.min(freqNadir, freq);
      voltNadir = Math.min(voltNadir, volt);
      if (freq < 45) blackoutMs += 40;
      freqData.push(freq);
    }
  } else if (testId === 2) {
    // Frequency war simulation
    for (let i = 0; i < totalSteps; i++) {
      const t = i * 40;
      let demand = critLoad;

      battPower = Math.min(cfg.batteryMaxPowerKW, demand * 0.8);
      let supply = battPower;

      if (t > cfg.dieselStartDelayMs) {
        const rampPct = Math.min(1, (t - cfg.dieselStartDelayMs) / cfg.dieselRampTimeMs);
        dieselPower = rampPct * cfg.dieselMaxPowerKW * 0.7;
        supply += dieselPower;
        // Phase interaction
        const phaseConflict = rng(0.3) * (1 - rampPct);
        freq += phaseConflict;
      }

      const H = cfg.batteryInertiaH + (dieselPower > 0 ? cfg.dieselInertiaH : 0);
      const S = cfg.batteryMaxPowerKW + (dieselPower > 0 ? cfg.dieselMaxPowerKW : 0);
      const dP = supply - demand;
      freq += S > 0 ? (dP / (2 * H * S)) * 0.04 * 50 : 0;
      freq = lerp(freq, cfg.nominalFreq, 0.008);
      freq += rng(0.05);
      volt = cfg.nominalVoltage * (1 - demand / (S || 1) * 0.06) + rng(1.5);

      freq = clamp(freq, 0, 55);
      volt = clamp(volt, 0, 460);
      freqNadir = Math.min(freqNadir, freq);
      voltNadir = Math.min(voltNadir, volt);
      if (freq < 45) blackoutMs += 40;
      freqData.push(freq);
    }
  }

  // EN 50160 check
  const inRangeF = freqData.filter(f => f >= cfg.en50160FreqRange[0] && f <= cfg.en50160FreqRange[1]).length;
  const freqCompliance = (inRangeF / freqData.length) * 100;
  const extremeViolation = freqData.some(f => f < cfg.en50160FreqExtreme[0] || f > cfg.en50160FreqExtreme[1]);
  const pass = freqCompliance >= 95 && !extremeViolation && blackoutMs < 500;

  return {
    pass,
    freqNadir: freqNadir,
    voltNadir: voltNadir,
    blackoutMs,
    switchTimeMs,
    freqCompliance,
    extremeViolation,
    finalSOC: battSOC,
    freqData,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  MQTT / MODBUS PROTOCOL SIMULATOR
// ═══════════════════════════════════════════════════════════════════════
const MQTT_TOPICS = [
  { topic: "frequency", desc: "Netzfrequenz", unit: "Hz", register: 40001 },
  { topic: "voltage", desc: "Spannung L1-L3", unit: "V", register: 40003 },
  { topic: "battery/soc", desc: "Batterie SOC", unit: "%", register: 40010 },
  { topic: "battery/power", desc: "Batterie Leistung", unit: "kW", register: 40012 },
  { topic: "diesel/state", desc: "NEA Status", unit: "enum", register: 40020 },
  { topic: "diesel/power", desc: "NEA Leistung", unit: "kW", register: 40022 },
  { topic: "ems/mode", desc: "EMS Betriebsart", unit: "enum", register: 40030 },
  { topic: "load/critical", desc: "Krit. Last", unit: "kW", register: 40040 },
  { topic: "load/noncritical", desc: "Nicht-krit. Last", unit: "kW", register: 40042 },
  { topic: "inverter/mode", desc: "WR Modus", unit: "enum", register: 40050 },
  { topic: "thd/total", desc: "THD Gesamt", unit: "%", register: 40060 },
  { topic: "compliance/en50160", desc: "EN 50160 Status", unit: "bool", register: 40070 },
];

function generateMQTTMessage(prefix, topic, value, qos = 1) {
  return {
    topic: `${prefix}${topic}`,
    payload: JSON.stringify({ v: value, ts: Date.now(), q: qos }),
    qos,
    retain: topic.includes("state") || topic.includes("mode"),
  };
}

function generateModbusFrame(unitId, register, value) {
  // Modbus TCP read holding registers response (simplified)
  const txId = Math.floor(Math.random() * 65535);
  const valHex = Math.round(value * 100).toString(16).padStart(4, "0");
  return `[${txId.toString(16).padStart(4,"0")}] Unit:${unitId} FC:03 Reg:${register} Val:0x${valHex} (${value.toFixed(2)})`;
}

// ═══════════════════════════════════════════════════════════════════════
//  PDF REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════
function generateTestReport(state, config, compliance, testId) {
  const testNames = { 1: "Guillotine-Schnitt (Lastabwurf)", 2: "Frequenz-Krieg (Synchronisation)", 3: "30-Tage-Dunkelhaft (Air-Gap)", 4: "Schwarzstart (EMP)" };
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const pass = state.testResult === "pass";
  const switchMs = state.switchMs ?? state.switchTimeMs ?? 0;
  const blackoutMs = state.blackoutMs ?? state.totalBlackoutMs ?? 0;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>HiL Testprotokoll - Test ${testId}</title>
<style>
@page { size: A4; margin: 20mm; }
body { font-family: 'Courier New', monospace; font-size: 11px; color: #1a1a1a; line-height: 1.5; }
h1 { font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 2px; }
h2 { font-size: 13px; border-bottom: 1px solid #666; padding-bottom: 2px; margin-top: 16px; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #333; padding: 4px 8px; text-align: left; font-size: 10px; }
th { background: #e8e8e8; font-weight: bold; }
.pass { color: #006600; font-weight: bold; } .fail { color: #cc0000; font-weight: bold; }
.header-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; }
.stamp { border: 3px solid ${pass?"#006600":"#cc0000"}; padding: 8px 16px; display: inline-block; font-size: 18px; font-weight: bold; color: ${pass?"#006600":"#cc0000"}; transform: rotate(-3deg); margin: 10px 0; text-transform: uppercase; letter-spacing: 3px; }
.classification { text-align: center; font-size: 12px; font-weight: bold; letter-spacing: 4px; margin: 8px 0; padding: 4px; border: 1px solid #000; }
.footer { margin-top: 20px; border-top: 1px solid #000; padding-top: 8px; font-size: 9px; }
</style></head><body>
<div class="classification">VS - NUR FÜR DEN DIENSTGEBRAUCH</div>
<h1>⚡ HiL TESTPROTOKOLL</h1>
<div class="header-grid">
<div><strong>Prüfgegenstand:</strong> EMS Split-Brain Architektur<br><strong>Test:</strong> ${testId} — ${testNames[testId]}<br><strong>Prüfstand:</strong> HiL TestingLab v1.0</div>
<div><strong>Datum:</strong> ${now}<br><strong>Prüfer:</strong> ____________________<br><strong>Aktenzeichen:</strong> HIL-${testId}-${Date.now().toString(36).toUpperCase()}</div>
</div>
<div class="stamp">${pass ? "BESTANDEN" : "DURCHGEFALLEN"}</div>

<h2>1. Systemkonfiguration</h2>
<table>
<tr><th>Parameter</th><th>Wert</th><th>Parameter</th><th>Wert</th></tr>
<tr><td>Batterie Kapazität</td><td>${config.batteryCapacityKWh} kWh</td><td>NEA Max. Leistung</td><td>${config.dieselMaxPowerKW} kW</td></tr>
<tr><td>Batterie Max. Leistung</td><td>${config.batteryMaxPowerKW} kW</td><td>NEA Startzeit</td><td>${config.dieselStartDelayMs} ms</td></tr>
<tr><td>Batterie Init SOC</td><td>${config.batteryInitSOC}%</td><td>NEA Rampe</td><td>${config.dieselRampTimeMs} ms</td></tr>
<tr><td>WR Umschaltzeit</td><td>${config.inverterSwitchTimeMs} ms</td><td>Diesel Trägheit H</td><td>${config.dieselInertiaH} s</td></tr>
<tr><td>Batterie Trägheit H</td><td>${config.batteryInertiaH} s</td><td>Kritische Last</td><td>${config.criticalLoadKW} kW</td></tr>
<tr><td>Droop Batterie</td><td>${(config.droopBattery*100).toFixed(1)}%</td><td>Nicht-krit. Last</td><td>${config.nonCriticalLoadKW} kW</td></tr>
</table>

<h2>2. Messergebnisse</h2>
<table>
<tr><th>Messgröße</th><th>Gemessen</th><th>Grenzwert</th><th>Ergebnis</th></tr>
<tr><td>Frequenz-Nadir</td><td>${state.freqNadirHz.toFixed(3)} Hz</td><td>≥ ${config.en50160FreqExtreme[0]} Hz</td><td class="${state.freqNadirHz>=config.en50160FreqExtreme[0]?"pass":"fail"}">${state.freqNadirHz>=config.en50160FreqExtreme[0]?"PASS":"FAIL"}</td></tr>
<tr><td>Spannungs-Nadir</td><td>${state.voltNadirV.toFixed(1)} V</td><td>≥ 340 V</td><td class="${state.voltNadirV>=340?"pass":"fail"}">${state.voltNadirV>=340?"PASS":"FAIL"}</td></tr>
<tr><td>Umschaltzeit</td><td>${switchMs.toFixed(0)} ms</td><td>≤ 200 ms</td><td class="${switchMs<=200?"pass":"fail"}">${switchMs<=200?"PASS":"FAIL"}</td></tr>
<tr><td>Blackout-Dauer</td><td>${blackoutMs.toFixed(0)} ms</td><td>≤ 500 ms</td><td class="${blackoutMs<=500?"pass":"fail"}">${blackoutMs<=500?"PASS":"FAIL"}</td></tr>
</table>

<h2>3. EN 50160 / VDE Compliance</h2>
<table>
<tr><th>Norm</th><th>Anforderung</th><th>Ergebnis</th><th>Status</th></tr>
${compliance.map(c => `<tr><td>${c.name}</td><td>${c.detail}</td><td>${c.value}</td><td class="${c.pass?"pass":"fail"}">${c.pass?"PASS":"FAIL"}</td></tr>`).join("")}
</table>

<h2>4. Ereignisprotokoll (Auszug)</h2>
<table>
<tr><th>Zeit</th><th>Ereignis</th><th>Typ</th></tr>
${state.logs.slice(0, 25).reverse().map(l => `<tr><td>${l.t}</td><td>${l.msg}</td><td>${l.level}</td></tr>`).join("")}
</table>

<h2>5. Bewertung</h2>
<p><strong>Gesamtergebnis: <span class="${pass?"pass":"fail"}">${pass?"BESTANDEN":"DURCHGEFALLEN"}</span></strong></p>
<p>Bemerkungen: ___________________________________________________________</p>
<p>___________________________________________________________</p>

<div class="footer">
<div class="header-grid">
<div>Prüfer: ____________________<br>Datum/Unterschrift</div>
<div>Technischer Leiter: ____________________<br>Datum/Unterschrift</div>
</div>
<div style="text-align:center;margin-top:8px">HiL TestingLab · Split-Brain EMS · MIL-Mode Zertifizierung<br>Generiert: ${now}</div>
</div>
<div class="classification">VS - NUR FÜR DEN DIENSTGEBRAUCH</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    const revoke = () => URL.revokeObjectURL(url);
    win.addEventListener("afterprint", revoke, { once: true });
    setTimeout(() => { if (!win.closed) win.print(); }, 500);
    setTimeout(revoke, 5000);
  } else {
    URL.revokeObjectURL(url);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  EN 50160 CHECK
// ═══════════════════════════════════════════════════════════════════════
function checkEN50160(fH, vH, cfg) {
  const fMin=cfg.en50160FreqRange[0], fMax=cfg.en50160FreqRange[1];
  const fir = fH.filter(f=>f>=fMin&&f<=fMax).length;
  const fpct = (fir/fH.length)*100;
  const fext = fH.some(f=>f<cfg.en50160FreqExtreme[0]||f>cfg.en50160FreqExtreme[1]);
  const vMin=cfg.en50160VoltRange[0], vMax=cfg.en50160VoltRange[1];
  const vir = vH.filter(v=>v>=vMin&&v<=vMax).length;
  const vpct = (vir/vH.length)*100;
  let maxT=0,curT=0;
  for(const f of fH){if(f<fMin||f>fMax){curT+=TICK_MS;maxT=Math.max(maxT,curT)}else{curT=0}}
  return [
    { name:"EN 50160 §4.2 Frequenz ±1%", value:`${fpct.toFixed(1)}%`, pass: fpct>=95||fH.length<20, detail:`95% in [${fMin}–${fMax}] Hz` },
    { name:"EN 50160 §4.2 Extremwerte", value:fext?"VERLETZT":"OK", pass:!fext, detail:`[${cfg.en50160FreqExtreme[0]}–${cfg.en50160FreqExtreme[1]}] Hz` },
    { name:"EN 50160 §4.3 Spannung ±10%", value:`${vpct.toFixed(1)}%`, pass: vpct>=95||vH.length<20, detail:`95% in [${vMin}–${vMax}] V` },
    { name:"VDE-AR-N 4105 Transient", value:`${maxT} ms`, pass: maxT<=cfg.maxTransientMs, detail:`Max: ${cfg.maxTransientMs} ms` },
  ];
}

// ═══════════════════════════════════════════════════════════════════════
//  INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════
function mkState(cfg: HilConfig): HilState {
  return {
    gridOn:true, wanOn:true, emsMode:"cloud", invMode:"grid-following", invSwitching:false,
    dieselSt:"off", dieselKW:0, dieselRamp:0, dieselPhase:0,
    soc:cfg.batteryInitSOC, battKW:0,
    critOn:true, ncritOn:true, motorInrush:false, motorTimer:0,
    loadShed:false, loadShedTimer:0,
    freq:cfg.nominalFreq, volt:cfg.nominalVoltage,
    airDays:0, logMB:12, certDays:cfg.certValidDays, phoneDays:cfg.phoneHomeTimeoutDays,
    empDmg:false, manRelay:false,
    fH:Array(400).fill(cfg.nominalFreq), vH:Array(400).fill(cfg.nominalVoltage),
    bH:Array(400).fill(0), dH:Array(400).fill(0), lH:Array(400).fill(cfg.criticalLoadKW+cfg.nonCriticalLoadKW),
    // Harmonics
    thd: 0, harmonics: {},
    thdH: Array(400).fill(0),
    // Sim hour for load profile
    simHour: 10, // Start at 10:00
    dataLog:[], logs:[],
    activeTest:null, testPhase:null, testResult:null,
    switchMs:0, loadShedMs:0, dieselSyncMs:0, blackoutMs:0,
    freqNadirHz:cfg.nominalFreq, voltNadirV:cfg.nominalVoltage,
    simTime:0, simSpeed:1,
    // Batch
    batchResults:null, batchRunning:false,
    // Protocol messages
    protocolMsgs:[],
    // Twin Core backend run state
    remoteRunId:null, remoteRunState:null, remoteRunProgress:0,
    remoteApiStatus:"unknown", remoteApiLatencyMs:null,
    tickDriftAvgMs:0, tickDriftMaxMs:0, tickDriftP99Ms:0,
    auditFingerprintSha256:"",
    watchdogConfigLoaded:false, watchdogTicksOk:0, watchdogMisses:0, watchdogFailSafe:false, watchdogFailReason:"",
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function HiLPro() {
  const [cfg, setCfg] = useState<HilConfig>({ ...DEFAULT_CONFIG });
  const [st, setSt] = useState<HilState>(() => mkState(cfg));
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("scope");
  const [showCfg, setShowCfg] = useState(false);
  const stR = useRef(st); stR.current = st;
  const cfgR = useRef(cfg); cfgR.current = cfg;
  const tickR = useRef(null);
  const timeoutIdsR = useRef(new Set());
  const intervalIdsR = useRef(new Set());
  const remotePollR = useRef(null);

  const scheduleTimeout = useCallback((fn, delayMs) => {
    const id = setTimeout(() => {
      timeoutIdsR.current.delete(id);
      fn();
    }, delayMs);
    timeoutIdsR.current.add(id);
    return id;
  }, []);

  const scheduleInterval = useCallback((fn, delayMs) => {
    const id = setInterval(fn, delayMs);
    intervalIdsR.current.add(id);
    return id;
  }, []);

  const clearScheduledInterval = useCallback((id) => {
    clearInterval(id);
    intervalIdsR.current.delete(id);
  }, []);

  const clearAllSchedules = useCallback(() => {
    timeoutIdsR.current.forEach(id => clearTimeout(id));
    intervalIdsR.current.forEach(id => clearInterval(id));
    timeoutIdsR.current.clear();
    intervalIdsR.current.clear();
  }, []);

  const clearRemotePolling = useCallback(() => {
    if (remotePollR.current) {
      clearInterval(remotePollR.current);
      remotePollR.current = null;
    }
  }, []);

  const log = useCallback((msg, level="info")=>{
    setSt(s=>{
      const t = s.simTime<60000?`${(s.simTime/1000).toFixed(1)}s`:`${(s.simTime/60000).toFixed(1)}m`;
      return {...s, logs:[{t,msg,level},...s.logs].slice(0,250)};
    });
  },[]);

  useEffect(() => {
    let stopped = false;
    const baseUrl = normalizeBaseUrl(cfg.twinApiBaseUrl);

    if (!cfg.twinUseBackend) {
      setSt(s => ({ ...s, remoteApiStatus: "disabled", remoteApiLatencyMs: null }));
      return;
    }

    if (!baseUrl) {
      setSt(s => ({ ...s, remoteApiStatus: "misconfigured", remoteApiLatencyMs: null }));
      return;
    }

    const checkApi = async () => {
      const started = Date.now();
      try {
        await fetchJsonWithTimeout(`${baseUrl}/api/v1/health`, {}, 6000);
        await fetchJsonWithTimeout(`${baseUrl}/api/v1/ready`, {}, 6000);
        if (stopped) return;
        setSt(s => ({
          ...s,
          remoteApiStatus: "ok",
          remoteApiLatencyMs: Math.max(1, Date.now() - started),
        }));
      } catch (_err) {
        if (stopped) return;
        setSt(s => ({ ...s, remoteApiStatus: "down", remoteApiLatencyMs: null }));
      }
    };

    setSt(s => ({ ...s, remoteApiStatus: "checking", remoteApiLatencyMs: null }));
    void checkApi();
    const intervalId = setInterval(() => { void checkApi(); }, 15000);

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }, [cfg.twinUseBackend, cfg.twinApiBaseUrl]);

  // Protocol message generator
  const emitProtocol = useCallback((s, c)=>{
    const msgs = MQTT_TOPICS.slice(0,6).map(t=>{
      let val;
      switch(t.topic){
        case "frequency": val=s.freq; break;
        case "voltage": val=s.volt; break;
        case "battery/soc": val=s.soc; break;
        case "battery/power": val=s.battKW; break;
        case "diesel/state": val=["off","cranking","running","syncing","synced"].indexOf(s.dieselSt); break;
        case "diesel/power": val=s.dieselKW; break;
        default: val=0;
      }
      return {
        mqtt: generateMQTTMessage(c.mqttTopicPrefix, t.topic, val),
        modbus: generateModbusFrame(c.modbusUnitID, t.register, val),
        desc: t.desc, val,
      };
    });
    return msgs;
  },[]);

  // ─── PHYSICS TICK ───
  const tick = useCallback(()=>{
    setSt(prev=>{
      const c = cfgR.current;
      const dt = TICK_MS/1000;
      const dtMs = TICK_MS * prev.simSpeed;
      const s = {...prev, simTime: prev.simTime+dtMs};

      // Sim hour advances
      s.simHour = (prev.simHour + dtMs / 3600000) % 24;

      // ── Demand with load profile ──
      let demandKW = 0;
      if (c.loadProfileEnabled) {
        const profileLoad = getLoadAtHour(c, s.simHour);
        const totalCfgLoad = c.criticalLoadKW + c.nonCriticalLoadKW;
        const critRatio = totalCfgLoad > 0 ? c.criticalLoadKW / totalCfgLoad : 0.5;
        demandKW += s.critOn ? profileLoad * critRatio : 0;
        demandKW += s.ncritOn ? profileLoad * (1 - critRatio) : 0;
      } else {
        if (s.critOn) demandKW += c.criticalLoadKW;
        if (s.ncritOn) demandKW += c.nonCriticalLoadKW;
      }
      if (s.motorInrush) {
        demandKW += c.motorLoadKW * c.motorInrushFactor;
        s.motorTimer -= dtMs;
        if (s.motorTimer <= 0) s.motorInrush = false;
      }

      // ── PV generation ──
      const pvKW = getPVAtHour(c, s.simHour);

      // ── Supply ──
      let supplyKW = 0, H = 0, S = 0;

      if (s.gridOn) { supplyKW = demandKW; H = 50; S = 10000; }

      // PV (grid-following, only when grid or inverter active)
      if (s.gridOn || s.invMode === "grid-forming") {
        supplyKW += pvKW;
      }

      // Diesel
      if (s.dieselSt==="cranking") {
        s.dieselRamp += dtMs/c.dieselStartDelayMs;
        if (s.dieselRamp>=1){s.dieselSt="running";s.dieselRamp=0;s.dieselKW=0;}
      }
      if (s.dieselSt==="running") {
        const tgt = Math.min(c.dieselMaxPowerKW, demandKW*0.8);
        s.dieselRamp = Math.min(1, s.dieselRamp+dtMs/c.dieselRampTimeMs);
        s.dieselKW = lerp(s.dieselKW, tgt*s.dieselRamp, 0.05);
        s.dieselPhase += rng(2)*dt; s.dieselPhase = lerp(s.dieselPhase, 0, 0.02);
        if (s.dieselRamp > c.syncMinDieselPct) s.dieselSt = "syncing";
      }
      if (s.dieselSt==="syncing") {
        s.dieselRamp = Math.min(1, s.dieselRamp+dtMs/c.dieselRampTimeMs);
        s.dieselKW = lerp(s.dieselKW, Math.min(c.dieselMaxPowerKW, demandKW)*s.dieselRamp, 0.08);
        s.dieselPhase = lerp(s.dieselPhase, 0, 0.06); s.dieselPhase += rng(0.8)*dt;
        if (Math.abs(s.freq-c.nominalFreq)<c.syncFreqTolHz && Math.abs(s.dieselPhase)<c.syncPhaseTolDeg && s.dieselRamp>0.7) {
          s.dieselSt="synced"; s.dieselSyncMs = s.simTime-(s.dieselSyncMs||s.simTime);
        }
      }
      if (s.dieselSt==="synced") {
        s.dieselKW = lerp(s.dieselKW, Math.min(c.dieselMaxPowerKW, demandKW), 0.04);
        s.dieselPhase = lerp(s.dieselPhase, 0, 0.1); s.dieselPhase += rng(0.3)*dt;
      }
      if (s.dieselSt==="running"||s.dieselSt==="syncing"||s.dieselSt==="synced") {
        supplyKW += s.dieselKW; H += c.dieselInertiaH; S += c.dieselMaxPowerKW;
      }

      // Battery
      if (s.invMode==="grid-forming" && !s.empDmg) {
        const deficit = demandKW - supplyKW + s.battKW;
        const maxP = Math.min(c.batteryMaxPowerKW, s.soc*0.01*c.batteryCapacityKWh/dt*0.1);
        s.battKW = lerp(s.battKW, clamp(deficit, -c.batteryMaxPowerKW*0.3, maxP), 0.2);
        supplyKW += s.battKW;
        H += c.batteryInertiaH; S += c.batteryMaxPowerKW;
        s.soc -= (s.battKW*dtMs)/(c.batteryCapacityKWh*36000);
        s.soc = clamp(s.soc, 0, 100);
      } else if (s.gridOn && !s.empDmg && s.soc<95) {
        s.battKW = -15;
        s.soc = Math.min(100, s.soc+(15*dtMs)/(c.batteryCapacityKWh*36000));
      } else if (!s.empDmg) { s.battKW = lerp(s.battKW, 0, 0.1); }

      // ── Frequency ──
      if (!s.gridOn && !s.empDmg && H>0) {
        const dP = supplyKW - demandKW;
        s.freq += (dP/(2*H*(S||1)))*dt*0.3*c.nominalFreq;
        s.freq = lerp(s.freq, c.nominalFreq, 0.003);
        if (s.dieselSt==="running"||s.dieselSt==="syncing") s.freq += rng(0.12);
        if (s.dieselSt==="synced") s.freq += rng(0.04);
        if (s.invMode==="grid-forming") s.freq += rng(0.02);
      } else if (s.gridOn) {
        s.freq = lerp(s.freq, c.nominalFreq, 0.3) + rng(0.01);
      } else if (s.empDmg && !s.manRelay) {
        s.freq = lerp(s.freq, 0, 0.02);
      } else if (s.manRelay && s.dieselSt==="synced") {
        s.freq = lerp(s.freq, c.nominalFreq, 0.04) + rng(0.2);
      }

      // ── Voltage ──
      if (!s.gridOn && !s.empDmg && S>0) {
        s.volt = lerp(s.volt, c.nominalVoltage*(1-demandKW/(S||1)*0.08), 0.08);
        if (s.dieselSt==="syncing") s.volt += rng(3);
        if (s.dieselSt==="synced") s.volt += rng(1);
        s.volt += rng(0.8);
      } else if (s.gridOn) {
        s.volt = lerp(s.volt, c.nominalVoltage, 0.3) + rng(0.2);
      } else if (s.empDmg && !s.manRelay) {
        s.volt = lerp(s.volt, 0, 0.02);
      } else if (s.manRelay && s.dieselSt==="synced") {
        s.volt = lerp(s.volt, c.nominalVoltage, 0.04) + rng(3);
      }

      s.freq = clamp(s.freq, 0, 55);
      s.volt = clamp(s.volt, 0, 460);

      // ── Harmonics / THD ──
      s.harmonics = calcHarmonicsSpectrum(s.dieselKW, c.dieselMaxPowerKW, s.battKW, c.batteryMaxPowerKW);
      s.thd = calcTHD(s.harmonics);
      if (s.gridOn) s.thd = 1.2 + rng(0.3); // Grid THD ~1-2%

      // ── Load shed timer ──
      if (s.loadShedTimer>0){s.loadShedTimer-=dtMs; if(s.loadShedTimer<=0){s.ncritOn=false;s.loadShed=true;s.loadShedMs=s.simTime;}}

      // ── Metrics ──
      if (s.activeTest && s.freq>0) { s.freqNadirHz=Math.min(s.freqNadirHz,s.freq); s.voltNadirV=Math.min(s.voltNadirV,s.volt); }
      if (s.freq<45 && !s.empDmg) s.blackoutMs += dtMs;

      // ── History ──
      s.fH=[...prev.fH.slice(1),s.freq];
      s.vH=[...prev.vH.slice(1),s.volt];
      s.bH=[...prev.bH.slice(1),s.battKW];
      s.dH=[...prev.dH.slice(1),s.dieselKW];
      const curLoad = (s.critOn?c.criticalLoadKW:0)+(s.ncritOn?c.nonCriticalLoadKW:0);
      s.lH=[...prev.lH.slice(1),curLoad];
      s.thdH=[...prev.thdH.slice(1),s.thd];

      // Data log + protocol (every 5th tick)
      if (s.simTime%(TICK_MS*5)<dtMs) {
        s.dataLog=[...prev.dataLog,{t:s.simTime,f:s.freq,v:s.volt,b:s.battKW,d:s.dieselKW,soc:s.soc,l:curLoad,thd:s.thd,pv:pvKW,h:s.simHour}];
        s.protocolMsgs = emitProtocol(s, c);
      }

      return s;
    });
  },[emitProtocol]);

  useEffect(()=>{
    if(running) tickR.current=setInterval(tick,TICK_MS);
    return ()=>clearInterval(tickR.current);
  },[running,tick]);

  useEffect(() => () => {
    clearInterval(tickR.current);
    clearAllSchedules();
    clearRemotePolling();
  }, [clearAllSchedules, clearRemotePolling]);

  const reset = useCallback(()=>{
    setRunning(false);
    clearInterval(tickR.current);
    clearAllSchedules();
    clearRemotePolling();
    setSt(mkState(cfgR.current));
  },[clearAllSchedules, clearRemotePolling]);
  const uCfg = useCallback((k,v)=>setCfg(c=>({...c,[k]:v})),[]);

  // ─── TEST RUNNERS (same logic as before, streamlined) ───
  const runTest = useCallback((testId)=>{
    const c = cfgR.current;
    reset();
    scheduleTimeout(()=>{
      const base = mkState(c);
      if(testId===1){
        setSt({...base,activeTest:1,testPhase:"friedensbetrieb"});
        setRunning(true);
        log("══════ TEST 1: GUILLOTINE-SCHNITT ══════","warn");
        log(`Last: ${c.criticalLoadKW+c.nonCriticalLoadKW} kW | Batterie: ${c.batteryInitSOC}% | PV: ${c.pvEnabled?"ON":"OFF"}`,"info");

        scheduleTimeout(()=>{
          log("▼▼▼ NETZ + WAN GEKAPPT ▼▼▼","error");
          const t0 = stR.current.simTime;
          setSt(s=>({...s,gridOn:false,wanOn:false,testPhase:"disconnect",invSwitching:true}));

          scheduleTimeout(()=>{
            setSt(s=>({...s,invMode:"grid-forming",invSwitching:false,emsMode:"local",switchMs:stR.current.simTime-t0,testPhase:"grid-forming"}));
            log(`WR: Grid-Following → Grid-Forming [${(stR.current.simTime-t0).toFixed(0)}ms]`,"success");
            log("Lokales EMS übernimmt","success");

            setSt(s=>({...s,loadShedTimer:c.loadShedDelayMs}));
            scheduleTimeout(()=>{
              log(`Load Shedding [${(stR.current.simTime-t0).toFixed(0)}ms]`,"warn");
              scheduleTimeout(()=>{
                log("NEA: Startbefehl","info");
                const dStart = stR.current.simTime;
                setSt(s=>({...s,dieselSt:"cranking",dieselSyncMs:dStart,testPhase:"diesel"}));

                const chk = scheduleInterval(()=>{
                  const cs = stR.current;
                  if(cs.dieselSt==="synced"){
                    clearScheduledInterval(chk);
                    log(`NEA sync [${((cs.simTime-dStart)/1000).toFixed(1)}s]`,"success");
                    setSt(p=>({...p,ncritOn:true,loadShed:false,testPhase:"restoring"}));
                    scheduleTimeout(()=>{
                      log("Motorlast: Einschaltstrom!","warn");
                      setSt(p=>({...p,motorInrush:true,motorTimer:c.motorInrushMs}));
                      scheduleTimeout(()=>{
                        const fin = stR.current;
                        const comp = checkEN50160(fin.fH,fin.vH,c);
                        const pass = comp.every(x=>x.pass) && fin.blackoutMs<500;
                        log("══════ AUSWERTUNG ══════","warn");
                        log(`Umschaltzeit: ${fin.switchMs.toFixed(0)}ms | f_nadir: ${fin.freqNadirHz.toFixed(2)}Hz | Blackout: ${fin.blackoutMs.toFixed(0)}ms`,"metric");
                        comp.forEach(x=>log(`${x.pass?"✓":"✕"} ${x.name}: ${x.value}`,x.pass?"success":"error"));
                        log(pass?"══════ TEST 1: BESTANDEN ══════":"══════ TEST 1: DURCHGEFALLEN ══════",pass?"success":"error");
                        setSt(p=>({...p,testPhase:"complete",testResult:pass?"pass":"fail"}));
                      },2500);
                    },800);
                  }
                },200);
              },400);
            },c.loadShedDelayMs+50);
          },c.inverterSwitchTimeMs);
        },2500);
      }

      if(testId===2){
        setSt({...base,activeTest:2,testPhase:"island",gridOn:false,wanOn:false,emsMode:"local",invMode:"grid-forming",ncritOn:false,loadShed:true,soc:65,battKW:c.criticalLoadKW});
        setRunning(true);
        log("══════ TEST 2: FREQUENZ-KRIEG ══════","warn");
        log("Inselbetrieb: Batterie Grid-Forming, NEA wird zugeschaltet","info");
        scheduleTimeout(()=>{
          log("NEA: Startbefehl","info");
          const dStart = stR.current.simTime;
          setSt(s=>({...s,dieselSt:"cranking",dieselSyncMs:dStart,testPhase:"cranking"}));
          let lastLog=0;
          const chk=scheduleInterval(()=>{
            const cs=stR.current;
            if(cs.dieselSt==="syncing"&&cs.simTime-lastLog>1200){
              log(`Sync: Δf=${Math.abs(cs.freq-c.nominalFreq).toFixed(3)}Hz Δφ=${Math.abs(cs.dieselPhase).toFixed(1)}° NEA=${cs.dieselKW.toFixed(0)}kW`,"metric");
              lastLog=cs.simTime;
              setSt(p=>({...p,testPhase:"syncing"}));
              if(Math.abs(cs.freq-c.nominalFreq)>2.5){
                clearScheduledInterval(chk);
                log("FREQUENZ-KRIEG! Schütze ausgelöst!","error");
                log("══════ TEST 2: DURCHGEFALLEN ══════","error");
                setSt(p=>({...p,testPhase:"complete",testResult:"fail"}));
              }
            }
            if(cs.dieselSt==="synced"){
              clearScheduledInterval(chk);
              log(`Synchronisation erreicht [${((cs.simTime-dStart)/1000).toFixed(1)}s]`,"success");
              setSt(p=>({...p,ncritOn:true,loadShed:false,motorInrush:true,motorTimer:c.motorInrushMs,testPhase:"handover"}));
              scheduleTimeout(()=>{
                const fin=stR.current;
                const comp=checkEN50160(fin.fH,fin.vH,c);
                const pass=comp.every(x=>x.pass);
                log("══════ AUSWERTUNG ══════","warn");
                log(`Sync-Zeit: ${((cs.simTime-dStart)/1000).toFixed(1)}s | f_nadir: ${fin.freqNadirHz.toFixed(2)}Hz`,"metric");
                comp.forEach(x=>log(`${x.pass?"✓":"✕"} ${x.name}: ${x.value}`,x.pass?"success":"error"));
                log(pass?"══════ TEST 2: BESTANDEN ══════":"══════ TEST 2: DURCHGEFALLEN ══════",pass?"success":"error");
                setSt(p=>({...p,testPhase:"complete",testResult:pass?"pass":"fail"}));
              },3000);
            }
          },150);
        },2000);
      }

      if(testId===3){
        setSt({...base,activeTest:3,testPhase:"running",wanOn:false,emsMode:"local"});
        setRunning(true);
        log("══════ TEST 3: 30-TAGE-DUNKELHAFT ══════","warn");
        log(`Phone-Home: ${c.phoneHomeEnabled?"AKTIV (Cloud-Zwang!)":"Deaktiviert"} | Zertifikat: ${c.certValidDays}d`,c.phoneHomeEnabled?"error":"info");
        let day=0;
        const dTimer=scheduleInterval(()=>{
          day++;
          setSt(s=>{
            const ns={...s,airDays:day,logMB:12+day*c.logGrowthMBperDay,certDays:c.certValidDays-day,phoneDays:c.phoneHomeTimeoutDays-day};
            if(ns.logMB>c.logMaxMB*0.85) ns.logMB=c.logMaxMB*0.2;
            return ns;
          });
          if(day===7) log("Tag 7: System stabil","success");
          if(day===14) log(`Tag 14: ${c.phoneHomeEnabled?"Phone-Home-Countdown...":"Kein Timeout"} `,c.phoneHomeEnabled?"warn":"success");
          if(c.phoneHomeEnabled&&day>=c.phoneHomeTimeoutDays){
            clearScheduledInterval(dTimer);
            log(`Tag ${day}: PHONE-HOME-TIMEOUT! System gesperrt!`,"error");
            log("══════ TEST 3: DURCHGEFALLEN ══════","error");
            setSt(p=>({...p,testPhase:"complete",testResult:"fail"}));
            return;
          }
          if(c.certValidDays-day<=0){
            clearScheduledInterval(dTimer);
            log(`Tag ${day}: Zertifikat ABGELAUFEN!`,"error");
            log("══════ TEST 3: DURCHGEFALLEN ══════","error");
            setSt(p=>({...p,testPhase:"complete",testResult:"fail"}));
            return;
          }
          if(day>=30){
            clearScheduledInterval(dTimer);
            const pass=!c.phoneHomeEnabled&&(c.certValidDays-30>0);
            log("══════ TAG 30 ERREICHT ══════","success");
            log(`Phone-Home: ${c.phoneHomeEnabled?"AUSGELÖST":"BESTANDEN"} | Zertifikat: ${c.certValidDays-30}d Rest | Logs: Rotation OK`,"metric");
            log(pass?"══════ TEST 3: BESTANDEN ══════":"══════ TEST 3: DURCHGEFALLEN ══════",pass?"success":"error");
            setSt(p=>({...p,testPhase:"complete",testResult:pass?"pass":"fail",simSpeed:1}));
          }
        },450);
      }

      if(testId===4){
        setSt({...base,activeTest:4,testPhase:"emp",gridOn:false,wanOn:false,emsMode:"manual",invMode:"off",empDmg:true,freq:48,volt:380,battKW:0,critOn:false,ncritOn:false});
        setRunning(true);
        log("══════ TEST 4: SCHWARZSTART ══════","warn");
        log("EMP! Edge-Controller zerstört! Alle Digitalsysteme tot!","error");
        scheduleTimeout(()=>{
          if(!c.manualRelayAvailable){
            log("KEINE hartverdrahteten Relais!","error");
            log("══════ TEST 4: DURCHGEFALLEN ══════","error");
            setSt(p=>({...p,testPhase:"complete",testResult:"fail"}));
            return;
          }
          log("Pioniere: Handrad → hartverdrahtete Relais","warn");
          scheduleTimeout(()=>{
            log("NEA: Manueller Diesel-Start","info");
            setSt(s=>({...s,dieselSt:"cranking",manRelay:true,testPhase:"manual-start"}));
            const chk=scheduleInterval(()=>{
              const cs=stR.current;
              if(cs.dieselSt==="running"||cs.dieselSt==="syncing"||cs.dieselSt==="synced"){
                clearScheduledInterval(chk);
                setSt(p=>({...p,dieselSt:"synced",dieselKW:c.dieselMaxPowerKW*0.6,critOn:true,testPhase:"manual-running"}));
                log("NEA läuft! Kernzone versorgt OHNE Software!","success");
                scheduleTimeout(()=>{
                  log("══════ TEST 4: BESTANDEN ══════","success");
                  setSt(p=>({...p,testPhase:"complete",testResult:"pass"}));
                },3500);
              }
            },200);
          },2500);
        },3000);
      }
    },150);
  },[clearScheduledInterval, log, reset, scheduleInterval, scheduleTimeout]);

  const runBackendTest = useCallback(async (testId)=>{
    const c = cfgR.current;
    reset();
    setSt({ ...mkState(c), activeTest:testId, testPhase:"backend-prep", remoteRunState:"queued", remoteRunProgress:0 });
    log(`Twin Core API Modus aktiv: Starte Test ${testId}`,"warn");

    try {
      const baseUrl = normalizeBaseUrl(c.twinApiBaseUrl);
      if (!baseUrl) throw new Error("Twin API URL ist leer");
      const started = Date.now();
      await fetchJsonWithTimeout(`${baseUrl}/api/v1/health`, {}, 8000);
      const ready = await fetchJsonWithTimeout(`${baseUrl}/api/v1/ready`, {}, 8000);
      setSt(s=>({
        ...s,
        remoteApiStatus:"ok",
        remoteApiLatencyMs:Math.max(1, Date.now() - started),
      }));
      if (ready?.profile_count != null) {
        log(`Twin API bereit: ${ready.profile_count} Mapping-Profile geladen`,"info");
      }

      const scenarioPayload = buildTwinScenario(testId, c);
      const modelPackPayload = buildTwinModelPack(c);

      await fetchJsonWithTimeout(`${baseUrl}/api/v1/scenarios`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(scenarioPayload),
      });
      await fetchJsonWithTimeout(`${baseUrl}/api/v1/model-packs`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(modelPackPayload),
      });

      const adapters = [];
      if (c.twinUseModbus) {
        adapters.push({
          name:"modbus", enabled:true, endpoint:c.twinModbusEndpoint, profile:c.twinProfileId,
          transport:c.twinModbusEndpoint?.startsWith?.("sim://") ? "sim" : "auto", mapping:{},
        });
      }
      if (c.twinUseOpcua) {
        adapters.push({
          name:"opcua", enabled:true, endpoint:c.twinOpcuaEndpoint, profile:c.twinProfileId,
          transport:c.twinOpcuaEndpoint?.startsWith?.("sim://") ? "sim" : "auto", mapping:{},
        });
      }
      if (c.twinUseMqtt) {
        adapters.push({
          name:"mqtt", enabled:true, endpoint:c.twinMqttEndpoint, profile:c.twinProfileId,
          transport:c.twinMqttEndpoint?.startsWith?.("sim://") ? "sim" : "auto", mapping:{},
        });
      }

      const runRequest = {
        scenario_id: scenarioPayload.id,
        model_pack_id: modelPackPayload.id,
        seed: Math.floor(Number(c.twinSeedBase || 1)) + testId,
        realtime_mode: c.twinRealtimeMode === "sil" ? "sil" : "hil_realtime",
        adapters,
        assertions: [
          { name: "Frequency floor", metric: "freq_nadir_hz", op: ">=", threshold: c.en50160FreqExtreme[0] },
          { name: "Voltage floor", metric: "volt_nadir_v", op: ">=", threshold: 340 },
          { name: "Blackout budget", metric: "blackout_ms", op: "<=", threshold: 500 },
          { name: "Switch budget", metric: "switch_time_ms", op: "<=", threshold: 200 },
        ],
      };

      const run = await fetchJsonWithTimeout(`${baseUrl}/api/v1/runs`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(runRequest),
      });
      const runId = run.run_id;
      setSt(s=>({ ...s, remoteRunId:runId, testPhase:"backend-running" }));
      log(`Twin Run angelegt: ${runId}`,"info");

      clearRemotePolling();
      const poll = async () => {
        const status = await fetchJsonWithTimeout(`${baseUrl}/api/v1/runs/${runId}`, {}, 8000);
        setSt(s=>({
          ...s,
          remoteRunState: status.state || s.remoteRunState,
          remoteRunProgress: status.progress ?? s.remoteRunProgress,
          testPhase: status.state === "running" || status.state === "queued" ? "backend-running" : s.testPhase,
        }));

        if (status.state === "completed") {
          clearRemotePolling();
          const record = await fetchJsonWithTimeout(`${baseUrl}/api/v1/runs/${runId}/record`, {}, 8000);
          const safety = await fetchJsonWithTimeout(`${baseUrl}/api/v1/runs/${runId}/safety`, {}, 8000);
          const telemetryRes = await fetch(`${baseUrl}/api/v1/runs/${runId}/telemetry`);
          if (!telemetryRes.ok) throw new Error(`Telemetry fetch failed (${telemetryRes.status})`);
          const telemetry = parseTelemetryJsonl(await telemetryRes.text());
          setSt(prev=>stateFromTwinRecord(prev, record, telemetry, c, safety));
          log(`Twin Run ${runId}: ${record.status?.pass_fail ? "BESTANDEN" : "DURCHGEFALLEN"}`, record.status?.pass_fail ? "success" : "error");
          log(
            `Jitter avg/max/p99: ${Number(record?.summary?.tick_drift_avg_ms || 0).toFixed(2)}/${Number(record?.summary?.tick_drift_max_ms || 0).toFixed(2)}/${Number(record?.summary?.tick_drift_p99_ms || 0).toFixed(2)} ms`,
            "metric"
          );
          log(
            `Watchdog: ok=${Number(safety?.watchdog_summary?.watchdog_ticks_ok || 0)} misses=${Number(safety?.watchdog_summary?.watchdog_misses || 0)} failSafe=${Boolean(safety?.watchdog_summary?.watchdog_fail_safe)}`,
            safety?.watchdog_summary?.watchdog_fail_safe ? "error" : "info"
          );
          (record.assertion_results || []).forEach(a=>{
            log(`${a.passed?"✓":"✕"} ${a.name}: ${a.observed} (${a.metric} ${a.op} ${a.threshold})`, a.passed ? "success" : "error");
          });
        } else if (status.state === "failed") {
          clearRemotePolling();
          setSt(s=>({ ...s, testPhase:"complete", testResult:"fail", remoteRunState:"failed" }));
          log(`Twin Run ${runId}: FEHLER ${status.error || ""}`.trim(),"error");
        }
      };

      remotePollR.current = setInterval(() => { void poll(); }, 1000);
      await poll();
    } catch (err) {
      clearRemotePolling();
      const msg = err?.message || "Unbekannter Twin API Fehler";
      log(`Twin Core API Fehler: ${msg}`,"error");
      setSt(s=>({ ...s, testPhase:"complete", testResult:"fail", remoteRunState:"failed", remoteApiStatus:"down" }));
    }
  },[clearRemotePolling, log, reset]);

  // ─── BATCH RUNNER ───
  const runBatch = useCallback((testId)=>{
    const c = cfgR.current;
    setSt(s=>({...s,batchRunning:true}));
    log(`Batch-Run: ${c.batchRuns}× Test ${testId} mit ±${(c.batchVariance*100).toFixed(0)}% Varianz`,"warn");

    scheduleTimeout(()=>{
      const results = runBatchSimulation(c, c.batchRuns, testId);
      const passed = results.filter(r=>r.pass).length;
      const meanNadir = results.reduce((sum, r) => sum + r.freqNadir, 0) / results.length;
      const sigmaNadir = Math.sqrt(results.reduce((sum, r) => sum + (r.freqNadir - meanNadir) ** 2, 0) / results.length);
      log(`Batch komplett: ${passed}/${results.length} bestanden (${(passed/results.length*100).toFixed(1)}%)`,"metric");
      log(`Freq-Nadir: μ=${meanNadir.toFixed(2)}Hz σ=${sigmaNadir.toFixed(3)}Hz`,"metric");
      setSt(s=>({...s,batchResults:results,batchRunning:false}));
    },500);
  },[log, scheduleTimeout]);

  // ─── CSV EXPORT ───
  const exportCSV = useCallback(()=>{
    if (cfg.twinUseBackend && st.remoteRunId) {
      const baseUrl = normalizeBaseUrl(cfg.twinApiBaseUrl);
      if (!baseUrl) {
        log("CSV-Export fehlgeschlagen: Twin API URL leer", "error");
        return;
      }
      const url = `${baseUrl}/api/v1/runs/${st.remoteRunId}/telemetry.csv`;
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = `${st.remoteRunId}-telemetry.csv`;
      a.click();
      log(`CSV-Export gestartet: ${st.remoteRunId}-telemetry.csv`, "info");
      return;
    }

    const rows = ["t_ms,freq_Hz,volt_V,batt_kW,diesel_kW,soc_pct,load_kW,thd_pct,pv_kW,hour"];
    st.dataLog.forEach(d=>rows.push(`${d.t},${d.f.toFixed(3)},${d.v.toFixed(2)},${d.b.toFixed(2)},${d.d.toFixed(2)},${d.soc.toFixed(2)},${d.l.toFixed(1)},${d.thd.toFixed(2)},${d.pv.toFixed(1)},${d.h.toFixed(2)}`));
    const blob=new Blob([rows.join("\n")],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`hil_test${st.activeTest||"data"}_${Date.now()}.csv`; a.click();
  },[cfg.twinApiBaseUrl, cfg.twinUseBackend, log, st.activeTest, st.dataLog, st.remoteRunId]);

  const compliance = useMemo(()=>checkEN50160(st.fH,st.vH,cfg),[st.fH,st.vH,cfg]);
  const allPass = compliance.every(c=>c.pass);

  // Harmonics bar data
  const harmonicsData = useMemo(()=>
    Object.entries(st.harmonics).map(([h,v])=>({order:parseInt(h),value:parseFloat(v.toFixed(2)),name:`H${h}`}))
  ,[st.harmonics]);

  // Batch chart data
  const batchChartData = useMemo(()=>{
    if(!st.batchResults) return [];
    return st.batchResults.map(r=>({
      run:r.run, freqNadir:parseFloat(r.freqNadir.toFixed(3)),
      blackout:r.blackoutMs, compliance:parseFloat(r.freqCompliance.toFixed(1)),
      pass:r.pass?1:0,
    }));
  },[st.batchResults]);

  // Load profile chart
  const profileData = useMemo(()=>{
    return Array.from({length:24},(_,h)=>({
      hour:h,
      load: getLoadAtHour(cfg, h),
      pv: getPVAtHour(cfg, h),
      net: getLoadAtHour(cfg, h) - getPVAtHour(cfg, h),
    }));
  },[cfg]);

  return (
    <div style={{background:C.bg,color:C.text,height:"100vh",fontFamily:"'JetBrains Mono','Fira Code',monospace",fontSize:11,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=number]{-moz-appearance:textfield}input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        .rtip{background:${C.panel}!important;border:1px solid ${C.border}!important;border-radius:4px!important;font-size:10px!important;color:${C.text}!important}
      `}</style>

      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 14px",borderBottom:`1px solid ${C.border}`,background:C.panel,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,borderRadius:3,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:"#fff"}}>⚡</div>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:C.textBright,letterSpacing:"0.04em"}}>HiL TESTING LAB <span style={{fontSize:9,color:C.accent,fontWeight:600}}>STUFE 1</span></div>
            <div style={{fontSize:8,color:C.textDim,letterSpacing:"0.1em"}}>SPLIT-BRAIN EMS · HARMONICS · BATCH · PROTOCOL · COMPLIANCE</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {st.activeTest&&<Bdg color={st.testResult==="pass"?C.green:st.testResult==="fail"?C.red:C.amber} pulse={!st.testResult}>TEST {st.activeTest}: {st.testResult?(st.testResult==="pass"?"BESTANDEN":"FAIL"):st.testPhase}</Bdg>}
          {cfg.twinUseBackend&&<Bdg color={C.cyan}>TWIN API</Bdg>}
          {cfg.twinUseBackend&&<Bdg
            color={st.remoteApiStatus==="ok" ? C.green : st.remoteApiStatus==="down" || st.remoteApiStatus==="misconfigured" ? C.red : C.amber}
            pulse={st.remoteApiStatus==="checking"}
          >
            API {String(st.remoteApiStatus || "unknown").toUpperCase()}{st.remoteApiLatencyMs ? ` ${st.remoteApiLatencyMs}ms` : ""}
          </Bdg>}
          {cfg.twinUseBackend&&st.remoteRunId&&<Bdg color={st.remoteRunState==="completed"?C.green:st.remoteRunState==="failed"?C.red:C.amber} pulse={st.remoteRunState==="running"||st.remoteRunState==="queued"}>RUN {st.remoteRunId.slice(0,8)} {Math.round(st.remoteRunProgress||0)}%</Bdg>}
          <Bdg color={allPass?C.green:C.red}>EN50160:{allPass?"OK":"!!"}</Bdg>
          <Bdg color={C.purple}>THD:{st.thd.toFixed(1)}%</Bdg>
          <span style={{fontSize:9,color:C.textDim}}>T+{st.simTime<60000?`${(st.simTime/1000).toFixed(1)}s`:`${(st.simTime/60000).toFixed(1)}m`}</span>
          <button onClick={()=>setShowCfg(!showCfg)} style={{background:showCfg?C.accent+"33":"transparent",border:`1px solid ${C.border}`,color:C.text,borderRadius:3,padding:"3px 8px",fontSize:9,cursor:"pointer"}}>⚙</button>
          <button onClick={exportCSV} disabled={!st.dataLog.length && !(cfg.twinUseBackend && st.remoteRunId)} style={{background:"transparent",border:`1px solid ${C.border}`,color:(st.dataLog.length || (cfg.twinUseBackend && st.remoteRunId))?C.cyan:C.textDim,borderRadius:3,padding:"3px 8px",fontSize:9,cursor:(st.dataLog.length || (cfg.twinUseBackend && st.remoteRunId))?"pointer":"not-allowed"}}>CSV</button>
          {st.testResult&&<button onClick={()=>generateTestReport(st,cfg,compliance,st.activeTest)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.amber,borderRadius:3,padding:"3px 8px",fontSize:9,cursor:"pointer"}}>PDF</button>}
          <button onClick={reset} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.text,borderRadius:3,padding:"3px 8px",fontSize:9,cursor:"pointer"}}>↺</button>
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* CONFIG */}
        {showCfg&&<div style={{width:260,background:C.panelAlt,borderRight:`1px solid ${C.border}`,padding:10,overflowY:"auto",flexShrink:0}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textBright,marginBottom:8}}>PARAMETER</div>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginBottom:4}}>Batterie/WR</div>
          <CfgField label="Kapazität" value={cfg.batteryCapacityKWh} onChange={v=>uCfg("batteryCapacityKWh",v)} unit="kWh" disabled={running}/>
          <CfgField label="Max P" value={cfg.batteryMaxPowerKW} onChange={v=>uCfg("batteryMaxPowerKW",v)} unit="kW" disabled={running}/>
          <CfgField label="SOC" value={cfg.batteryInitSOC} onChange={v=>uCfg("batteryInitSOC",v)} unit="%" disabled={running}/>
          <CfgField label="Switch" value={cfg.inverterSwitchTimeMs} onChange={v=>uCfg("inverterSwitchTimeMs",v)} unit="ms" disabled={running}/>
          <CfgField label="H (virt)" value={cfg.batteryInertiaH} onChange={v=>uCfg("batteryInertiaH",v)} unit="s" step={0.1} disabled={running}/>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>NEA</div>
          <CfgField label="Max P" value={cfg.dieselMaxPowerKW} onChange={v=>uCfg("dieselMaxPowerKW",v)} unit="kW" disabled={running}/>
          <CfgField label="Start" value={cfg.dieselStartDelayMs} onChange={v=>uCfg("dieselStartDelayMs",v)} unit="ms" disabled={running}/>
          <CfgField label="Rampe" value={cfg.dieselRampTimeMs} onChange={v=>uCfg("dieselRampTimeMs",v)} unit="ms" disabled={running}/>
          <CfgField label="H" value={cfg.dieselInertiaH} onChange={v=>uCfg("dieselInertiaH",v)} unit="s" step={0.1} disabled={running}/>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>Lasten</div>
          <CfgField label="Kritisch" value={cfg.criticalLoadKW} onChange={v=>uCfg("criticalLoadKW",v)} unit="kW" disabled={running}/>
          <CfgField label="Nicht-krit" value={cfg.nonCriticalLoadKW} onChange={v=>uCfg("nonCriticalLoadKW",v)} unit="kW" disabled={running}/>
          <CfgField label="Motor" value={cfg.motorLoadKW} onChange={v=>uCfg("motorLoadKW",v)} unit="kW" disabled={running}/>
          <CfgField label="Inrush" value={cfg.motorInrushFactor} onChange={v=>uCfg("motorInrushFactor",v)} unit="×" disabled={running}/>
          <CfgField label="Shed-Delay" value={cfg.loadShedDelayMs} onChange={v=>uCfg("loadShedDelayMs",v)} unit="ms" disabled={running}/>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>PV-Anlage</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.pvEnabled} onChange={e=>uCfg("pvEnabled",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.pvEnabled?C.green:C.textDim}}>PV {cfg.pvEnabled?"aktiv":"aus"}</span>
          </div>
          {cfg.pvEnabled&&<CfgField label="Peak" value={cfg.pvPeakKW} onChange={v=>uCfg("pvPeakKW",v)} unit="kW" disabled={running}/>}

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>Air-Gap (T3)</div>
          <CfgField label="Log/Tag" value={cfg.logGrowthMBperDay} onChange={v=>uCfg("logGrowthMBperDay",v)} unit="MB" step={0.1} disabled={running}/>
          <CfgField label="Zertifikat" value={cfg.certValidDays} onChange={v=>uCfg("certValidDays",v)} unit="d" disabled={running}/>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.phoneHomeEnabled} onChange={e=>uCfg("phoneHomeEnabled",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.phoneHomeEnabled?C.red:C.green}}>Phone-Home {cfg.phoneHomeEnabled?"(→FAIL!)":"aus"}</span>
          </div>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>EMP (T4)</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.manualRelayAvailable} onChange={e=>uCfg("manualRelayAvailable",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.manualRelayAvailable?C.green:C.red}}>Relais {cfg.manualRelayAvailable?"vorhanden":"(→FAIL!)"}</span>
          </div>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>Batch-Runner</div>
          <CfgField label="Runs" value={cfg.batchRuns} onChange={v=>uCfg("batchRuns",v)} unit="×" min={5} max={500} disabled={running}/>
          <CfgField label="Varianz" value={(cfg.batchVariance*100).toFixed(0)} onChange={v=>uCfg("batchVariance",v/100)} unit="%" min={1} max={50} disabled={running}/>
          <div style={{display:"flex",gap:4,marginTop:6}}>
            <button onClick={()=>runBatch(1)} disabled={st.batchRunning} style={{flex:1,padding:"4px",fontSize:9,background:C.panel,border:`1px solid ${C.border}`,color:C.cyan,borderRadius:3,cursor:"pointer"}}>Batch T1</button>
            <button onClick={()=>runBatch(2)} disabled={st.batchRunning} style={{flex:1,padding:"4px",fontSize:9,background:C.panel,border:`1px solid ${C.border}`,color:C.cyan,borderRadius:3,cursor:"pointer"}}>Batch T2</button>
          </div>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>MQTT/Modbus</div>
          <CfgField label="Broker" value={cfg.mqttBroker} onChange={v=>uCfg("mqttBroker",v)} unit="" disabled={running} type="text" width={132}/>
          <CfgField label="Modbus IP" value={cfg.modbusIP} onChange={v=>uCfg("modbusIP",v)} unit="" disabled={running} type="text" width={132}/>

          <div style={{fontSize:9,color:C.amber,fontWeight:700,marginTop:8,marginBottom:4}}>Twin Core API</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.twinUseBackend} onChange={e=>uCfg("twinUseBackend",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.twinUseBackend?C.cyan:C.textDim}}>Remote Twin Runs {cfg.twinUseBackend?"aktiv":"aus"}</span>
          </div>
          <CfgField label="API URL" value={cfg.twinApiBaseUrl} onChange={v=>uCfg("twinApiBaseUrl",v)} unit="" disabled={running} type="text" width={132}/>
          <CfgField label="Profile" value={cfg.twinProfileId} onChange={v=>uCfg("twinProfileId",v)} unit="" disabled={running} type="text" width={132}/>
          <CfgField label="Seed-Basis" value={cfg.twinSeedBase} onChange={v=>uCfg("twinSeedBase",v)} unit="" disabled={running}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:9,color:C.textDim,flex:1}}>Realtime</span>
            <select value={cfg.twinRealtimeMode} onChange={e=>uCfg("twinRealtimeMode",e.target.value)} disabled={running}
              style={{width:132,padding:"1px 3px",fontSize:10,fontFamily:"monospace",background:running?C.border:C.panelAlt,color:running?C.textDim:C.textBright,border:`1px solid ${C.border}`,borderRadius:2}}>
              <option value="hil_realtime">hil_realtime</option>
              <option value="sil">sil</option>
            </select>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.twinUseModbus} onChange={e=>uCfg("twinUseModbus",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.twinUseModbus?C.green:C.textDim}}>Modbus Adapter</span>
          </div>
          {cfg.twinUseModbus&&<CfgField label="Modbus EP" value={cfg.twinModbusEndpoint} onChange={v=>uCfg("twinModbusEndpoint",v)} unit="" disabled={running} type="text" width={132}/>}
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.twinUseOpcua} onChange={e=>uCfg("twinUseOpcua",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.twinUseOpcua?C.green:C.textDim}}>OPC UA Adapter</span>
          </div>
          {cfg.twinUseOpcua&&<CfgField label="OPCUA EP" value={cfg.twinOpcuaEndpoint} onChange={v=>uCfg("twinOpcuaEndpoint",v)} unit="" disabled={running} type="text" width={132}/>}
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
            <input type="checkbox" checked={cfg.twinUseMqtt} onChange={e=>uCfg("twinUseMqtt",e.target.checked)} disabled={running}/>
            <span style={{fontSize:9,color:cfg.twinUseMqtt?C.green:C.textDim}}>MQTT Adapter</span>
          </div>
          {cfg.twinUseMqtt&&<CfgField label="MQTT EP" value={cfg.twinMqttEndpoint} onChange={v=>uCfg("twinMqttEndpoint",v)} unit="" disabled={running} type="text" width={132}/>}
        </div>}

        {/* CENTER */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Test Buttons */}
          <div style={{display:"flex",gap:5,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {[
              {id:1,name:"Guillotine",icon:"⚡"},
              {id:2,name:"Frequenz-Krieg",icon:"〰"},
              {id:3,name:"Dunkelhaft",icon:"🔒"},
              {id:4,name:"Schwarzstart",icon:"💀"},
            ].map(t=>{
              const isA=st.activeTest===t.id;
              const dis=st.activeTest!==null&&st.testPhase!=="complete"&&!isA;
              return (
                <button key={t.id} onClick={()=>cfg.twinUseBackend ? runBackendTest(t.id) : runTest(t.id)} disabled={dis}
                  style={{flex:1,padding:"6px 8px",textAlign:"left",background:isA?C.accent+"15":C.panel,
                    border:`1px solid ${isA?C.accent:C.border}`,borderRadius:4,cursor:dis?"not-allowed":"pointer",opacity:dis?0.3:1}}>
                  <span style={{fontSize:12}}>{t.icon}</span>
                  <span style={{fontSize:9,fontWeight:700,color:C.textBright,marginLeft:4}}>T{t.id}</span>
                  <span style={{fontSize:9,color:C.textDim,marginLeft:4}}>{t.name}</span>
                  {isA&&st.testResult&&<Bdg color={st.testResult==="pass"?C.green:C.red}>{st.testResult==="pass"?"✓":"✕"}</Bdg>}
                </button>
              );
            })}
          </div>

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {[
              {id:"scope",l:"OSZILLOSKOP"},{id:"topology",l:"TOPOLOGIE"},{id:"harmonics",l:"HARMONICS/THD"},
              {id:"profile",l:"LASTPROFIL"},{id:"batch",l:"BATCH-ANALYSE"},{id:"protocol",l:"PROTOCOL"},
              {id:"compliance",l:"COMPLIANCE"},
            ].map(t=><TabBtn key={t.id} active={tab===t.id} label={t.l} onClick={()=>setTab(t.id)}/>)}
          </div>

          {/* Tab Content */}
          <div style={{flex:1,overflow:"auto",padding:10}}>

            {/* SCOPE */}
            {tab==="scope"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Scope data={st.fH} label="Frequenz" unit="Hz" nominal={cfg.nominalFreq} lo={46} hi={54} compLo={cfg.en50160FreqRange[0]} compHi={cfg.en50160FreqRange[1]} color={C.scope} h={120}/>
              <Scope data={st.vH} label="Spannung" unit="V" nominal={cfg.nominalVoltage} lo={340} hi={460} compLo={cfg.en50160VoltRange[0]} compHi={cfg.en50160VoltRange[1]} color={C.cyan} h={120}/>
              <Scope data={st.bH} label="Batterie" unit="kW" nominal={0} lo={-50} hi={cfg.batteryMaxPowerKW+20} color={C.amber} h={100}/>
              <Scope data={st.dH} label="NEA" unit="kW" nominal={0} lo={-10} hi={cfg.dieselMaxPowerKW+20} color={C.purple} h={100}/>
              <Scope data={st.thdH} label="THD" unit="%" nominal={5} lo={0} hi={20} compLo={0} compHi={8} color={C.pink} h={80}/>
              <Scope data={st.lH} label="Last" unit="kW" nominal={cfg.criticalLoadKW+cfg.nonCriticalLoadKW} lo={0} hi={(cfg.criticalLoadKW+cfg.nonCriticalLoadKW)*1.5} color={C.red} h={80}/>
            </div>}

            {/* TOPOLOGY */}
            {tab==="topology"&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              <Pnl title="Netz" icon="🔌" hl={!st.gridOn} hlc={st.gridOn?C.green:C.red} badge={<Bdg color={st.gridOn?C.green:C.red}>{st.gridOn?"ON":"OFF"}</Bdg>}>
                <LED on={st.gridOn} label="Netzspannung"/> <LED on={st.wanOn} color={C.cyan} label="WAN"/>
              </Pnl>
              <Pnl title="Batterie+WR" icon="🔋" hl={st.invMode==="grid-forming"} hlc={C.amber} badge={<Bdg color={st.invMode==="grid-forming"?C.amber:st.invMode==="off"?C.red:C.green}>{st.invSwitching?"SWITCH":st.invMode==="grid-forming"?"GF":st.invMode==="off"?"DEFEKT":"GFL"}</Bdg>}>
                <Bar2 label="SOC" value={st.soc} max={100} unit="%" color={st.soc<20?C.red:C.green}/>
                <Bar2 label="P" value={Math.abs(st.battKW)} max={cfg.batteryMaxPowerKW} unit="kW" color={st.battKW>0?C.amber:C.cyan}/>
              </Pnl>
              <Pnl title="EMS" icon="🧠" hl={st.emsMode!=="cloud"} hlc={st.emsMode==="local"?C.amber:C.red} badge={<Bdg color={st.emsMode==="cloud"?C.cyan:st.emsMode==="local"?C.amber:C.red}>{st.emsMode.toUpperCase()}</Bdg>}>
                <LED on={st.emsMode==="cloud"} color={C.cyan} label="Cloud"/>
                <LED on={st.emsMode==="local"} color={C.amber} label="Edge"/>
                <LED on={st.manRelay} color={C.red} label="Relais"/>
                <LED on={st.loadShed} color={C.amber} label="Load Shed"/>
                {st.activeTest===3&&<div style={{marginTop:4}}>
                  <Bar2 label="Air-Gap" value={st.airDays} max={30} unit="d" color={C.purple}/>
                  <Bar2 label="Logs" value={st.logMB} max={cfg.logMaxMB} unit="MB" color={C.cyan} warn={cfg.logMaxMB*0.7} crit={cfg.logMaxMB*0.9}/>
                  <Bar2 label="Cert" value={Math.max(0,st.certDays)} max={cfg.certValidDays} unit="d" color={st.certDays<30?C.amber:C.green}/>
                </div>}
              </Pnl>
              <Pnl title="NEA" icon="⛽" hl={st.dieselSt!=="off"} hlc={st.dieselSt==="synced"?C.green:C.amber} badge={<Bdg color={{off:C.textDim,cranking:C.amber,running:C.amber,syncing:C.purple,synced:C.green}[st.dieselSt]}>{{off:"AUS",cranking:"ZÜND",running:"RUN",syncing:"SYNC",synced:"OK"}[st.dieselSt]}</Bdg>}>
                <Bar2 label="P" value={st.dieselKW} max={cfg.dieselMaxPowerKW} unit="kW" color={C.amber}/>
                <Bar2 label="Rampe" value={st.dieselRamp*100} max={100} unit="%" color={C.purple}/>
                {st.dieselSt==="syncing"&&<div style={{fontSize:8,color:C.purple}}>Δφ={Math.abs(st.dieselPhase).toFixed(1)}° Δf={Math.abs(st.freq-cfg.nominalFreq).toFixed(3)}Hz</div>}
              </Pnl>
              <Pnl title="Krit. Last" icon="🏛" hl={!st.critOn} hlc={C.red} badge={<Bdg color={st.critOn?C.green:C.red}>{st.critOn?"ON":"OFF"}</Bdg>}>
                <div style={{fontSize:18,fontWeight:800,color:st.critOn?C.green:C.red}}>{st.critOn?cfg.criticalLoadKW:0} kW</div>
              </Pnl>
              <Pnl title="NK-Last" icon="🏢" hl={st.loadShed} hlc={C.amber} badge={<Bdg color={st.ncritOn?C.green:C.amber}>{st.ncritOn?"ON":"SHED"}</Bdg>}>
                <div style={{fontSize:18,fontWeight:800,color:st.ncritOn?C.green:C.red}}>{st.ncritOn?cfg.nonCriticalLoadKW:0} kW
                  {st.motorInrush&&<span style={{fontSize:10,color:C.red}}> +INRUSH</span>}
                </div>
              </Pnl>
            </div>}

            {/* HARMONICS */}
            {tab==="harmonics"&&<div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Pnl title="Oberwellen-Spektrum" icon="〰">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={harmonicsData} margin={{top:5,right:5,bottom:5,left:5}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="name" tick={{fill:C.textDim,fontSize:9}} stroke={C.border}/>
                      <YAxis tick={{fill:C.textDim,fontSize:9}} stroke={C.border} unit="%"/>
                      <Tooltip contentStyle={{background:C.panel,border:`1px solid ${C.border}`,fontSize:10,color:C.text}} />
                      <Bar dataKey="value" fill={C.purple} radius={[2,2,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </Pnl>
                <Pnl title="THD Verlauf" icon="📊">
                  <Scope data={st.thdH} label="THD" unit="%" nominal={5} lo={0} hi={20} compLo={0} compHi={8} color={C.pink} h={180}/>
                </Pnl>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>
                <Pnl style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.textDim}}>THD Gesamt</div>
                  <div style={{fontSize:22,fontWeight:800,color:st.thd<8?C.green:st.thd<12?C.amber:C.red}}>{st.thd.toFixed(1)}%</div>
                  <div style={{fontSize:8,color:C.textDim}}>Grenze: 8% (EN 50160)</div>
                </Pnl>
                <Pnl style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.textDim}}>Diesel THD</div>
                  <div style={{fontSize:22,fontWeight:800,color:C.amber}}>{calcTHD(DIESEL_HARMONICS, st.dieselKW/(cfg.dieselMaxPowerKW||1)).toFixed(1)}%</div>
                  <div style={{fontSize:8,color:C.textDim}}>Teillast erhöht THD</div>
                </Pnl>
                <Pnl style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.textDim}}>Inverter THD</div>
                  <div style={{fontSize:22,fontWeight:800,color:C.cyan}}>{calcTHD(INVERTER_HARMONICS, Math.abs(st.battKW)/(cfg.batteryMaxPowerKW||1)).toFixed(1)}%</div>
                  <div style={{fontSize:8,color:C.textDim}}>PWM-basiert</div>
                </Pnl>
                <Pnl style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.textDim}}>H5 (dominierend)</div>
                  <div style={{fontSize:22,fontWeight:800,color:C.purple}}>{(st.harmonics[5]||0).toFixed(1)}%</div>
                  <div style={{fontSize:8,color:C.textDim}}>5. Harmonische</div>
                </Pnl>
              </div>
            </div>}

            {/* LOAD PROFILE */}
            {tab==="profile"&&<div>
              <Pnl title="24h Lastprofil + PV-Erzeugung" icon="📈">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={profileData} margin={{top:10,right:10,bottom:5,left:10}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="hour" tick={{fill:C.textDim,fontSize:9}} stroke={C.border} tickFormatter={h=>`${h}:00`}/>
                    <YAxis tick={{fill:C.textDim,fontSize:9}} stroke={C.border} unit=" kW"/>
                    <Tooltip contentStyle={{background:C.panel,border:`1px solid ${C.border}`,fontSize:10,color:C.text}} labelFormatter={h=>`${h}:00 Uhr`}/>
                    <Area type="monotone" dataKey="load" stroke={C.amber} fill={C.amber+"20"} name="Gesamtlast"/>
                    {cfg.pvEnabled && <Area type="monotone" dataKey="pv" stroke={C.green} fill={C.green+"20"} name="PV-Erzeugung"/>}
                    <Area type="monotone" dataKey="net" stroke={C.red} fill={C.red+"10"} name="Netto-Bezug"/>
                    <ReferenceLine y={cfg.criticalLoadKW} stroke={C.red} strokeDasharray="5 5" label={{value:"Kritisch",fill:C.red,fontSize:9}}/>
                    <Legend wrapperStyle={{fontSize:9,color:C.text}}/>
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{display:"flex",gap:8,marginTop:8,fontSize:9,color:C.textDim}}>
                  <span>Aktuelle Stunde: <strong style={{color:C.textBright}}>{st.simHour.toFixed(1)}</strong></span>
                  <span>Last jetzt: <strong style={{color:C.amber}}>{getLoadAtHour(cfg,st.simHour).toFixed(0)} kW</strong></span>
                  {cfg.pvEnabled&&<span>PV jetzt: <strong style={{color:C.green}}>{getPVAtHour(cfg,st.simHour).toFixed(0)} kW</strong></span>}
                  <span>Netto: <strong style={{color:C.red}}>{(getLoadAtHour(cfg,st.simHour)-getPVAtHour(cfg,st.simHour)).toFixed(0)} kW</strong></span>
                </div>
              </Pnl>
            </div>}

            {/* BATCH */}
            {tab==="batch"&&<div>
              {!st.batchResults ? (
                <div style={{textAlign:"center",color:C.textDim,marginTop:60}}>
                  <div style={{fontSize:28,marginBottom:8}}>📊</div>
                  <div style={{fontSize:11}}>Batch-Runner: Monte Carlo Simulation</div>
                  <div style={{fontSize:10,marginTop:4}}>Konfiguriere Runs + Varianz im Config-Panel, dann starte Batch T1 oder T2</div>
                  {st.batchRunning&&<div style={{color:C.amber,marginTop:8,animation:"pulse 1s infinite"}}>Berechne {cfg.batchRuns} Szenarien...</div>}
                </div>
              ) : (
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
                    {[
                      {l:"Pass-Rate",v:`${(batchChartData.filter(d=>d.pass).length/batchChartData.length*100).toFixed(1)}%`,c:batchChartData.filter(d=>d.pass).length===batchChartData.length?C.green:C.amber},
                      {l:"f_nadir μ",v:`${(batchChartData.reduce((s,d)=>s+d.freqNadir,0)/batchChartData.length).toFixed(3)} Hz`,c:C.scope},
                      {l:"f_nadir min",v:`${Math.min(...batchChartData.map(d=>d.freqNadir)).toFixed(3)} Hz`,c:C.red},
                      {l:"Blackout μ",v:`${(batchChartData.reduce((s,d)=>s+d.blackout,0)/batchChartData.length).toFixed(0)} ms`,c:C.purple},
                    ].map((m,i)=>(
                      <Pnl key={i} style={{textAlign:"center"}}>
                        <div style={{fontSize:9,color:C.textDim}}>{m.l}</div>
                        <div style={{fontSize:16,fontWeight:800,color:m.c}}>{m.v}</div>
                      </Pnl>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <Pnl title="Frequenz-Nadir Verteilung" icon="📉">
                      <ResponsiveContainer width="100%" height={200}>
                        <ScatterChart margin={{top:5,right:5,bottom:5,left:5}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                          <XAxis dataKey="run" tick={{fill:C.textDim,fontSize:9}} stroke={C.border} name="Run"/>
                          <YAxis dataKey="freqNadir" tick={{fill:C.textDim,fontSize:9}} stroke={C.border} domain={[46,51]} name="Hz"/>
                          <Tooltip contentStyle={{background:C.panel,border:`1px solid ${C.border}`,fontSize:10,color:C.text}}/>
                          <ReferenceLine y={cfg.en50160FreqRange[0]} stroke={C.red} strokeDasharray="5 5"/>
                          <Scatter data={batchChartData} fill={C.scope} r={3}/>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </Pnl>
                    <Pnl title="EN 50160 Compliance %" icon="📊">
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={batchChartData.slice(0,50)} margin={{top:5,right:5,bottom:5,left:5}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                          <XAxis dataKey="run" tick={{fill:C.textDim,fontSize:8}} stroke={C.border}/>
                          <YAxis tick={{fill:C.textDim,fontSize:9}} stroke={C.border} domain={[80,100]}/>
                          <Tooltip contentStyle={{background:C.panel,border:`1px solid ${C.border}`,fontSize:10,color:C.text}}/>
                          <ReferenceLine y={95} stroke={C.red} strokeDasharray="5 5"/>
                          <Bar dataKey="compliance" fill={C.cyan} radius={[1,1,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </Pnl>
                  </div>
                </div>
              )}
            </div>}

            {/* PROTOCOL */}
            {tab==="protocol"&&<div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Pnl title="MQTT Topics" icon="📡">
                  <div style={{fontSize:9,color:C.textDim,marginBottom:6}}>Broker: {cfg.mqttBroker}</div>
                  <div style={{background:C.scopeBg,borderRadius:3,padding:8,maxHeight:240,overflowY:"auto"}}>
                    {MQTT_TOPICS.map((t,i)=>(
                      <div key={i} style={{fontFamily:"monospace",fontSize:9,lineHeight:1.8,borderBottom:`1px solid ${C.border}22`,paddingBottom:2,marginBottom:2}}>
                        <span style={{color:C.cyan}}>{cfg.mqttTopicPrefix}{t.topic}</span>
                        <span style={{color:C.textDim}}> — {t.desc} [{t.unit}]</span>
                        {st.protocolMsgs[i]&&<div style={{color:C.scope,fontSize:8,marginLeft:12}}>
                          → {JSON.stringify(st.protocolMsgs[i]?.mqtt?.payload||"").slice(0,60)}
                        </div>}
                      </div>
                    ))}
                  </div>
                </Pnl>
                <Pnl title="Modbus TCP Register" icon="🔌">
                  <div style={{fontSize:9,color:C.textDim,marginBottom:6}}>{cfg.modbusIP}:{cfg.modbusPort} Unit:{cfg.modbusUnitID}</div>
                  <div style={{background:C.scopeBg,borderRadius:3,padding:8,maxHeight:240,overflowY:"auto"}}>
                    <div style={{display:"grid",gridTemplateColumns:"60px 1fr 60px",gap:2,fontSize:9}}>
                      <span style={{color:C.amber,fontWeight:700}}>Register</span>
                      <span style={{color:C.amber,fontWeight:700}}>Beschreibung</span>
                      <span style={{color:C.amber,fontWeight:700}}>Wert</span>
                      {MQTT_TOPICS.map((t,i)=>{
                        let val = "—";
                        if(st.protocolMsgs[i]) val = st.protocolMsgs[i].val?.toFixed?.(2) ?? st.protocolMsgs[i].val;
                        return [
                          <span key={`r${i}`} style={{color:C.purple,fontFamily:"monospace"}}>{t.register}</span>,
                          <span key={`d${i}`} style={{color:C.text}}>{t.desc}</span>,
                          <span key={`v${i}`} style={{color:C.scope,fontFamily:"monospace"}}>{val}</span>,
                        ];
                      })}
                    </div>
                  </div>
                </Pnl>
              </div>
              <Pnl title="Protokoll-Stream (Live)" icon="⟶" style={{marginTop:10}}>
                <div style={{background:C.scopeBg,borderRadius:3,padding:8,maxHeight:150,overflowY:"auto",fontFamily:"monospace",fontSize:8.5,lineHeight:1.8}}>
                  {st.protocolMsgs.map((p,i)=>(
                    <div key={i} style={{color:C.scope}}>
                      <span style={{color:C.textDim}}>{new Date().toISOString().slice(11,23)}</span>
                      {" "}<span style={{color:C.cyan}}>MQTT</span> {p.mqtt?.topic} → {p.mqtt?.payload?.slice?.(0,50)}
                      {" | "}<span style={{color:C.purple}}>MODBUS</span> {p.modbus}
                    </div>
                  ))}
                  {!st.protocolMsgs.length&&<span style={{color:C.textDim}}>Simulation starten für Live-Daten...</span>}
                </div>
              </Pnl>
            </div>}

            {/* COMPLIANCE */}
            {tab==="compliance"&&<div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {compliance.map((c,i)=>(
                  <Pnl key={i} hl hlc={c.pass?C.greenDim:C.redDim}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:10,color:C.textBright,fontWeight:600}}>{c.name}</span>
                      <Bdg color={c.pass?C.green:C.red}>{c.pass?"PASS":"FAIL"}</Bdg>
                    </div>
                    <div style={{fontSize:20,fontWeight:800,color:c.pass?C.green:C.red,margin:"4px 0 2px"}}>{c.value}</div>
                    <div style={{fontSize:9,color:C.textDim}}>{c.detail}</div>
                  </Pnl>
                ))}
              </div>
              {st.activeTest&&<Pnl title="Test-Metriken" icon="◆">
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                  {[
                    {l:"Umschaltzeit",v:`${st.switchMs.toFixed(0)} ms`,p:st.switchMs<200},
                    {l:"f-Nadir",v:`${st.freqNadirHz.toFixed(3)} Hz`,p:st.freqNadirHz>cfg.en50160FreqExtreme[0]},
                    {l:"U-Nadir",v:`${st.voltNadirV.toFixed(1)} V`,p:st.voltNadirV>340},
                    {l:"Blackout",v:`${st.blackoutMs.toFixed(0)} ms`,p:st.blackoutMs<500},
                    {l:"THD max",v:`${Math.max(...st.thdH).toFixed(1)}%`,p:Math.max(...st.thdH)<8},
                    {l:"Datenpunkte",v:`${st.dataLog.length}`,p:true},
                    {l:"Tick Drift p99",v:`${st.tickDriftP99Ms.toFixed(2)} ms`,p:st.tickDriftP99Ms < 25},
                    {l:"Watchdog",v:`ok:${st.watchdogTicksOk} miss:${st.watchdogMisses}`,p:!st.watchdogFailSafe},
                    {l:"Audit SHA256",v:st.auditFingerprintSha256 ? `${st.auditFingerprintSha256.slice(0, 12)}...` : "n/a",p:Boolean(st.auditFingerprintSha256)},
                  ].map((m,i)=>(
                    <div key={i} style={{background:C.panelAlt,borderRadius:3,padding:6,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:8,color:C.textDim}}>{m.l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:m.p?C.green:C.red}}>{m.v}</div>
                    </div>
                  ))}
                </div>
              </Pnl>}
            </div>}

          </div>
        </div>

        {/* RIGHT: LOG */}
        <div style={{width:300,background:C.panelAlt,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:10,fontWeight:700,color:C.textBright}}>PROTOKOLL</span>
            <span style={{fontSize:8,color:C.textDim}}>{st.logs.length}</span>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"4px 8px"}}>
            {st.logs.length===0?(
              <div style={{textAlign:"center",color:C.textDim,marginTop:50,fontSize:10}}>
                <div style={{fontSize:22,marginBottom:6}}>⚡</div>
                Kill-Test wählen
              </div>
            ):(
              st.logs.map((l,i)=><LogLine key={i} t={l.t} msg={l.msg} level={l.level}/>)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
