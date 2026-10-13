import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveScenario } from "./useLiveScenario";
import { SAMPLE_PROJECT } from "../sample";
import reference from "../model/__fixtures__/livePowerReference.json";

const payload = (id: string) => ({
  ...reference.basis,
  departures: reference.departures,
  kpis: reference.kpis,
  calculation_id: id,
  engine_version: "airport_coupled_v2",
  input_hash: "a".repeat(64),
  compute_ms: 100,
});
afterEach(() => vi.unstubAllGlobals());
describe("public demo real simulation", () => {
  it("calls backend for baseline and changed settings, never substitutes fixture", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload("baseline"))))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload("changed"))));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLiveScenario(SAMPLE_PROJECT));
    await waitFor(() => expect(result.current.accuracy).toBe("genau"));
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/demo/simulation"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.exact?.calculationId).toBe("baseline");
    act(() =>
      result.current.setLevers({ ...result.current.levers!, gridLimitKw: 2200, extraVehicles: 10 }),
    );
    expect(result.current.exact).toBeNull();
    await waitFor(() => expect(result.current.exact?.calculationId).toBe("changed"));
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(body.grid_import_limit_kw).toBe(2200);
    expect(Object.values(body.extra_vehicles).reduce((a: number, b) => a + Number(b), 0)).toBe(10);
    act(() => result.current.reset());
    expect(result.current.exact?.calculationId).toBe("baseline");
  });
  it("shows backend failure instead of illustrative results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useLiveScenario(SAMPLE_PROJECT));
    await waitFor(() => expect(result.current.accuracy).toBe("fehler"));
    expect(result.current.today).toBeNull();
    expect(result.current.error).toContain("offline");
  });
});
