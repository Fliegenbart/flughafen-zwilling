import { describe, expect, it } from "vitest";
import { shortfallHeadline, shortfallPhases, worstShortfall } from "./headline";
import type { LiveResult } from "./livePower";

const empty: LiveResult = {
  importKw: [],
  capKw: [],
  missingKw: [],
  batteryKw: [],
  minutesAtLimit: 0,
  peakImportKw: 0,
  maxMissingKw: 0,
  missingKwh: 0,
  shortfalls: [],
};

describe("shortfallHeadline", () => {
  it("sagt, wenn der Anschluss reicht", () => {
    expect(shortfallHeadline(empty)).toBe("Der Anschluss reicht den ganzen Tag.");
    expect(worstShortfall(empty)).toBeNull();
  });
  it("nennt die schlimmste Phase mit Uhrzeit und Leistung", () => {
    const r: LiveResult = {
      ...empty,
      shortfalls: [
        { start: 90, end: 141, maxMissingKw: 301, missingKwh: 100 },
        { start: 360, end: 400, maxMissingKw: 1340, missingKwh: 500 },
      ],
    };
    expect(shortfallHeadline(r)).toBe("Von 06:00 bis 06:40 Uhr fehlen bis zu 1,34\u00a0MW.");
  });
});

describe("shortfallPhases", () => {
  it("fasst Unterbrechungen unter 20 Minuten zu einer Phase zusammen", () => {
    const r: LiveResult = {
      ...empty,
      shortfalls: [
        { start: 310, end: 316, maxMissingKw: 309, missingKwh: 22 },
        { start: 317, end: 318, maxMissingKw: 83, missingKwh: 1 },
        { start: 330, end: 348, maxMissingKw: 275, missingKwh: 26 },
        { start: 400, end: 420, maxMissingKw: 714, missingKwh: 203 },
      ],
    };
    expect(shortfallPhases(r)).toEqual([
      { start: 310, end: 348, maxMissingKw: 309, missingKwh: 49 },
      { start: 400, end: 420, maxMissingKw: 714, missingKwh: 203 },
    ]);
    expect(r.shortfalls[0]!.end).toBe(316); // die Eingabe bleibt unveraendert
    expect(shortfallHeadline(r)).toBe("Von 06:40 bis 07:00 Uhr fehlen bis zu 714\u00a0kW.");
  });
});
