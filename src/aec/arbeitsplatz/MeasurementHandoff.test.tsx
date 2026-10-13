import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../context";
import { previewFromApi } from "../api/preview";
import type { Levers } from "../model/livePower";
import reference from "../model/__fixtures__/livePowerReference.json";
import { parseRoute, toSearch } from "../routes";
import MeasurementHandoff from "./MeasurementHandoff";

const levers: Levers = {
  gridLimitKw: 2800,
  batteryKwh: 2000,
  batteryKw: 1000,
  pvFactor: 0.5,
  extraVehicles: 4,
};
const exact = previewFromApi({
  ...reference.basis,
  metadata: { config: { power: { grid_import_limit_kw: 2800 } } },
})!;

afterEach(() => vi.unstubAllGlobals());

function renderHandoff(props: Partial<ComponentProps<typeof MeasurementHandoff>> = {}) {
  const navigate = vi.fn();
  render(
    <NavContext.Provider
      value={{
        basePath: "/",
        route: { page: "arbeitsplatz", projekt: "beispiel-muc-sued" },
        navigate,
      }}
    >
      <MeasurementHandoff
        demo
        projectId="beispiel-muc-sued"
        exact={exact}
        levers={levers}
        exactCurrent
        question="Hält die Ladeleistung im morgendlichen Fenster?"
        {...props}
      />
    </NavContext.Provider>,
  );
  return { navigate };
}

describe("MeasurementHandoff", () => {
  it("bewahrt die optionale Run-Adresse des Prüfbereichs", () => {
    const route = { page: "lab", projekt: "beispiel-muc-sued", run: "run-9" } as const;
    expect(toSearch(route)).toBe("?seite=lab&projekt=beispiel-muc-sued&run=run-9");
    expect(parseRoute(toSearch(route))).toEqual(route);
  });

  it("gibt den Start nur für die aktuelle präzise Vorschau frei", () => {
    renderHandoff({ exact: null });
    expect(screen.getByRole("button", { name: "Mit Messdaten überprüfen" })).toBeDisabled();
  });

  it("materialisiert genau einen Lauf, speichert die Frage und navigiert nach Abschluss", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { setItem });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ run_id: "run-7", state: "queued" }), { status: 202 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ run_id: "run-7", state: "completed" })),
        ),
    );
    const { navigate } = renderHandoff();

    fireEvent.click(screen.getByRole("button", { name: "Mit Messdaten überprüfen" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        page: "lab",
        projekt: "beispiel-muc-sued",
        run: "run-7",
      }),
    );
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/v1/demo/simulation/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      grid_import_limit_kw: 2800,
      storage_kwh: 2000,
      storage_kw: 1000,
      pv_factor: 0.5,
      extra_vehicles: expect.any(Object),
    });
    expect(setItem).toHaveBeenCalledWith(
      "aec.measurement-question.run-7",
      "Hält die Ladeleistung im morgendlichen Fenster?",
    );
  });

  it("meldet einen fehlgeschlagenen Lauf und prüft beim Retry nur denselben Run", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ run_id: "run-8", state: "queued" }), { status: 202 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ run_id: "run-8", state: "failed", error: "queue_failed" })),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ run_id: "run-8", state: "completed" })),
        ),
    );
    const { navigate } = renderHandoff();

    fireEvent.click(screen.getByRole("button", { name: "Mit Messdaten überprüfen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("queue_failed");
    fireEvent.click(screen.getByRole("button", { name: "Status erneut prüfen" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        page: "lab",
        projekt: "beispiel-muc-sued",
        run: "run-8",
      }),
    );
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([url]) => String(url).includes("/demo/simulation/runs"))).toHaveLength(1);
  });
});
