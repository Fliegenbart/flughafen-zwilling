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

  it("bieten Schlepper nur an, wenn das Modell sie noch rechnet", () => {
    const schlepper = PRESETS.find((p) => p.id === "schlepper")!;
    expect(schlepper.applies?.(today)).toBe(true);
    expect(schlepper.applies?.(today, 295)).toBe(true);
    expect(schlepper.applies?.(today, 296)).toBe(false);
    expect(schlepper.applies?.(today, 300)).toBe(false);
    expect(schlepper.applies?.(today, { pushback_tug: 196, bus: 20 })).toBe(false);
    expect(schlepper.applies?.(today, { pushback_tug: 195, bus: 20 })).toBe(true);
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
  const fleet = { bus: 170, baggage_tractor: 35, pushback_tug: 10, gpu: 35 };

  it("endet dort, wo das Modell nicht mehr rechnet (300 Fahrzeuge insgesamt)", () => {
    expect(leverRanges(today, 101).extraVehicles.max).toBe(60);
    expect(leverRanges(today, 270).extraVehicles.max).toBe(30);
    expect(leverRanges(today, 300).extraVehicles.max).toBe(0);
    expect(leverRanges(today, 340).extraVehicles.max).toBe(0);
  });

  it("bleibt auf dem Raster des Reglers, auch bei ungerader Flotte", () => {
    expect(leverRanges(today, 281).extraVehicles.max).toBe(18);
    expect(leverRanges(today, 299).extraVehicles.max).toBe(0);
  });

  it("zählt bei gewählter Art deren Bestand: höchstens 200 je Art", () => {
    // 250 Fahrzeuge insgesamt, davon 170 Busse: 50 passen insgesamt, 30 bei den Bussen.
    expect(leverRanges(today, fleet).extraVehicles.max).toBe(50);
    expect(leverRanges(today, fleet, "bus").extraVehicles.max).toBe(30);
    expect(leverRanges(today, fleet, "gpu").extraVehicles.max).toBe(50);
  });

  it("rechnet ohne Auswahl mit der Mischung der Standardflotte", () => {
    // Mit 195 Bussen ist Platz für 5 weitere; ein Fünftel der Zusatzfahrzeuge sind Busse.
    const tight = { bus: 195, baggage_tractor: 10, pushback_tug: 5, gpu: 10 };
    const max = leverRanges(today, tight).extraVehicles.max;
    expect(max).toBeLessThan(60);
    expect(max).toBeGreaterThan(0);
    expect(max % 2).toBe(0);
    const body = variantChangesFor({ ...today, extraVehicles: max }, today)!.extra_vehicles!;
    expect(195 + (body.bus ?? 0)).toBeLessThanOrEqual(200);
    const over = variantChangesFor({ ...today, extraVehicles: max + 2 }, today)!.extra_vehicles!;
    expect(195 + (over.bus ?? 0)).toBeGreaterThan(200);
  });
});

describe("Gemerkte Werte mit der Flotte des Projekts", () => {
  it("kappen Zusatzfahrzeuge an der Obergrenze, die der Regler zeigt", () => {
    expect(clampToRanges({ extraVehicles: 60 }, today, { fleet: 280 }).extraVehicles).toBe(20);
    const fleet = { bus: 170, baggage_tractor: 35, pushback_tug: 10, gpu: 35 };
    const wanted = { extraVehicles: 60, extraKind: "bus" as const };
    expect(clampToRanges(wanted, today, { fleet })).toEqual({
      extraVehicles: leverRanges(today, fleet, "bus").extraVehicles.max,
      extraKind: "bus",
    });
  });

  it("lassen die Art weg, wenn keine Zusatzfahrzeuge übrig bleiben", () => {
    expect(clampToRanges({ extraVehicles: 6, extraKind: "gpu" }, today, { fleet: 300 })).toEqual({
      extraVehicles: 0,
    });
  });

  it("verwerfen die Photovoltaik, wenn das Projekt keine hat", () => {
    expect(clampToRanges({ pvFactor: 2, gridLimitKw: 4000 }, today, { pvKwp: 0 })).toEqual({
      gridLimitKw: 4000,
    });
    expect(clampToRanges({ pvFactor: 2 }, today, { pvKwp: 800 })).toEqual({ pvFactor: 2 });
    // Ohne Angabe bleibt der Faktor, wie bisher.
    expect(clampToRanges({ pvFactor: 2 }, today)).toEqual({ pvFactor: 2 });
  });
});
