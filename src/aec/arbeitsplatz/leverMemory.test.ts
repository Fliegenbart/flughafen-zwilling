import { afterEach, describe, expect, it } from "vitest";
import type { Levers } from "../model/livePower";
import { SCENARIO_CASES } from "../scenarios";
import { loadLevers, saveLevers } from "./leverMemory";

const today: Levers = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1, policy: "uncontrolled" };
const stored = () => JSON.parse(sessionStorage.getItem("aec.regler.p1") ?? "null") as unknown;

afterEach(() => sessionStorage.clear());

describe("Reglergedächtnis", () => {
  it("merkt nur, was von heute abweicht", () => {
    saveLevers("p1", { ...today, batteryKwh: 2000, batteryKw: 1000 }, today);
    expect(stored()).toEqual({ batteryKwh: 2000, batteryKw: 1000 });
  });

  it("merkt die Laderegel und den Krisenfall, auch wenn heute keine Angabe hat", () => {
    const crisis = SCENARIO_CASES[0]!.scenarioId;
    saveLevers("p1", { ...today, policy: "mission_priority", crisis }, today);
    expect(stored()).toEqual({ policy: "mission_priority", crisis });
    const noPolicy: Levers = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1 };
    saveLevers("p1", { ...noPolicy, crisis }, noPolicy);
    expect(stored()).toEqual({ crisis });
  });

  it("lässt die Art der zusätzlichen Fahrzeuge weg, wenn es keine mehr gibt", () => {
    saveLevers("p1", { ...today, gridLimitKw: 4000, extraVehicles: 0, extraKind: "gpu" }, today);
    expect(stored()).toEqual({ gridLimitKw: 4000 });
    saveLevers("p1", { ...today, extraVehicles: 4, extraKind: "gpu" }, today);
    expect(stored()).toEqual({ extraVehicles: 4, extraKind: "gpu" });
  });

  it("vergisst bei „wie heute“ und bei null", () => {
    saveLevers("p1", { ...today, gridLimitKw: 4000 }, today);
    saveLevers("p1", { ...today }, today);
    expect(stored()).toBeNull();
    saveLevers("p1", { ...today, gridLimitKw: 4000 }, today);
    saveLevers("p1", null, today);
    expect(stored()).toBeNull();
  });

  it("liest zurück, was gespeichert wurde", () => {
    const lv: Levers = { ...today, gridLimitKw: 4000, policy: "mission_priority" };
    saveLevers("p1", lv, today);
    expect(loadLevers("p1")).toEqual({ gridLimitKw: 4000, policy: "mission_priority" });
    expect(loadLevers("p2")).toBeUndefined();
  });

  it("verwirft Felder, die nicht zu einer Reglerstellung passen", () => {
    sessionStorage.setItem(
      "aec.regler.p1",
      JSON.stringify({
        gridLimitKw: "viel",
        batteryKwh: 2000,
        pvFactor: null,
        extraKind: "rakete",
        policy: "chaos",
        crisis: "gibt_es_nicht",
        unbekannt: 1,
      }),
    );
    expect(loadLevers("p1")).toEqual({ batteryKwh: 2000 });
    sessionStorage.setItem("aec.regler.p1", "kein json");
    expect(loadLevers("p1")).toBeUndefined();
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "nimmt %s nicht als Fahrzeugart",
    (name) => {
      sessionStorage.setItem(
        "aec.regler.p1",
        JSON.stringify({ extraVehicles: 4, extraKind: name }),
      );
      expect(loadLevers("p1")).toEqual({ extraVehicles: 4 });
    },
  );

  it("liest auch eine vollständige Stellung aus dem alten Format", () => {
    sessionStorage.setItem("aec.regler.p1", JSON.stringify({ ...today, gridLimitKw: 4500 }));
    expect(loadLevers("p1")).toMatchObject({ gridLimitKw: 4500, policy: "uncontrolled" });
  });
});
