import { describe, expect, it } from "vitest";
import { configError } from "./config";
import type { Bench, Criteria } from "./types";

const bench: Bench = {
  name: "Prüfstand",
  min_power_kw: -50,
  max_power_kw: 100,
  grid_limit_kw: 100,
  ramp_kw_per_s: 10,
  response_delay_s: 1,
  noise_kw: 0.5,
};
const criteria: Criteria = {
  tolerance_kw: 2,
  tracking_mae_max_kw: 2,
  response_max_s: 5,
  settling_s: 3,
  grace_s: 2,
  limit_violation_budget_s: 0,
  min_coverage_pct: 98,
  expected_interval_s: 1,
  max_gap_s: 3,
};

describe("FlexLab-Formulargrenzen entsprechen dem Backend", () => {
  it("akzeptiert die Standardwerte", () => {
    expect(configError(bench, criteria)).toBeNull();
  });
  it("verlangt mindestens 90 % Abdeckung", () => {
    expect(configError(bench, { ...criteria, min_coverage_pct: 89 })).toMatch(/Abdeckung/);
  });
  it("begrenzt die Zeitlücke auf 300 s und das 10-fache Intervall", () => {
    expect(configError(bench, { ...criteria, expected_interval_s: 100, max_gap_s: 301 })).toMatch(
      /Zeitlücke/,
    );
    expect(configError(bench, { ...criteria, max_gap_s: 11 })).toMatch(/10-fache/);
    expect(configError(bench, { ...criteria, max_gap_s: 10 })).toBeNull();
  });
});
