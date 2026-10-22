import { describe, expect, it } from "vitest";
import type { Atlas } from "../api/electrification";
import { answer, firstSufficient, nearest, stagesFor, START, type Settings } from "./stufen";

const atlas = (
  uncontrolled: number | null,
  managed: number | null,
  storage: number | null,
): Atlas => ({
  axes: { electric_share_pct: [50], storage_kwh: [0, 2000], pv_kwp: [500], parking_sessions: [40] },
  fleet: {},
  // Der erste Wert (direkt, am Anschluss begrenzt) gehört zur Seite für Fachleute.
  entries: {
    "50|2000|500|40": [875, managed, storage],
    "50|0|500|40": [875, managed, managed],
  },
  peaks: { "50|500|40": uncontrolled },
  gridMaxKw: 8000,
  gridStepKw: 25,
});
const at = (kw: number, s: Partial<Settings> = {}) => ({
  ...START,
  grid_import_limit_kw: kw,
  ...s,
});
const say = (a: Atlas, kw: number, s: Partial<Settings> = {}) =>
  answer(stagesFor(a, at(kw, s))!, kw, a.gridMaxKw);

describe("Treppe des Ökosystems", () => {
  it("rechnet die Ersparnis jeder Stufe gegenüber Laden ohne Steuerung", () => {
    const stages = stagesFor(atlas(1625, 800, 675), START)!;
    expect(stages.map((s) => s.needKw)).toEqual([1625, 800, 675]);
    expect(stages.map((s) => s.savingKw)).toEqual([null, 825, 950]);
  });

  it("nennt die Stufe, ab der der Anschluss reicht", () => {
    expect(say(atlas(1625, 800, 675), 1700)).toMatch(
      /^Ihr Anschluss von 1.700\skW reicht schon heute\. Mit allen Bausteinen bleiben 1.025\skW frei/,
    );
    expect(say(atlas(1625, 800, 675), 1500)).toMatch(
      /^Ungesteuertes Laden würde Ihren Anschluss von 1.500\skW überlasten\. Mit Lademanagement reicht er/,
    );
    expect(say(atlas(1625, 800, 675), 700)).toMatch(/^Erst mit Lademanagement und Speicher reicht/);
    expect(say(atlas(1625, 800, 675), 600)).toMatch(/^Ihr Anschluss muss um 75\skW wachsen/);
  });

  it("zählt Stufe 3 ohne Speicher nicht als eigene Lösung", () => {
    const stages = stagesFor(atlas(1625, 800, 675), { ...START, storage_kwh: 0 })!;
    expect(stages[2]!.inactive).toBe(true);
    expect(firstSufficient(stages, 780)).toBeNull();
    expect(say(atlas(1625, 800, 675), 780, { storage_kwh: 0 })).toMatch(/wachsen/);
  });

  it("zählt einen Speicher, der den Bedarf nicht senkt, nicht als Stufe", () => {
    const stages = stagesFor(atlas(1625, 800, 850), START)!;
    expect(stages[2]).toMatchObject({ inactive: true, noGain: true });
    expect(firstSufficient(stages, 825)).toMatchObject({ id: "managed" });
    expect(say(atlas(1625, 800, 850), 700)).toMatch(/^Ihr Anschluss muss um 100\skW wachsen/);
    expect(stagesFor(atlas(1625, 800, 800), START)![2]!.noGain).toBe(true);
    expect(stagesFor(atlas(1625, 800, 675), START)![2]!.noGain).toBe(false);
  });

  it("sagt ehrlich, wenn das Modell keine Stufe findet", () => {
    expect(say(atlas(null, null, null), 1500)).toMatch(
      /^Selbst 8.000\skW Anschluss reichen im Modell nicht/,
    );
  });

  it("liefert nichts für Stellungen außerhalb der Tabelle", () => {
    expect(stagesFor(atlas(1625, 800, 675), { ...START, pv_kwp: 1000 })).toBeNull();
    const withoutPeak = { ...atlas(1625, 800, 675), peaks: {} };
    expect(stagesFor(withoutPeak, START)).toBeNull();
  });

  it("rastet auf den nächsten Tabellenwert ein", () => {
    expect(nearest([0, 500, 1000, 2000, 4000], 1400)).toBe(1000);
    expect(nearest([0, 40, 100, 200], 75)).toBe(100);
  });
});
