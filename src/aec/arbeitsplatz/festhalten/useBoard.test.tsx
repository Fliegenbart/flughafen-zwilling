import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PROJECT } from "../../sample";
import type { Project, VariantBoard } from "../../types";
import { useBoard } from "./useBoard";

const mocks = vi.hoisted(() => ({ fetchVariantBoard: vi.fn() }));
vi.mock("../../api/variants", () => ({ fetchVariantBoard: mocks.fetchVariantBoard }));

const PROJECT: Project = { ...SAMPLE_PROJECT, id: "p1", source: "api" };

const board = (status: "running" | "completed", done = 1): VariantBoard => ({
  source: "api",
  base: {
    source: "x",
    policy: "uncontrolled",
    gridLimitKw: 3500,
    storageKwh: 0,
    fleet: { total: 1, byKind: [], source: null },
  },
  definitions: [{ id: "a", name: "Mehr Anschluss", changes: { grid_import_limit_kw: 4500 } }],
  run: {
    status,
    done,
    total: 3,
    stress: false,
    crisis: null,
    stale: false,
    inputsStale: false,
    createdAt: "",
  },
  variants: [],
  answer: null,
});

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchVariantBoard.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useBoard", () => {
  it("fragt nach, solange gerechnet wird, und hört danach auf", async () => {
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board("running", 1))
      .mockResolvedValueOnce(board("running", 2))
      .mockResolvedValue(board("completed", 3));
    const { result } = renderHook(() => useBoard(PROJECT));
    await tick(0);
    expect(result.current.running).toBe(true);
    await tick(1500);
    expect(result.current.board?.run?.done).toBe(2);
    await tick(1500);
    expect(result.current.running).toBe(false);
    await tick(10000);
    expect(mocks.fetchVariantBoard).toHaveBeenCalledTimes(3);
  });

  it("behält die letzte gute Tafel, wenn eine Abfrage scheitert, und fragt weiter", async () => {
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board("running"))
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue(board("completed", 3));
    const { result } = renderHook(() => useBoard(PROJECT));
    await tick(0);
    await tick(1500);
    expect(result.current.lost).toBe(true);
    expect(result.current.running).toBe(true);
    expect(result.current.board?.source).toBe("api");
    expect(result.current.board?.definitions).toHaveLength(1);
    await tick(1500);
    expect(result.current.lost).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.board?.run?.status).toBe("completed");
  });

  it("gibt nach fünf Fehlschlägen in Folge auf", async () => {
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board("running"))
      .mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() => useBoard(PROJECT));
    await tick(0);
    await tick(1500 * 5);
    expect(mocks.fetchVariantBoard).toHaveBeenCalledTimes(6);
    expect(result.current.running).toBe(false);
    expect(result.current.lost).toBe(true);
    await tick(10000);
    expect(mocks.fetchVariantBoard).toHaveBeenCalledTimes(6);
  });

  it("versucht eine gescheiterte erste Ladung noch einmal", async () => {
    mocks.fetchVariantBoard
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue(board("completed", 3));
    const { result } = renderHook(() => useBoard(PROJECT));
    await tick(0);
    expect(result.current.board).toBeNull();
    expect(result.current.lost).toBe(true);
    await tick(1500);
    expect(result.current.board?.definitions).toHaveLength(1);
    expect(result.current.lost).toBe(false);
  });

  it("fragt nicht erneut, solange eine Abfrage noch läuft", async () => {
    let finish: (b: VariantBoard) => void = () => undefined;
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board("running"))
      .mockReturnValueOnce(new Promise<VariantBoard>((resolve) => (finish = resolve)));
    renderHook(() => useBoard(PROJECT));
    await tick(0);
    await tick(1500);
    await tick(6000);
    expect(mocks.fetchVariantBoard).toHaveBeenCalledTimes(2);
    finish(board("running"));
  });

  it("lässt eine ältere Antwort eine neuere nicht überschreiben", async () => {
    const answers: ((b: VariantBoard) => void)[] = [];
    mocks.fetchVariantBoard.mockImplementation(
      () => new Promise<VariantBoard>((resolve) => answers.push(resolve)),
    );
    const { result } = renderHook(() => useBoard(PROJECT));
    await tick(0);
    void result.current.reload();
    await tick(0);
    expect(answers).toHaveLength(2);
    await act(async () => answers[1]!(board("completed", 3)));
    await act(async () => answers[0]!(board("running", 1)));
    expect(result.current.board?.run?.status).toBe("completed");
  });
});
