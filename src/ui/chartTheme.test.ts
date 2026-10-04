import { expect, it } from "vitest";
import { chartTheme } from "./chartTheme";

function contrastWithWhite(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722 + 0.05);
}

it("keeps axis, tooltip and status text readable on white", () => {
  for (const hex of [
    chartTheme.axis,
    chartTheme.tooltip.color,
    chartTheme.series.amber,
    chartTheme.series.red,
    chartTheme.series.green,
  ]) {
    expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  }
});
