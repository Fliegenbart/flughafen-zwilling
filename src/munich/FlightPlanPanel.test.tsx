import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlightPlanPanel from "./FlightPlanPanel";
import { plan } from "./__fixtures__/flightplan";

describe("Manueller MUC-Flugplan", () => {
  afterEach(() => vi.clearAllMocks());

  it("imports only after explicit submission and preserves the provenance", async () => {
    const onSelect = vi.fn();
    vi.mocked(fetch).mockImplementation(
      async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? plan : [])),
    );
    render(<FlightPlanPanel selected={null} onSelect={onSelect} />);
    await screen.findByRole("heading", { name: "Münchner Flugplan" });
    fireEvent.change(screen.getByLabelText("Verkehrstag"), { target: { value: "2026-10-03" } });
    const file = new File(["%PDF-mini"], "flightplan.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Saisonflugplan-PDF"), { target: { files: [file] } });
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "PDF importieren" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(plan));
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(call[0])).toContain("service_date=2026-10-03");
    expect(call[1]?.body).toBe(file);
    expect(call[1]?.headers).toMatchObject({ "Content-Type": "application/pdf" });
  });

  it("shows the selected day, hourly distribution, filtering and exports", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([plan])));
    render(<FlightPlanPanel selected={plan} onSelect={vi.fn()} />);
    expect(screen.getByText("XY101")).toBeVisible();
    expect(screen.getByText("XY102")).toBeVisible();
    expect(screen.getByText(/Datenstand: 02.10.2026/)).toBeVisible();
    expect(screen.getByRole("img", { name: /Geplante Flugplaneinträge pro Stunde/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Flugplan CSV" })).toHaveAttribute(
      "href",
      `/api/v1/munich/flight-plans/${plan.snapshot_id}/export.csv`,
    );
    expect(screen.getByText(/ändert noch keine Ladebedarfe/)).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Flugrichtung" }), {
      target: { value: "departure" },
    });
    expect(screen.queryByText("XY101")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Flüge suchen" }), {
      target: { value: "not-a-flight" },
    });
    expect(screen.getByText("Keine passenden Einträge.")).toBeVisible();
  });

  it("surfaces a rejected PDF without switching to fabricated data", async () => {
    const onSelect = vi.fn();
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ detail: "Unbekanntes Flugplan-Format" }), { status: 422 })
        : new Response("[]"),
    );
    render(<FlightPlanPanel selected={null} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Saisonflugplan-PDF"), {
      target: { files: [new File(["%PDF-mini"], "broken.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "PDF importieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unbekanntes Flugplan-Format");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "PDF importieren" })).toBeEnabled();
  });

  it("selects a stored snapshot explicitly and permits no plan for legacy comparisons", async () => {
    const onSelect = vi.fn();
    vi.mocked(fetch).mockImplementation(
      async (path) =>
        new Response(JSON.stringify(String(path).endsWith(plan.snapshot_id) ? plan : [plan])),
    );
    render(<FlightPlanPanel selected={null} onSelect={onSelect} />);
    await screen.findByRole("option", { name: /03.10.2026/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Gespeicherter Flugplantag" }), {
      target: { value: plan.snapshot_id },
    });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(plan));
    fireEvent.change(screen.getByRole("combobox", { name: "Gespeicherter Flugplantag" }), {
      target: { value: "" },
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
