import { describe, expect, it } from "vitest";
import { compareCsv, exportCsv, type MeasurementProfile } from "./measurementData";

export const profile: MeasurementProfile = {
  run_id: "abc",
  metric: "grid_import_kw",
  unit: "kW",
  interval_seconds: 60,
  sample_semantics: "interval_end_mean",
  evidence_level: "model_checked",
  provenance: { artifact_sha256: "hash" },
  points: Array.from({ length: 60 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i + 1)).toISOString(),
    model_kw: 100,
  })),
};
const csv = (value = "110") =>
  "timestamp,measured_kw\n" + profile.points.map((p) => `${p.timestamp},${value}`).join("\n");

describe("lokaler Messdatenvertrag", () => {
  it("berechnet echte Abweichungen mit Minutenmittelwerten ohne PASS", () => {
    const result = compareCsv(csv(), profile);
    expect(result.mae_kw).toBe(10);
    expect(result.bias_kw).toBe(-10);
    expect(result.model_kwh).toBeCloseTo(100);
    expect(result.measured_kwh).toBeCloseTo(110);
    expect(result.energy_error_pct).toBeCloseTo(100 / 11);
    expect(result.synthetic).toBe(false);
    expect(result).not.toHaveProperty("pass");
  });
  it("trennt Profil, leere Vorlage und markierte Uebung", () => {
    expect(exportCsv(profile, "model")).toContain("timestamp,model_kw");
    expect(() => compareCsv(exportCsv(profile, "model"), profile)).toThrow(/measured_kw/);
    expect(() => compareCsv(exportCsv(profile, "template"), profile)).toThrow(/Zeile 2/);
    const exercise = exportCsv(profile, "exercise");
    expect(exercise).toContain("synthetic_exercise");
    expect(compareCsv(exercise, profile).synthetic).toBe(true);
    expect(compareCsv(exercise, profile).mae_kw).toBeGreaterThan(0);
  });
  it.each(["", "NaN", "Infinity", "-1", "0x10", "1e309", "1000001"])(
    "sperrt ungueltige Leistung %s",
    (value) => {
      expect(() => compareCsv(csv(value), profile)).toThrow();
    },
  );
  it("sperrt Luecken, doppelte Zeiten, andere Zeitraeume und falsche Kalenderdaten", () => {
    expect(() => compareCsv(csv().split("\n").slice(0, -1).join("\n"), profile)).toThrow(/Zeit/);
    expect(() =>
      compareCsv(
        csv().replace(profile.points[1]!.timestamp, profile.points[0]!.timestamp),
        profile,
      ),
    ).toThrow(/Zeit/);
    expect(() => compareCsv(csv().replace(/2026-01-01/g, "2026-01-02"), profile)).toThrow(/Zeit/);
    expect(() => compareCsv(csv().replace(/2026-01-01/g, "2026-02-30"), profile)).toThrow(/Zeit/);
  });
  it("akzeptiert BOM, CRLF und gleichwertige explizite UTC-Zeitzone", () => {
    expect(
      compareCsv("\uFEFF" + csv().replace(/Z/g, "+00:00").replace(/\n/g, "\r\n"), profile).mae_kw,
    ).toBe(10);
  });
  it("erfindet keinen relativen Fehler bei Nullmessung und erkennt identische Reihen", () => {
    expect(compareCsv(csv("0"), profile).energy_error_pct).toBeNull();
    expect(compareCsv(csv("100"), profile).identical).toBe(true);
  });
});
