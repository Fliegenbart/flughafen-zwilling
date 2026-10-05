import { expect, it } from "vitest";
import { chartTheme, chartThemeDark, chartTokens } from "./chartTheme";

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

function luminance(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}

it("keeps dark chart text readable on the dark surface", () => {
  const surface = luminance(chartThemeDark.tooltip.background);
  for (const hex of [
    chartThemeDark.axis,
    chartThemeDark.tooltip.color,
    ...Object.values(chartThemeDark.series),
  ]) {
    expect((luminance(hex) + 0.05) / (surface + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});

it("exposes chart colors as theme variables with light fallback", () => {
  expect(chartTokens.axis).toBe(`var(--chart-axis, ${chartTheme.axis})`);
  expect(chartTokens.series.red).toContain(chartTheme.series.red);
});
