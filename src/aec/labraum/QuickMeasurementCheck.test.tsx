import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import QuickMeasurementCheck from "./QuickMeasurementCheck";
import LabPage from "./LabPage";
import { request } from "../api/http";
import { NavContext } from "../context";
import { exportCsv, type MeasurementProfile } from "./measurementData";

vi.mock("../api/http", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const profile: MeasurementProfile = {
  run_id: "abc",
  metric: "grid_import_kw",
  unit: "kW",
  interval_seconds: 60,
  sample_semantics: "interval_end_mean",
  evidence_level: "model_checked",
  provenance: { artifact_sha256: "abc123" },
  points: Array.from({ length: 60 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i + 1)).toISOString(),
    model_kw: 100,
  })),
};
function mount() {
  return render(
    <NavContext.Provider
      value={{
        basePath: "/",
        route: { page: "lab", projekt: "demo", run: "abc" },
        navigate: vi.fn(),
      }}
    >
      <QuickMeasurementCheck initialRun="abc" />
    </NavContext.Provider>,
  );
}
function file(text: string) {
  const f = new File([text], "test.csv", { type: "text/csv" });
  Object.defineProperty(f, "arrayBuffer", {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  return f;
}
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(profile);
});
it("bietet Downloads und vergleicht echte Dateiinhalte ohne Upload oder PASS", async () => {
  mount();
  expect(await screen.findByRole("button", { name: "Lastprofil herunterladen" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("CSV-Messdatei auswählen"), {
    target: { files: [file(exportCsv(profile, "exercise"))] },
  });
  await screen.findByText(/test.csv · 60/);
  fireEvent.click(screen.getByLabelText(/Gleiche Messgrenze/));
  fireEvent.click(screen.getByRole("button", { name: "Messdaten vergleichen" }));
  expect(
    await screen.findByRole("heading", { name: "Übungsvergleich, keine echten Messdaten" }),
  ).toBeVisible();
  expect(screen.getByText("6 kW")).toBeVisible();
  expect(screen.queryByText(/^PASS$/)).toBeNull();
  expect(api.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  fireEvent.change(screen.getByLabelText("CSV-Messdatei auswählen"), {
    target: { files: [file("bad,csv\n1,2")] },
  });
  expect(screen.queryByText("6 kW")).toBeNull();
  expect(await screen.findByRole("alert")).toHaveTextContent("timestamp,measured_kw");
});
it("zeigt bei API-Fehlern keine Ersatzprofile und erlaubt erneutes Laden", async () => {
  api.mockRejectedValueOnce(new Error("Nachweis nicht verifiziert"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Nachweis nicht verifiziert");
  expect(screen.queryByRole("button", { name: "Lastprofil herunterladen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Profil erneut laden" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Lastprofil herunterladen" })).toBeEnabled(),
  );
});
it("verwirft Messung und Ergebnis beim Wechsel der Vergleichsgröße", async () => {
  mount();
  await screen.findByRole("button", { name: "Lastprofil herunterladen" });
  fireEvent.change(screen.getByLabelText("CSV-Messdatei auswählen"), {
    target: { files: [file(exportCsv(profile, "exercise"))] },
  });
  await screen.findByText(/test.csv · 60/);
  fireEvent.change(screen.getByLabelText("Vergleichsgröße"), {
    target: { value: "ground_charging_kw" },
  });
  expect(screen.queryByText(/test.csv · 60/)).toBeNull();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/runs/abc/measurement-profile?metric=ground_charging_kw",
      expect.anything(),
    ),
  );
});

it("beendet den Ladestatus beim Abwaehlen eines noch ladenden Profils", async () => {
  api.mockImplementation(async (path) =>
    path === "/runs"
      ? [{ run_id: "abc", state: "completed", artifacts: ["coupled-evidence.json"] }]
      : new Promise(() => {}),
  );
  render(
    <NavContext.Provider
      value={{ basePath: "/", route: { page: "lab", projekt: "demo" }, navigate: vi.fn() }}
    >
      <QuickMeasurementCheck />
    </NavContext.Provider>,
  );
  await screen.findByRole("option", { name: /abc/ });
  fireEvent.change(screen.getByLabelText("Gespeicherte Simulation"), { target: { value: "abc" } });
  await screen.findByText("Simulationsnachweis wird geprüft …");
  fireEvent.change(screen.getByLabelText("Gespeicherte Simulation"), { target: { value: "" } });
  expect(screen.queryByText("Simulationsnachweis wird geprüft …")).toBeNull();
});

it("behaelt den formalen Arbeitsstand beim Zuklappen", async () => {
  api.mockResolvedValue([]);
  render(
    <NavContext.Provider
      value={{ basePath: "/", route: { page: "lab", projekt: "demo" }, navigate: vi.fn() }}
    >
      <LabPage route={{ page: "lab", projekt: "demo" }} />
    </NavContext.Provider>,
  );
  const summary = screen.getByText(
    "Formalen Nachweis mit Prüfkriterien und gespeicherten Daten führen",
  );
  fireEvent.click(summary);
  const question = await screen.findByLabelText("Ihre Prüffrage");
  fireEvent.change(question, { target: { value: "Meine offene Frage" } });
  fireEvent.click(summary);
  await waitFor(() => expect(question).not.toBeVisible());
  fireEvent.click(summary);
  await waitFor(() =>
    expect(screen.getByLabelText("Ihre Prüffrage")).toHaveValue("Meine offene Frage"),
  );
});

it("entfernt den alten nativen Dateinamen nach Drag-and-drop", async () => {
  mount();
  await screen.findByRole("button", { name: "Lastprofil herunterladen" });
  const input = screen.getByLabelText("CSV-Messdatei auswählen") as HTMLInputElement;
  Object.defineProperty(input, "value", { value: "C:\\fakepath\\alte-datei.csv", writable: true });
  fireEvent.drop(input.closest("label")!, {
    dataTransfer: { files: [file(exportCsv(profile, "exercise"))] },
  });
  await screen.findByText(/test.csv · 60/);
  expect(input.value).toBe("");
});
