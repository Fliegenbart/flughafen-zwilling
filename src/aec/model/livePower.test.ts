import { describe, expect, it } from "vitest";
import { previewFromApi } from "../api/preview";
import day from "../beispieltag.json";
import reference from "./__fixtures__/livePowerReference.json";
import { leversFromBasis, resultFromExact, simulateLive, type Levers } from "./livePower";

const preview = previewFromApi({ ...day.basis, kpis: day.kpis }, day.departures);
if (!preview) throw new Error("Beispieltag fehlt.");
const basis = preview.basis;
const base = leversFromBasis(basis);

function leversFor(l: Record<string, number>): Levers {
  return {
    gridLimitKw: l.grid_import_limit_kw ?? base.gridLimitKw,
    batteryKwh: l.battery_capacity_kwh ?? base.batteryKwh,
    batteryKw: l.battery_power_kw,
    pvFactor: l.pv_factor ?? 1,
  };
}

/**
 * Die Naeherung rechnet die Ladenachfrage der Flotte nach denselben Regeln wie das Backend nach
 * (liveFleet.ts) und hat keine abgestimmten Konstanten. Darum gilt hier kein Prozentband,
 * sondern Gleichheit bis auf Rundung (die Basisreihen sind auf 3 Stellen gerundet).
 * Weicht eine Regel im Backend ab, schlaegt dieser Test fuer die Stellungen in
 * backend/scripts/make_live_power_fixture.py an.
 */
const TOL = { kw: 0.5, kwh: 0.5, peakKw: 0.5 };

describe("Live-Naeherung gegen genaue Rechnung", () => {
  it("liest die genaue Rechnung mit denselben Definitionen wie das Backend", () => {
    const r = resultFromExact(basis);
    const e = reference.base_exact;
    expect(r.minutesAtLimit).toBe(e.minutes_at_limit);
    expect(r.peakImportKw).toBeCloseTo(e.peak_import_kw, 1);
    expect(r.maxMissingKw).toBeCloseTo(e.max_missing_kw, 1);
    expect(r.missingKwh).toBeCloseTo(e.missing_kwh, 0);
  });

  it("trifft den Basislauf selbst", () => {
    const r = simulateLive(basis, base);
    const e = reference.base_exact;
    expect(Math.abs(r.missingKwh - e.missing_kwh)).toBeLessThanOrEqual(TOL.kwh);
    expect(Math.abs(r.maxMissingKw - e.max_missing_kw)).toBeLessThanOrEqual(TOL.kw);
    expect(Math.abs(r.peakImportKw - e.peak_import_kw)).toBeLessThanOrEqual(TOL.peakKw);
  });

  it.each(reference.cases.map((c) => [JSON.stringify(c.lever), c] as const))(
    "Regler %s",
    (_, c) => {
      const r = simulateLive(basis, leversFor(c.lever as unknown as Record<string, number>));
      const e = c.exact;
      expect(r.shortfalls.length > 0).toBe(e.max_missing_kw > 0.5);
      expect(Math.abs(r.missingKwh - e.missing_kwh)).toBeLessThanOrEqual(TOL.kwh);
      expect(Math.abs(r.maxMissingKw - e.max_missing_kw)).toBeLessThanOrEqual(TOL.kw);
      expect(Math.abs(r.peakImportKw - e.peak_import_kw)).toBeLessThanOrEqual(TOL.peakKw);
      expect(Math.abs(r.minutesAtLimit - e.minutes_at_limit)).toBeLessThanOrEqual(1);
    },
  );

  it("rechnet einen Tag schnell genug zum Ziehen (unter 15 ms)", () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) simulateLive(basis, { ...base, gridLimitKw: 3000 + i * 50 });
    expect((performance.now() - t) / 20).toBeLessThan(15);
  });
});
