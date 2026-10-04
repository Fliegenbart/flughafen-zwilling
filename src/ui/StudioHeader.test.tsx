import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StudioHeader, StudioWorkflowNav } from "./StudioHeader";

it("keeps action ownership in its caller and preserves disabled controls", () => {
  const start = vi.fn();
  render(
    <StudioHeader
      title="Flugplan, Flotte & Energie"
      location="München / Systemtest"
      context="Seed 42"
      warning="Nicht kalibriert. Keine reale Flug-OTP."
      actions={
        <>
          <button onClick={start}>Vergleich starten</button>
          <button disabled>Bericht</button>
        </>
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Vergleich starten" }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Bericht" })).toBeDisabled();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Flugplan, Flotte & Energie");
  expect(screen.getByText(/Keine reale Flug-OTP/)).toBeVisible();
});

it("uses real anchors, not a second simulation state machine", () => {
  render(<StudioWorkflowNav current="vergleich" />);
  expect(screen.getByRole("link", { name: /1.*Flugplan/ })).toHaveAttribute("href", "#coupled-flightplan");
  expect(screen.getByRole("link", { name: /4.*Vergleich/ })).toHaveAttribute("aria-current", "step");
});
