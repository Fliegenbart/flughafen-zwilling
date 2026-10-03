import { apiBase } from "../lab/api";
import type { ChartRow } from "./types";

export const url = (path: string) => `${apiBase()}/api/v1${path}`;

async function bounded<T>(
  path: string,
  init: RequestInit | undefined,
  read: (r: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(url(path), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { detail?: unknown };
      const detail = typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail);
      throw new Error(detail || `API-Fehler ${response.status}`);
    }
    return await read(response);
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abort);
  }
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  return bounded<T>(path, init, async (response) => (await response.json()) as T);
}

export async function telemetry(runId: string, signal: AbortSignal): Promise<ChartRow[]> {
  return bounded(`/runs/${runId}/telemetry`, { signal }, async (response) =>
    parseTelemetry(await response.text()),
  );
}

export function parseTelemetry(jsonl: string): ChartRow[] {
  const rows = new Map<number, ChartRow>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as { ts: number; metric: string; value: number };
    if (
      !Number.isFinite(item.ts) ||
      !Number.isFinite(item.value) ||
      !/^[a-z][a-z0-9_]{0,64}$/.test(item.metric)
    )
      throw new Error("Ungültige Telemetrie");
    const minute = item.ts / 60000;
    const row = rows.get(minute) ?? { minute };
    row[item.metric] = item.value;
    rows.set(minute, row);
  }
  return [...rows.values()].sort((a, b) => a.minute - b.minute);
}
