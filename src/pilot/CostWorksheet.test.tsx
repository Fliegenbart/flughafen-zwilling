import { describe, it, expect } from "vitest";
import { gridCost } from "./CostWorksheet";
describe("bounded grid cost component", () => {
  it("computes only imported/exported energy costs, including negative tariffs", () => {
    expect(gridCost(100, 20, 0.3, 0.1)).toBe(28);
    expect(gridCost(100, 0, -0.1, 0)).toBe(-10);
  });
  it("rejects absent or nonfinite/negative energy rather than inventing zero", () => {
    expect(() => gridCost(NaN, 0, 0.3, 0.1)).toThrow();
    expect(() => gridCost(-1, 0, 0.3, 0.1)).toThrow();
  });
});
