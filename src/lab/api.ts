import { apiBase } from "../shared/runtimeConfig";

export { apiBase };

export function labUrl(path: string): string {
  return `${apiBase()}/api/v1/lab${path}`;
}

export async function labRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(labUrl(path), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg: string; loc: string[] }[];
      };
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : data.detail?.map((e) => `${e.loc.join(".")}: ${e.msg}`).join("; ");
      throw new Error(detail || `API antwortet mit ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abort);
  }
}
