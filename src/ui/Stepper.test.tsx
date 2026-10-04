import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DEMO_STEPS, StepFooter, StepPanel, StepProvider, Stepper } from "./Stepper";

afterEach(() => window.history.replaceState(null, "", "/"));

function Demo() {
  return (
    <StepProvider steps={DEMO_STEPS}>
      <Stepper />
      {DEMO_STEPS.map((step) => (
        <StepPanel key={step.id} step={step.id}>
          <p>Inhalt {step.label}</p>
          <StepFooter />
        </StepPanel>
      ))}
      <StepPanel step="pilot" lazy>
        <p>Spät geladen</p>
      </StepPanel>
    </StepProvider>
  );
}

const panel = (id: string) => document.querySelector(`[data-step-panel="${id}"]`)!;

it("shows the five demo steps in order and marks exactly one as current", () => {
  render(<Demo />);
  const nav = screen.getByRole("navigation", { name: "Vorführschritte" });
  const buttons = Array.from(nav.querySelectorAll("button"));
  expect(buttons.map((b) => b.querySelector("strong")!.textContent)).toEqual([
    "System verstehen",
    "Betriebswirkung",
    "Robustheit",
    "Pilot vereinbaren",
    "Nachweise",
  ]);
  expect(nav.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(panel("system")).toHaveAttribute("data-active", "true");
  expect(panel("betrieb")).toHaveAttribute("data-active", "false");
});

it("switches by click, keyboard and footer and keeps the step in the URL", () => {
  render(<Demo />);
  fireEvent.click(screen.getByRole("button", { name: /Robustheit/ }));
  expect(panel("robustheit")).toHaveAttribute("data-active", "true");
  expect(window.location.search).toContain("schritt=robustheit");
  const current = screen.getByRole("button", { name: /Robustheit/ });
  fireEvent.keyDown(current, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: /Pilot vereinbaren/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(screen.getByRole("button", { name: /Pilot vereinbaren/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(panel("system")).toHaveAttribute("data-active", "true");
  const footer = panel("system").querySelector(".ds-step-footer button")!;
  expect(footer).toHaveTextContent("Weiter: Betriebswirkung");
  fireEvent.click(footer);
  expect(panel("betrieb")).toHaveAttribute("data-active", "true");
});

it("mounts lazy steps only after the first visit and restores the step from the URL", () => {
  window.history.replaceState(null, "", "/?schritt=nachweise");
  render(<Demo />);
  expect(panel("nachweise")).toHaveAttribute("data-active", "true");
  expect(screen.queryByText("Spät geladen")).not.toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Vorführschritte" });
  fireEvent.click(within(nav).getByRole("button", { name: /Pilot vereinbaren/ }));
  expect(screen.getByText("Spät geladen")).toBeInTheDocument();
});

it("renders panels without a provider so standalone components stay usable", () => {
  render(
    <StepPanel step="system">
      <p>Ohne Navigator</p>
    </StepPanel>,
  );
  expect(panel("system")).toHaveAttribute("data-active", "true");
});
