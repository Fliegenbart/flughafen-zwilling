import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVIDENCE_LEVELS, EvidenceBadge, EvidenceLegend } from "./EvidenceBadge";

it("names the four evidence levels consistently", () => {
  expect(Object.values(EVIDENCE_LEVELS).map((l) => l.label)).toEqual([
    "Annahme",
    "synthetisch",
    "modellintern geprüft",
    "empirisch offen",
  ]);
});

it("is focusable and explains itself through a linked tooltip", () => {
  render(<EvidenceBadge level="model_checked" label="faire Vergleichswelt" />);
  const chip = screen.getByLabelText("faire Vergleichswelt (Evidenz: modellintern geprüft)");
  expect(chip).toHaveAttribute("tabindex", "0");
  const tip = document.getElementById(chip.getAttribute("aria-describedby")!)!;
  expect(tip).toHaveAttribute("role", "tooltip");
  expect(tip).toHaveTextContent(/Kein Abgleich mit der Realität/);
});

it("renders a legend with every level", () => {
  render(<EvidenceLegend />);
  expect(screen.getByRole("list", { name: "Legende Evidenzstatus" }).children).toHaveLength(4);
});

it("never uses a green tone for any evidence level", () => {
  const css = readFileSync(resolve(__dirname, "designSystem.css"), "utf8");
  const values = [...css.matchAll(/--ev-[a-z]+-(?:bg|ink|dot):\s*(#[0-9a-f]{6})/gi)].map(
    (m) => m[1]!,
  );
  expect(values.length).toBeGreaterThanOrEqual(24);
  for (const hex of values) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Gruen dominiert, wenn G deutlich ueber R und B liegt.
    expect(g! > r! + 24 && g! > b! + 24).toBe(false);
  }
});
