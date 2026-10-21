import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("keeps its timeout when the caller supplies an abort signal", async () => {
    vi.useFakeTimers();
    let forwarded: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        forwarded = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) =>
          forwarded?.addEventListener("abort", () => reject(new Error("timeout-abort"))),
        );
      }),
    );
    const external = new AbortController();
    const pending = request("/timeout", { signal: external.signal }, { timeoutMs: 25 });

    await Promise.resolve();
    expect(forwarded).not.toBe(external.signal);
    const rejection = expect(pending).rejects.toThrow("timeout-abort");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(forwarded?.aborted).toBe(true);
  });
});
