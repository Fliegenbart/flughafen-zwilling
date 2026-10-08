/** Basis-URL der API aus der Runtime-Konfiguration (public/runtime-config.js). */
export function apiBase(): string {
  return (globalThis.__TWIN_CONFIG__?.apiBaseUrl || "").replace(/\/$/, "");
}
