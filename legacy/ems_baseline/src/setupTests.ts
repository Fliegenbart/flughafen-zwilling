import "@testing-library/jest-dom";
import { vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver;

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  writable: true,
  value: vi.fn(() => ({
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
  })),
});

(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ status: "ok" }),
    text: () => Promise.resolve(JSON.stringify({ status: "ok" })),
  } as Response)
) as unknown as typeof fetch;
