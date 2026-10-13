import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LabPage from "./LabPage";
import { NavContext } from "../context";
import { request } from "../api/http";
vi.mock("../api/http", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const run = {
  run_id: "abc",
  state: "completed",
  scenario_id: "coupled_demo",
  artifacts: ["/app/data/runs/abc/coupled-evidence.json"],
};
const source = {
  id: "source",
  filename: "messung.csv",
  role: "lab",
  quality: { state: "valid", rows: 1800, issues: [], sha256: "hash", coverage_seconds: 108000 },
  model_provenance: { model_column_status: "absent", model_run_id: null },
};
function mount(projectId = "beispiel-muc-sued") {
  return render(
    <NavContext.Provider
      value={{
        basePath: "/",
        route: { page: "lab", projekt: "beispiel-muc-sued" },
        navigate: vi.fn(),
      }}
    >
      <LabPage route={{ page: "lab", projekt: projectId }} />
    </NavContext.Provider>,
  );
}
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue([]);
});
describe("Messdaten-Abgleich", () => {
  it("zeigt vier Schritte ohne erfundene Auftraege", async () => {
    mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Simulation mit Messdaten überprüfen" }),
    ).toBeVisible();
    expect(await screen.findByText(/Noch keine gespeicherte gekoppelte Berechnung/)).toBeVisible();
    expect(screen.queryByText(/Ladepunkt 150 kW unter Spitzenwelle prüfen/)).toBeNull();
    expect(screen.queryByText(/Am Zug:/)).toBeNull();
  });
  it("ersetzt API-Fehler nicht durch Beispieldaten", async () => {
    api.mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("speichert Frage, friert Grenzen ein und bewertet nur serverseitigen Replay", async () => {
    api.mockImplementation(async (path, init) => {
      if (path === "/runs") return [run];
      if (path === "/runs/abc/record")
        return { status: run, scenario_snapshot: { domain: "airport_coupled_v1" } };
      if (path === "/runs/abc/safety")
        return {
          audit: {
            fingerprint_match: true,
            artifact_hashes_match: true,
            report_consistent_match: true,
            reports_hashed: true,
          },
        };
      if (path.includes("coupled-evidence.json"))
        return { day_start_utc: "2026-01-01T00:00:00Z", series: [{ minute: 1 }, { minute: 2 }] };
      if (path === "/pilot/projects" && init?.method === "POST")
        return {
          id: "p1",
          name: "Abgleich",
          decision: "Passt die Ladeleistung?",
          scope: "Trafo",
          acceptance_note: "measurement-workflow-v1:grid_import_kw",
        };
      if (path.endsWith("/tolerances"))
        return {
          locked: true,
          tolerances: {
            mae_max_kw: 10,
            energy_error_max_pct: 5,
            min_rows: 60,
            min_coverage_seconds: 3600,
          },
        };
      if (path.endsWith("/imports") && init?.method === "POST") return source;
      if (path.endsWith("/replays"))
        return {
          ...source,
          id: "replay",
          source_import_id: "source",
          model_provenance: { model_run_id: "abc" },
        };
      if (path.endsWith("/assessments") && init?.method === "POST")
        return {
          id: "a",
          import_id: "replay",
          validity_status: "NOT_EVALUABLE",
          evaluation_kind: "lab_diagnostic",
          metrics: {
            time_weighted_mae_kw: 3,
            time_weighted_bias_kw: -1,
            energy_error_pct: 2,
            paired_coverage_seconds: 3600,
          },
          not_evaluable_reasons: ["role_not_holdout"],
        };
      return [];
    });
    mount();
    await screen.findByRole("option", { name: /abc/ });
    fireEvent.change(screen.getByLabelText("Gespeicherte Berechnung"), {
      target: { value: "abc" },
    });
    await screen.findByText(/Integrität geprüft/);
    fireEvent.change(screen.getByLabelText("Ihre Prüffrage"), {
      target: { value: "Passt die Ladeleistung?" },
    });
    fireEvent.change(screen.getByLabelText("Messgrenze"), { target: { value: "Trafo" } });
    fireEvent.change(screen.getByLabelText("Maximaler mittlerer Fehler (kW)"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Maximaler Energiefehler (%)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prüffrage und Grenzen speichern" }));
    await waitFor(() => expect(screen.getByLabelText("CSV-Messdatei")).toBeEnabled());
    const f = new File(["timestamp,measured_kw\n"], "messung.csv");
    Object.defineProperty(f, "text", { value: async () => "timestamp,measured_kw\n" });
    fireEvent.change(screen.getByLabelText("CSV-Messdatei"), { target: { files: [f] } });
    fireEvent.change(screen.getByLabelText("Quelle und Messbedingungen"), {
      target: { value: "Nicht vertrauliche QA-Reihe" },
    });
    fireEvent.click(screen.getByLabelText(/Keine vertraulichen/));
    fireEvent.click(screen.getByRole("button", { name: "Messdaten importieren" }));
    await screen.findByText(/messung.csv/);
    fireEvent.click(screen.getByRole("button", { name: "Abweichungen berechnen" }));
    expect(await screen.findByText("Diagnose, kein Validierungsnachweis")).toBeVisible();
    expect(api).toHaveBeenCalledWith(
      "/pilot/projects/p1/replays",
      expect.objectContaining({
        body: JSON.stringify({ import_id: "source", run_id: "abc", metric: "grid_import_kw" }),
      }),
    );
    expect(api).toHaveBeenCalledWith(
      "/pilot/projects/p1/assessments",
      expect.objectContaining({ body: JSON.stringify({ import_id: "replay" }) }),
    );
    api.mockRejectedValueOnce(new Error("Bewertung fehlgeschlagen"));
    fireEvent.click(screen.getByRole("button", { name: "Abweichungen berechnen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bewertung fehlgeschlagen");
    expect(screen.queryByText("Diagnose, kein Validierungsnachweis")).toBeNull();
  });
  it("oeffnet die neueste Bewertung statt eines frueheren PASS", async () => {
    api.mockImplementation(async (path) => {
      if (path === "/runs") return [run];
      if (path === "/pilot/projects")
        return [
          {
            id: "p1",
            name: "Abgleich",
            decision: "Gespeicherte Frage",
            scope: "Trafo",
            acceptance_note: "measurement-workflow-v1:grid_import_kw",
          },
        ];
      if (path.endsWith("/links")) return [{ kind: "coupled_run", ref_id: "abc" }];
      if (path.endsWith("/imports"))
        return [
          source,
          { ...source, id: "old", source_import_id: "source" },
          { ...source, id: "new", source_import_id: "source" },
        ];
      if (path.endsWith("/tolerances"))
        return { locked: true, tolerances: { mae_max_kw: 10, energy_error_max_pct: 5 } };
      if (path.endsWith("/assessments"))
        return ["PASS", "FAIL"].map((s, i) => ({
          id: s,
          import_id: i ? "new" : "old",
          validity_status: s,
          evaluation_kind: "holdout",
          metrics: {},
          not_evaluable_reasons: [],
        }));
      if (path.endsWith("/record"))
        return { status: run, scenario_snapshot: { domain: "airport_coupled_v1" } };
      if (path.endsWith("/safety"))
        return {
          audit: {
            fingerprint_match: true,
            artifact_hashes_match: true,
            report_consistent_match: true,
            reports_hashed: true,
          },
        };
      return { day_start_utc: "2026-01-01T00:00:00Z", series: [{ minute: 1 }] };
    });
    mount("p1");
    expect(await screen.findByText("Vorab festgelegte Grenzen überschritten")).toBeVisible();
    expect(screen.queryByText("Vorab festgelegte Grenzen eingehalten")).toBeNull();
  });
});
