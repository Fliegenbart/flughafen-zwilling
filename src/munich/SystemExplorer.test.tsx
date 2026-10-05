import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import SystemExplorer from "./SystemExplorer";
import { config } from "./__fixtures__/coupledConfig";
import { plan } from "./__fixtures__/flightplan";
import type { FlightPlanSnapshot } from "./flightplanTypes";
import type { CoupledConfig, CoupledRecord } from "./coupledTypes";

const hash = "a".repeat(64);
const records = (["uncontrolled", "mission_priority"] as const).map(
  (policy, index): CoupledRecord => ({
    status: {
      run_id: String(index + 1).repeat(32),
      state: "completed",
      progress: 100,
      error: null,
      pass_fail: false,
    },
    request: { seed: 42, realtime_mode: "sil", adapters: [] },
    model_pack_snapshot: {
      parameter_set: { policy },
      calibration_meta: {
        flight_plan_snapshot: plan,
        coupled_world: {
          engine_version: "airport_coupled_v1",
          seed: 42,
          world_hash: hash,
          source_plan_sha256: plan.content_sha256,
          config,
          day_start_utc: "2026-10-02T22:00:00+00:00",
          day_minutes: 1440,
          start_min: -120,
          end_min: 1680,
          warnings: ["Nicht kalibriert"],
        },
      },
    },
    build_meta: {},
    summary: {
      domain: "airport_coupled_v1",
      energy_world_hash: hash,
      audit_fingerprint_sha256: hash,
      coupled_kpis: {
        evidence_level: "schedule_driven_assumptions_uncalibrated",
        published_entry_count: 2,
        mission_count: 6,
        missions_completed: 5,
        missions_on_time: 4,
        missions_uncompleted: 1,
        mission_on_time_pct: 80,
        completed_mission_delay_avg_min: 5,
        modeled_departure_count: 2,
        departures_ready_on_time: 1,
        departure_readiness_pct: 50,
        departure_deadline_violation_lower_bound_avg_min: 10,
        departures_uncompleted: 1,
        energy_wait_total_min: 18,
        resource_wait_total_min: 4,
        fleet_initial_kwh: 300,
        fleet_final_kwh: 290,
        fleet_charged_kwh: 40,
        fleet_consumed_kwh: 50,
        fleet_energy_balance_error_kwh: 0,
        fleet_reserve_violations: 1,
        transformer_loss_kwh: 2,
        model_horizon_hours: 30,
      },
      energy_kpis: {
        evidence_level: "synthetic_uncalibrated",
        model_hours: 30,
        grid_peak_kw: 3210,
        grid_import_kwh: 1,
        grid_export_kwh: 0,
        background_unserved_kwh: 0,
        charging_requested_kwh: 1,
        charging_delivered_kwh: 1,
        charging_unmet_kwh: 3,
        charging_loss_kwh: 0,
        bus_ready_count: 0,
        bus_session_count: 0,
        parking_ready_count: 199,
        parking_session_count: 200,
        pv_generated_kwh: 1,
        pv_used_kwh: 1,
        pv_export_kwh: 0,
        pv_curtailed_kwh: 0,
        chp_generated_kwh: 1,
        chp_unabsorbed_kwh: 0,
        battery_initial_kwh: 0,
        battery_final_kwh: 0,
        battery_charge_kwh: 0,
        battery_discharge_kwh: 0,
        battery_loss_kwh: 0,
        balance_error_max_kw: 0,
      },
    },
  }),
);

function Explorer({
  onSetConfig = vi.fn(),
  selectedPlan = plan,
}: {
  onSetConfig?: (value: CoupledConfig) => void;
  selectedPlan?: FlightPlanSnapshot | null;
}) {
  const [draft, setDraft] = useState(config);
  return (
    <SystemExplorer
      config={draft}
      setConfig={(next) => {
        setDraft(next);
        onSetConfig(next);
      }}
      plan={selectedPlan}
      records={records}
      startControlId="coupled-start"
    />
  );
}

