export type CaseId = "setpoint-step" | "flex-reduction" | "power-cap" | "telemetry-loss";
export interface Bench {
  name: string;
  min_power_kw: number;
  max_power_kw: number;
  grid_limit_kw: number;
  ramp_kw_per_s: number;
  response_delay_s: number;
  noise_kw: number;
}
export interface Criteria {
  tolerance_kw: number;
  tracking_mae_max_kw: number;
  response_max_s: number;
  settling_s: number;
  grace_s: number;
  limit_violation_budget_s: number;
  min_coverage_pct: number;
  expected_interval_s: number;
  max_gap_s: number;
}
export interface Sample {
  ts_s: number;
  power_kw: number | null;
  setpoint_kw: number;
  limit_kw: number;
}
export interface Catalog {
  product: string;
  read_only: boolean;
  live_connection: boolean;
  cases: { id: CaseId; name: string; description: string; tag: string }[];
  default_bench: Bench;
  default_criteria: Criteria;
  csv_columns: string[];
}
export interface Analysis {
  verdict: "pass" | "fail" | "inconclusive";
  metrics: {
    peak_power_kw: number;
    energy_import_kwh: number;
    energy_export_kwh: number;
    tracking_mae_kw: number | null;
    response_time_s: number | null;
    limit_violation_s: number;
    observed_duration_s: number;
  };
  quality: {
    coverage_pct: number;
    sampling_coverage_pct: number | null;
    missing_samples: number;
    sample_count: number;
    max_gap_s: number;
    reasons: string[];
  };
  checks: {
    id: string;
    name: string;
    state: "pass" | "fail" | "inconclusive" | "not_applicable";
    actual: number | null;
    threshold: number | null;
    unit: string;
    detail: string;
  }[];
}
export interface LabRun {
  run_id: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  source: "simulation" | "csv_import";
  case_id: CaseId;
  label: string;
  bench: Bench;
  criteria: Criteria;
  created_ts: string;
  start_ts: string | null;
  end_ts: string | null;
  progress: number;
  error: string | null;
  request: { duration_s: number; seed: number; playback_speed: number } | null;
  filename: string | null;
  source_sha256: string | null;
  comparison_key: string | null;
  analysis: Analysis | null;
  recovery_count: number;
  build_commit: string;
  build_source_sha256: string;
  artifacts: string[];
  provenance: string;
}
export interface Comparison {
  baseline_id: string;
  candidate_id: string;
  deltas: Record<keyof Analysis["metrics"], number | null>;
  note: string;
}
