import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVIDENCE_LEVELS, EvidenceBadge, EvidenceLegend } from "./EvidenceBadge";

it("names the five evidence levels consistently", () => {
  expect(Object.values(EVIDENCE_LEVELS).map((l) => l.label)).toEqual([
    "Annahme",
    "ausgedacht",
    "rechnerisch geprüft",
    "noch nicht gemessen",
    "durch Messung bestätigt",
  ]);
});

it("is focusable and explains itself through a linked tooltip", () => {
  render(<EvidenceBadge level="model_checked" label="faire Vergleichswelt" />);
  const chip = screen.getByLabelText("faire Vergleichswelt (Wie sicher: rechnerisch geprüft)");
  expect(chip).toHaveAttribute("tabindex", "0");
  const tip = document.getElementById(chip.getAttribute("aria-describedby")!)!;
  expect(tip).toHaveAttribute("role", "tooltip");
  expect(tip).toHaveTextContent(/noch nicht/);
});

it("renders a legend with every level", () => {
  render(<EvidenceLegend />);
  expect(screen.getByRole("list", { name: "Legende Evidenzstatus" }).children).toHaveLength(5);
});

it("never uses a green tone for any unproven evidence level", () => {
  const css = readFileSync(resolve(__dirname, "designSystem.css"), "utf8");
  const values = [...css.matchAll(/--ev-(?!passed)[a-z]+-(?:bg|ink|dot):\s*(#[0-9a-f]{6})/gi)].map(
    (m) => m[1]!,
  );
  expect(values.length).toBeGreaterThanOrEqual(24);
  for (const hex of values) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Gruen dominiert, wenn G deutlich ueber R und B liegt.
    expect(g! > r! + 24 && g! > b! + 24).toBe(false);
  }
});

it("reserves green for 'empirisch bestanden' only", () => {
  const css = readFileSync(resolve(__dirname, "designSystem.css"), "utf8");
  const dot = /--ev-passed-dot:\s*(#[0-9a-f]{6})/i.exec(css)![1]!;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(dot.slice(i, i + 2), 16));
  expect(g! > r! + 24 && g! > b! + 24).toBe(true);
});

it("shows a five-step ladder with the reached rank filled", () => {
  const { container } = render(<EvidenceBadge level="model_checked" />);
  const steps = container.querySelectorAll(".ds-evidence__ladder i");
  expect(steps).toHaveLength(5);
  expect(container.querySelectorAll(".ds-evidence__ladder i[data-on]")).toHaveLength(3);
});
