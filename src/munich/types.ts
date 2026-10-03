import type { FlightPlanSnapshot } from "./flightplanTypes";

export type Assumptions = {
  grid_import_limit_kw: number;
  grid_export_limit_kw: number;
  background_load_kw: number;
  chp_output_kw: number;
  parking_transformer_kva: number;
  bus_transformer_kva: number;
  power_factor: number;
  pv_peak_factor: number;
  parking_sessions: number;
  bus_sessions: number;
  parking_charger_kw: number;
  bus_charger_kw: number;
  charging_efficiency: number;
  battery_capacity_kwh: number;
  battery_power_kw: number;
  battery_initial_soc_pct: number;
  battery_reserve_pct: number;
  battery_efficiency: number;
};

export type Policy = "uncontrolled" | "bus_priority";
export type RunStatus = {
  run_id: string;
  state: "queued" | "running" | "completed" | "failed";
  progress: number;
  error: string | null;
  pass_fail: boolean | null;
};
export type Comparison = {
  comparison_id: string;
  world_hash: string;
  runs: RunStatus[];
  flight_plan_snapshot_id?: string | null;
};
export type EnergyKpis = {
  evidence_level: string;
  model_hours: number;
  grid_peak_kw: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  background_unserved_kwh: number;
  charging_requested_kwh: number;
  charging_delivered_kwh: number;
  charging_unmet_kwh: number;
  charging_loss_kwh: number;
  bus_ready_count: number;
  bus_session_count: number;
  parking_ready_count: number;
  parking_session_count: number;
  pv_generated_kwh: number;
  pv_used_kwh: number;
  pv_export_kwh: number;
  pv_curtailed_kwh: number;
  chp_generated_kwh: number;
  chp_unabsorbed_kwh: number;
  battery_initial_kwh: number;
  battery_final_kwh: number;
  battery_charge_kwh: number;
  battery_discharge_kwh: number;
  battery_loss_kwh: number;
  balance_error_max_kw: number;
};
export type ChargingEvidence = {
  id: string;
  sector: "bus" | "parking";
  arrival_min: number;
  deadline_min: number;
  battery_capacity_kwh: number;
  initial_energy_kwh: number;
  required_energy_kwh: number;
  delivered_kwh: number;
  unmet_kwh: number;
  final_energy_kwh: number;
  ready_at_min: number | null;
  deadline_met: boolean;
};
export type EnergyRecord = {
  status: RunStatus;
  request: { seed: number };
  scenario_snapshot: { domain: string; metadata: { policy: Policy; comparison_id: string } };
  model_pack_snapshot: {
    calibration_meta: {
      munich_assumptions: Assumptions;
      reference_dossier: Dossier;
      world_hash: string;
      flight_plan_snapshot?: FlightPlanSnapshot;
      flight_plan_usage?: "context_only_not_driving_energy";
    };
  };
  summary: {
    energy_kpis: EnergyKpis;
    energy_sessions: ChargingEvidence[];
    energy_world_hash: string;
    audit_fingerprint_sha256: string;
  } | null;
};
export type Dossier = {
  researched_at: string;
  sources: { id: string; title: string; url: string; content_period: string }[];
  facts: {
    id: string;
    label: string;
    value: number | boolean;
    unit: string;
    status: string;
    as_of: string;
    source_id: string;
    scope: string;
  }[];
  unresolved_inputs: { id: string; value: null; unit: string; needed_for: string }[];
};
export type Reference = { dossier: Dossier; defaults: Assumptions };
export type ChartRow = { minute: number; [key: string]: number };
