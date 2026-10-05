import type { Bench, Criteria } from "./types";

export function restoreConfig<T extends object>(key: string, defaults: T): T {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Record<
      string,
      unknown
    > | null;
    if (!stored || typeof stored !== "object") return defaults;
    const entries = Object.entries(defaults).map(([name, value]) => {
      const candidate = stored[name];
      return [
        name,
        typeof candidate === typeof value &&
        (typeof candidate !== "number" || Number.isFinite(candidate))
          ? candidate
          : value,
      ];
    });
    return Object.fromEntries(entries) as T;
  } catch {
    return defaults;
  }
}

export function configError(bench: Bench | null, criteria: Criteria | null): string | null {
  if (!bench || !criteria) return null;
  if (!bench.name.trim()) return "Prüfstandbezeichnung darf nicht leer sein.";
  const bounds: [string, number, number, number][] = [
    ["Nennleistung", bench.max_power_kw, 0.01, 10000],
    ["Anschlusslimit", bench.grid_limit_kw, 0.01, 10000],
    ["Einspeise-Untergrenze", bench.min_power_kw, -10000, 0],
    ["Leistungsrampe", bench.ramp_kw_per_s, 0.01, 10000],
    ["Antwortverzögerung", bench.response_delay_s, 0, 120],
    ["Messrauschen", bench.noise_kw, 0, 5],
    ["Toleranz", criteria.tolerance_kw, 0, 100],
    ["Sollabweichung", criteria.tracking_mae_max_kw, 0, 100],
    ["Reaktionszeit", criteria.response_max_s, 0.01, 300],
    ["Stabilitätsfenster", criteria.settling_s, 0.01, 60],
    ["Einschwingfrist", criteria.grace_s, 0, 300],
    ["Limitverletzungsbudget", criteria.limit_violation_budget_s, 0, 300],
    ["Min. Abdeckung", criteria.min_coverage_pct, 90, 100],
    ["Messintervall", criteria.expected_interval_s, 0.01, 1000],
    ["Zeitlücke", criteria.max_gap_s, 0.01, 300],
  ];
  const bad = bounds.find(
    ([, value, min, max]) => !Number.isFinite(value) || value < min || value > max,
  );
  if (bad) return `${bad[0]} muss zwischen ${bad[2]} und ${bad[3]} liegen.`;
  if (!Number.isInteger(bench.response_delay_s))
    return "Antwortverzögerung muss eine ganze Sekundenzahl sein.";
  if (criteria.max_gap_s < criteria.expected_interval_s)
    return "Maximale Zeitlücke muss mindestens dem Messintervall entsprechen.";
  if (criteria.max_gap_s > 10 * criteria.expected_interval_s)
    return "Maximale Zeitlücke darf höchstens das 10-fache des Messintervalls betragen.";
  return null;
}
