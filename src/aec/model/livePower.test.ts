import { describe, expect, it } from "vitest";
import reference from "./__fixtures__/livePowerReference.json";
import {
  leversFromBasis,
  resultFromExact,
  simulateLive,
  type LiveBasis,
  type Levers,
} from "./livePower";

type Raw = typeof reference.basis;
function basisFrom(raw: Raw): LiveBasis {
  const p = raw.power;
  return {
    dayMinutes: raw.day_minutes,
    startMin: raw.start_min,
    requestedKw: raw.requested_kw,
    deliveredKw: raw.delivered_kw,
    backgroundKw: raw.background_kw,
    pvKw: raw.pv_kw,
    chpKw: raw.chp_kw,
    gridCapKw: raw.grid_cap_kw,
    gridImportKw: raw.grid_import_kw,
    batteryKw: raw.battery_kw,
    power: {
      gridImportLimitKw: p.grid_import_limit_kw,
      pvCapacityKwp: p.pv_capacity_kwp,
      batteryCapacityKwh: p.battery_capacity_kwh,
      batteryPowerKw: p.battery_power_kw,
      batteryInitialSocPct: p.battery_initial_soc_pct,
      batteryReservePct: p.battery_reserve_pct,
      batteryEfficiency: p.battery_efficiency,
      batteryGridChargeBelowKw: p.battery_grid_charge_below_kw ?? null,
      transformerEfficiency: p.transformer_efficiency,
      chargingLimitKw: p.charging_limit_kw,
    },
  };
}

const basis = basisFrom(reference.basis);
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
 * Rolle der Naeherung: sofortige Rueckmeldung beim Ziehen. Nach einer kurzen Pause ersetzt die
 * genaue Vorschau (POST /situation/preview) sie. Darum gilt: Ob etwas fehlt, muss stimmen; die
 * Spitze auf 3 % genau; bei starkem Engpass fehlende Energie auf 30 %, fehlende Leistung auf
 * 20 % (gemessen: hoechstens 22 % bzw. 15 % daneben, siehe CARRY_DECAY).
 */
const TOL = { peakImportRel: 0.03, smallMissingKwh: 25, severeKwhRel: 0.3, severeKwRel: 0.2 };
const SEVERE_KWH = 500;

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
    expect(Math.abs(r.missingKwh - e.missing_kwh)).toBeLessThanOrEqual(TOL.smallMissingKwh);
    expect(Math.abs(r.peakImportKw - e.peak_import_kw)).toBeLessThanOrEqual(
      e.peak_import_kw * TOL.peakImportRel,
    );
  });

  it.each(reference.cases.map((c) => [JSON.stringify(c.lever), c] as const))(
    "Regler %s",
    (_, c) => {
      const r = simulateLive(basis, leversFor(c.lever as unknown as Record<string, number>));
      const e = c.exact;
      // Engpass ja/nein muss stimmen.
      expect(r.shortfalls.length > 0).toBe(e.max_missing_kw > 0.5);
      expect(Math.abs(r.peakImportKw - e.peak_import_kw)).toBeLessThanOrEqual(
        e.peak_import_kw * TOL.peakImportRel,
      );
      if (e.missing_kwh >= SEVERE_KWH) {
        expect(Math.abs(r.missingKwh - e.missing_kwh)).toBeLessThan(
          e.missing_kwh * TOL.severeKwhRel,
        );
        expect(Math.abs(r.maxMissingKw - e.max_missing_kw)).toBeLessThan(
          e.max_missing_kw * TOL.severeKwRel,
        );
      } else {
        expect(Math.abs(r.missingKwh - e.missing_kwh)).toBeLessThanOrEqual(TOL.smallMissingKwh);
      }
    },
  );

  it("rechnet einen Tag schnell genug zum Ziehen (unter 15 ms)", () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) simulateLive(basis, { ...base, gridLimitKw: 3000 + i * 50 });
    expect((performance.now() - t) / 20).toBeLessThan(15);
  });
});
