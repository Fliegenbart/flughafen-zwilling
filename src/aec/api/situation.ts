/** Lagebild des Verkehrstags aus dem Backend, sonst Beispieldaten. */
import { mergeWindows } from "../model/situation";
import { sampleSituation } from "../sample";
import type { Fleet, FleetKind, Project, Situation } from "../types";
import { request as call } from "./http";
import { enc, evidence, isObj, num, str } from "./parse";

/**
 * Minute nach Ortszeit des Flughafens (Europe/Berlin), gezaehlt ab dem Ortstag des
 * Lagebilds. Die API liefert UTC; Kaeufer lesen Flugwellen in Ortszeit.
 */
const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const localMinute = (t: number) => {
  const parts = Object.fromEntries(berlin.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
};
const minuteOf = (iso: string, dayStart: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localMinute(dayStart) + Math.round((t - dayStart) / 60000) : -1;
};
const inDay = (p: { minute: number }) => p.minute >= 0 && p.minute < 1440;

export function situationFromApi(project: Project, data: unknown): Situation | null {
  if (!isObj(data) || data.available !== true || !Array.isArray(data.series) || !data.series.length)
    return null;
  const series = data.series.filter(isObj);
  const dayStart = Date.parse(str(data.day_start_utc, str(series[0]!.start_utc)));
  if (!Number.isFinite(dayStart)) return null;
  const step = num(data.interval_min, 15);
  const limit =
    series.reduce((m, p) => Math.max(m, num(p.grid_limit_kw)), 0) || (project.gridLimitKw ?? 0);
  // Vor- und Nachlauf der Rechnung gehoeren nicht zum Verkehrstag; Fenster werden auf ihn gekuerzt.
  const windows = mergeWindows(
    (Array.isArray(data.bottleneck_windows) ? data.bottleneck_windows : [])
      .filter(isObj)
      .map((w) => ({
        start: Math.max(0, minuteOf(str(w.start_utc), dayStart)),
        end: Math.min(1440, minuteOf(str(w.end_utc), dayStart)),
        deficitKw: 0,
      }))
      .filter((w) => w.end > w.start),
  );
  return {
    projectId: project.id,
    source: "api",
    evidence: evidence(data.evidence_level, "model_checked"),
    kind: "bezug",
    gridLimitKw: limit,
    stepMinutes: step,
    load: series
      .map((p) => ({
        minute: minuteOf(str(p.start_utc), dayStart),
        demandKw: num(p.grid_import_kw),
        baseKw: Math.max(0, num(p.grid_import_kw) - num(p.charging_kw)),
        pvKw: num(p.pv_kw),
      }))
      .filter(inDay),
    departures: Array.isArray(data.departures)
      ? data.departures
          .filter(isObj)
          .map((d) => ({ minute: minuteOf(str(d.start_utc), dayStart), count: num(d.count) }))
          .filter(inDay)
      : [],
    windows,
    fleet: fleetFromApi(data.fleet),
  };
}

export function fleetFromApi(raw: unknown): Fleet | undefined {
  if (!isObj(raw)) return undefined;
  return {
    total: typeof raw.total_vehicles === "number" ? raw.total_vehicles : null,
    byKind: Array.isArray(raw.by_kind)
      ? raw.by_kind.filter(isObj).map((k) => ({
          kind: str(k.kind) as FleetKind,
          label: str(k.label, str(k.kind)),
          vehicles: num(k.vehicles),
          chargers: num(k.chargers),
        }))
      : [],
    source: typeof raw.source === "string" ? raw.source : null,
  };
}

export async function getSituation(project: Project): Promise<Situation> {
  if (project.source === "api") {
    try {
      const s = situationFromApi(
        project,
        await call<unknown>(`/projects/${enc(project.id)}/situation`),
      );
      if (s) return s;
    } catch {
      /* Beispieldaten */
    }
  }
  return sampleSituation(project);
}
