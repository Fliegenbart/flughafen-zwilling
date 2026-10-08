import { describe, expect, it } from "vitest";
import { previewBodyFor, variantChangesFor } from "../api/preview";
import type { Levers } from "../model/livePower";
import { isPreset, leverRanges, PRESETS, presetLevers } from "./levers";

const today: Levers = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1, policy: "uncontrolled" };

describe("Reglerbereiche", () => {
  it.each([800, 3500, 12000, 45000])("lassen heute immer auf der Schiene (%d kW)", (kw) => {
    const r = leverRanges({ ...today, gridLimitKw: kw }).gridLimitKw;
    expect(r.min).toBeLessThan(kw);
    expect(r.max).toBeGreaterThan(kw);
    expect(r.min % r.step).toBe(0);
  });

  it("öffnen die Batterie bis mindestens 6 MWh und über das Dreifache von heute", () => {
    expect(leverRanges(today).batteryKwh.max).toBe(6000);
    expect(leverRanges({ ...today, batteryKwh: 4000 }).batteryKwh.max).toBe(12000);
  });
});

describe("Vorschläge", () => {
  it("ändern genau eine Sache gegenüber heute und erkennen sich wieder", () => {
    for (const p of PRESETS) {
      const lv = presetLevers(p, today);
      expect(isPreset(p, lv, today)).toBe(true);
      expect(isPreset(p, today, today)).toBe(false);
      expect(variantChangesFor(lv, today)).not.toBeNull();
    }
  });

  it("bieten nur an, was sich gegenüber heute ändert", () => {
    const mission = { ...today, policy: "mission_priority" as const, batteryKwh: 2000 };
    const ids = PRESETS.filter((p) => p.applies?.(mission) ?? true).map((p) => p.id);
    expect(ids).not.toContain("laderegel");
    expect(ids).not.toContain("speicher");
  });
});

describe("Anfrage an die Vorschau", () => {
  it("nimmt nur Änderungen mit und trennt den Krisenfall von der Lösung", () => {
    expect(previewBodyFor(today, today)).toEqual({});
    expect(variantChangesFor(today, today)).toBeNull();
    const lv: Levers = {
      ...today,
      gridLimitKw: 4000,
      extraVehicles: 6,
      extraKind: "gpu",
      policy: "mission_priority",
      crisis: "airport_case_03_wetter_kompression_v1",
    };
    expect(variantChangesFor(lv, today)).toEqual({
      grid_import_limit_kw: 4000,
      extra_vehicles: { gpu: 6 },
      charging_policy: "mission_priority",
    });
    expect(previewBodyFor(lv, today)).toMatchObject({
      crisis: "airport_case_03_wetter_kompression_v1",
      charging_policy: "mission_priority",
    });
  });

  it("verteilt zusätzliche Fahrzeuge ohne Auswahl im Verhältnis der Standardflotte", () => {
    const body = variantChangesFor({ ...today, extraVehicles: 10 }, today)!;
    expect(Object.values(body.extra_vehicles!).reduce((a, b) => a + b, 0)).toBe(10);
    expect(Object.keys(body.extra_vehicles!).length).toBeGreaterThan(1);
  });
});