describe("SystemExplorer", () => {
  it("selects a component and describes only a qualitative model path", () => {
    render(<Explorer />);

    fireEvent.click(screen.getByRole("button", { name: /netzanschluss untersuchen/i }));

    expect(screen.getByRole("heading", { name: "Netzanschluss" })).toBeVisible();
    expect(screen.getByText(/möglicher Wirkungspfad im Modell/i)).toBeVisible();
    expect(screen.getByText(/keine berechnete Wirkung/i)).toBeVisible();
  });

  it("switches from the system map to the technical energy flow", () => {
    render(<Explorer />);
    const grid = screen.getByRole("button", { name: /netzanschluss untersuchen/i });
    const mapPosition = grid.getAttribute("style");

    fireEvent.click(screen.getByRole("tab", { name: /energiefluss/i }));

    expect(screen.getByRole("tab", { name: /energiefluss/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("region", { name: /technische energieflussgrafik/i })).toBeVisible();
    expect(grid.getAttribute("style")).not.toBe(mapPosition);
  });

  it("writes inspector changes to the live coupled configuration", () => {
    const setConfig = vi.fn();
    render(<Explorer onSetConfig={setConfig} />);

    fireEvent.click(screen.getByRole("button", { name: /netzanschluss untersuchen/i }));
    fireEvent.change(screen.getByLabelText(/netzimportgrenze/i), { target: { value: "3200" } });

    expect(setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        power: expect.objectContaining({ grid_import_limit_kw: 3200 }),
      }),
    );
    expect(screen.getByText(/entwurf geändert/i)).toBeVisible();
  });

  it("keeps audited simulation outputs visibly frozen after a draft change", () => {
    render(<Explorer />);

    fireEvent.click(screen.getByRole("button", { name: /netzanschluss untersuchen/i }));
    fireEvent.change(screen.getByLabelText(/netzimportgrenze/i), { target: { value: "3200" } });

    const record = screen.getByRole("region", { name: /eingefrorener simulationsnachweis/i });
    expect(within(record).getByText("50 %")).toBeVisible();
    expect(
      within(record).getByText(/aktuelle entwurfswerte ändern diese nachweise nicht/i),
    ).toBeVisible();
    expect(screen.getByText(/keine empirische validierung/i)).toBeVisible();
  });

  it("marks frozen outputs as a different context when no current plan is selected", () => {
    render(<Explorer selectedPlan={null} />);

    const record = screen.getByRole("region", { name: /eingefrorener simulationsnachweis/i });
    expect(within(record).getByText(/verkehrstag/i)).toBeVisible();
    expect(within(record).getByText(/run 11111111/i)).toBeVisible();
    expect(within(record).getByText(/aktueller flugplan fehlt/i)).toBeVisible();
    expect(
      within(screen.getByRole("button", { name: /flugplan untersuchen/i })).getByText(
        /nachweisplan/i,
      ),
    ).toBeVisible();
  });

  it("keeps the graphic in a labelled horizontal scroll region on narrow screens", () => {
    render(<Explorer />);

    expect(screen.getByRole("region", { name: /interaktive systemgrafik/i })).toHaveClass(
      "system-explorer__diagram-scroll",
    );
  });
  it("connects the repositioned components in each layout", () => {
    const { container } = render(<Explorer />);
    const before = Array.from(container.querySelectorAll("svg.system-explorer__edges path:not(.system-explorer__flow)"), (p) =>
      p.getAttribute("d"),
    );
    fireEvent.click(screen.getByRole("tab", { name: /energiefluss/i }));
    const after = Array.from(container.querySelectorAll("svg.system-explorer__edges path:not(.system-explorer__flow)"), (p) =>
      p.getAttribute("d"),
    );
    expect(before).toHaveLength(12);
    expect(after).toHaveLength(12);
    expect(after).not.toEqual(before);
    expect(container.querySelector("svg.system-explorer__edges")).toHaveAttribute(
      "preserveAspectRatio",
      "none",
    );
  });
});
