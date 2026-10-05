export type PilotProject = {
  id: string;
  name: string;
  decision: string;
  scope: string;
  acceptance_note: string;
  created_at?: string;
};
export type PilotMetrics = {
  time_weighted_mae_kw: number | null;
  time_weighted_bias_kw: number | null;
  energy_error_pct: number | null;
  paired_coverage_seconds: number | null;
};
export type PilotImport = {
  sample_semantics?: "point_samples" | "interval_end_mean";
  source_import_id?: string | null;
  id: string;
  filename: string;
  role: "calibration" | "holdout" | "lab";
  measurement_boundary: string;
  source_note: string;
  quality: {
    state: "valid" | "invalid";
    issues: string[];
    rows: number;
    first_timestamp?: string;
    last_timestamp?: string;
    sha256: string;
    coverage_seconds: number;
  };
  model_provenance: { model_column_status: string; model_run_id: string | null };
};
export type PilotAssessment = {
  id: string;
  import_id: string;
  validity_status: string;
  thresholds: { mae_max_kw: number | null; energy_error_max_pct: number | null };
  evaluation_kind?: string;
  metrics: PilotMetrics;
  not_evaluable_reasons: string[];
};
export type PilotTolerances = {
  tolerances: {
    mae_max_kw: number;
    energy_error_max_pct: number;
    min_rows: number;
    min_coverage_seconds: number;
  };
  sha256: string;
  created_at: string;
  locked_at: string | null;
  locked: boolean;
};
