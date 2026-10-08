import { describe, expect, it } from "vitest";
import { shortfallHeadline, worstShortfall } from "./headline";
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
