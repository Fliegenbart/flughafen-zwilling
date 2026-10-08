import { describe, expect, it } from "vitest";
import { previewBodyFor, variantChangesFor } from "../api/preview";
import type { Levers } from "../model/livePower";
import { clampToRanges, isChanged, isPreset, leverRanges, PRESETS, presetLevers } from "./levers";

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

describe("Batterie-Schiene", () => {
  it("lässt einen vorhandenen Speicher nur verkleinern, nicht entfernen", () => {
    expect(leverRanges({ ...today, batteryKwh: 2000 }).batteryKwh.min).toBe(250);
    expect(leverRanges({ ...today, batteryKwh: 100 }).batteryKwh.min).toBe(100);
    expect(leverRanges(today).batteryKwh.min).toBe(0);
  });

  it("bringt gemerkte Werte auf die Schienen von heute", () => {
    const withBattery = { ...today, batteryKwh: 2000, batteryKw: 1000 };
    expect(clampToRanges({ batteryKwh: 0 }, withBattery)).toEqual({
      batteryKwh: 250,
      batteryKw: 125,
    });
    expect(clampToRanges({ gridLimitKw: 90000 }, today).gridLimitKw).toBe(
      leverRanges(today).gridLimitKw.max,
    );
    expect(clampToRanges({ pvFactor: -1, extraVehicles: 500 }, today)).toEqual({
      pvFactor: 0,
      extraVehicles: 60,
    });
    // Was auf der Schiene liegt, bleibt unberührt.
    const fine = {
      gridLimitKw: 4500,
      batteryKwh: 2000,
      batteryKw: 1000,
      policy: "uncontrolled" as const,
    };
    expect(clampToRanges(fine, today)).toEqual(fine);
  });
});

describe("Änderung gegenüber heute", () => {
  it("erkennt jeden Regler, auch die Laderegel allein", () => {
    expect(isChanged(today, today)).toBe(false);
    expect(isChanged({ ...today, gridLimitKw: 4000 }, today)).toBe(true);
    expect(isChanged({ ...today, batteryKwh: 2000 }, today)).toBe(true);
    expect(isChanged({ ...today, pvFactor: 1.5 }, today)).toBe(true);
    expect(isChanged({ ...today, extraVehicles: 4 }, today)).toBe(true);
    expect(isChanged({ ...today, policy: "mission_priority" }, today)).toBe(true);
    expect(isChanged({ ...today, crisis: "airport_case_03_wetter_kompression_v1" }, today)).toBe(
      true,
    );
  });

  it("zählt fehlende Fahrzeuge und eine fehlende Regel nicht als Änderung", () => {
    expect(isChanged({ ...today, extraVehicles: 0 }, today)).toBe(false);
    expect(isChanged({ ...today, policy: undefined }, today)).toBe(false);
  });

  it("kennt das Entfernen eines Speichers", () => {
    const withBattery = { ...today, batteryKwh: 2000, batteryKw: 1000 };
    expect(isChanged({ ...withBattery, batteryKwh: 0, batteryKw: undefined }, withBattery)).toBe(
      true,
    );
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

describe("Fahrzeugregler", () => {
  it("endet dort, wo das Modell nicht mehr rechnet (300 Fahrzeuge insgesamt)", () => {
    expect(leverRanges(today, 101).extraVehicles.max).toBe(60);
    expect(leverRanges(today, 270).extraVehicles.max).toBe(30);
    expect(leverRanges(today, 300).extraVehicles.max).toBe(0);
    expect(leverRanges(today, 340).extraVehicles.max).toBe(0);
  });
});
