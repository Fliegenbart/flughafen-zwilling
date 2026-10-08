import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PilotStudio from "./PilotStudio";
import { pilotReport } from "./report";
import AccessGate from "./AccessGate";
const project = {
  id: "project-1",
  name: "Vorfeld-Pilot",
  decision: "Reicht der Anschluss?",
  scope: "Nur Vorfeld",
  acceptance_note: "Noch abstimmen",
};
const imported = {
  id: "import-1",
  filename: "synthetisches-beispiel.csv",
  role: "calibration" as const,
  measurement_boundary: "Demo",
  source_note: "Synthetisch",
  quality: { state: "valid" as const, rows: 4, issues: [], sha256: "abc", coverage_seconds: 180 },
  model_provenance: { model_column_status: "user_supplied_unverified", model_run_id: null },
};
const assessment = {
  id: "assessment-1",
  import_id: "import-1",
  validity_status: "NOT_EVALUABLE",
  thresholds: { mae_max_kw: 10, energy_error_max_pct: 5 },
  metrics: {
    time_weighted_mae_kw: 3,
    time_weighted_bias_kw: 1,
    energy_error_pct: 2,
    paired_coverage_seconds: 180,
  },
  not_evaluable_reasons: ["model_provenance_unverified"],
};
const lockedTolerances = {
  tolerances: { mae_max_kw: 10, energy_error_max_pct: 5, min_rows: 60, min_coverage_seconds: 3600 },
  sha256: "f".repeat(64),
  created_at: "2026-10-04T10:00:00+00:00",
  locked_at: "2026-10-04T10:00:00+00:00",
  locked: true,
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/pilot/projects"))
        return new Response(JSON.stringify(init?.method === "POST" ? project : [project]));
      if (path.endsWith("/imports"))
        return new Response(JSON.stringify(init?.method === "POST" ? imported : []));
      if (path.endsWith("/tolerances"))
        return new Response(init?.method === "PUT" ? JSON.stringify(lockedTolerances) : "null");
      if (path.endsWith("/assessments"))
        return new Response(JSON.stringify(init?.method === "POST" ? assessment : []));
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Pilot Decision Studio", () => {
  it("unlocks protected content only after a successful personal login", async () => {
    let loggedIn = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/auth/login")) {
        expect(init?.method).toBe("POST");
        loggedIn = true;
        return new Response(JSON.stringify({ authenticated: true }));
      }
      return new Response(
        JSON.stringify({
          enabled: true,
          authenticated: loggedIn,
          user: loggedIn ? "qa.operator" : null,
          role: loggedIn ? "operator" : null,
        }),
      );
    });
    render(
      <AccessGate>
        <div>Geschützter Pilot</div>
      </AccessGate>,
    );
    fireEvent.change(await screen.findByLabelText("Benutzername"), {
      target: { value: "qa.operator" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "test-fixture-only" } });
    expect(screen.queryByText("Geschützter Pilot")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("Geschützter Pilot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });
  it("loads projects, imports explicit synthetic evidence and freezes an honest assessment", async () => {
    render(<PilotStudio />);
    fireEvent.click(await screen.findByRole("button", { name: "Vorfeld-Pilot" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Testpaket herunterladen" })).toHaveAttribute(
        "href",
        expect.stringContaining("/project-1/package"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Synthetisches Beispiel laden" }));
    await screen.findByText("synthetisches-beispiel.csv");
    expect(screen.getByText("ausgedacht")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mit gesperrten Kriterien bewerten" }),
    ).toBeDisabled();
    const lock = screen.getByRole("button", { name: "Kriterien festlegen und sperren" });
    expect(lock).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Maximaler MAE (kW)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Maximaler absoluter Energiefehler (%)"), {
      target: { value: "5" },
    });
    fireEvent.click(lock);
    expect(await screen.findByText(/SHA256 der Kriterien/)).toBeInTheDocument();
    expect(screen.getByText("f".repeat(64))).toBeInTheDocument();
    const put = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith("/tolerances") && init?.method === "PUT",
      );
    expect(JSON.parse(String(put![1]!.body))).toMatchObject({ lock: true, min_rows: 60 });
    fireEvent.click(screen.getByRole("button", { name: "Mit gesperrten Kriterien bewerten" }));
    expect(await screen.findByText("NOT_EVALUABLE")).toBeInTheDocument();
    expect(screen.getByText(/Die Herkunft der Modellwerte/)).toBeInTheDocument();
  });
  it("blocks a holdout import until acceptance criteria are locked", async () => {
    render(<PilotStudio />);
    fireEvent.click(await screen.findByRole("button", { name: "Vorfeld-Pilot" }));
    await screen.findByRole("heading", { name: /Abnahmekriterien vorab festlegen und sperren/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Datensatz-Rolle" }), {
      target: { value: "holdout" },
    });
    expect(screen.getByText(/Holdout-Import gesperrt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Messdaten prüfen" })).toBeDisabled();
  });
  it("explains not-evaluable reasons in plain German", async () => {
    const { issueLabel } = await import("../shared/issues");
    for (const code of [
      "tolerances_not_frozen",
      "role_not_holdout",
      "insufficient_rows",
      "insufficient_coverage",
      "circular",
      "unit_suspect",
      "metric_overflow",
      "tolerances_set_after_import",
    ])
      expect(issueLabel(code)).not.toBe(code);
  });
  it("escapes user content in export and preserves evidence boundaries", () => {
    const html = pilotReport(
      { ...project, name: "<script>alert(1)</script>" },
      [imported],
      [assessment],
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("NOT_EVALUABLE");
    expect(html).toContain("Keine Anlagenfreigabe");
  });
  it("fails closed when access status cannot be loaded", async () => {
    render(
      <AccessGate>
        <div>Private Daten</div>
      </AccessGate>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Private Daten")).not.toBeInTheDocument();
  });
  it("shows local demo without login only when backend explicitly disables auth", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ enabled: false, authenticated: false, user: null })),
    );
    render(
      <AccessGate>
        <div>Private Daten</div>
      </AccessGate>,
    );
    expect(await screen.findByText("Private Daten")).toBeInTheDocument();
  });
});
