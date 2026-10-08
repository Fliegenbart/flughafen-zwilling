/** Genaue Vorschau eines Tages fuer eine Regler-Stellung (POST /situation/preview). */
import { distributeFleet } from "../model/dataStatus";
import { FLEET_LABEL } from "../model/fleet";
import { isPolicy, type ChargingPolicy } from "../model/policy";
import type { LiveBasis, Levers } from "../model/livePower";
import type { FleetKind, Project, VariantChanges } from "../types";
import { fleetFromApi } from "./fleet";
import { explain, modelLimit, request, type ApiError } from "./http";
import { enc, isObj, num, str } from "./parse";

export type DepartureBin = { startMin: number; count: number; delayed: number };

export type Preview = {
  basis: LiveBasis;
  /** Fahrzeuge der Flotte je Art (die Klassen der Basis kennen ihre Art nicht). */
  vehiclesByKind: Partial<Record<FleetKind, number>>;
  departures: DepartureBin[];
  delayedDepartures: number | null;
  departuresTotal: number | null;
  /** Anteil der Wartezeit, die am Strom lag (Rest: kein freies Fahrzeug). */
  energyWaitSharePct: number | null;
  /** Laderegel, mit der gerechnet wurde. */
  policy: ChargingPolicy | null;
  /** Verbrauch des uebrigen Flughafens, den der Anschluss nicht mehr deckte. */
  backgroundUnservedKwh: number | null;
  computeMs: number | null;
  /** Krisenfall, unter dem gerechnet wurde, samt Annahme (Wortlaut vom Backend). */
  crisis: { id: string; name: string; assumption: string } | null;
};

const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(x)) : []);

/** Ist das eine der vier Fahrzeugarten? (`in` liesse auch Namen wie "constructor" durch.) */
export const isFleetKind = (v: unknown): v is FleetKind =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(FLEET_LABEL, v);

/** Fahrzeuge je Art aus dem Flottenblock; die Obergrenze der Fahrzeugregler haengt daran. */
function vehiclesByKind(raw: unknown): Partial<Record<FleetKind, number>> {
  const out: Partial<Record<FleetKind, number>> = {};
  if (isObj(raw) && Array.isArray(raw.classes))
    for (const c of raw.classes.filter(isObj))
      if (isFleetKind(c.kind)) out[c.kind] = num(c.vehicles);
  return out;
}

/** Antwort der Vorschau (oder der Beispiel-Referenz) in die Browser-Form bringen. */
export function previewFromApi(raw: unknown, departuresRaw?: unknown): Preview | null {
  if (!isObj(raw) || !Array.isArray(raw.requested_kw) || !isObj(raw.power)) return null;
  const p = raw.power;
  const fleet = fleetFromApi(raw.fleet);
  if (!fleet) return null;
  const kpis = isObj(raw.kpis) ? raw.kpis : {};
  const deps = Array.isArray(raw.departures)
    ? raw.departures
    : Array.isArray(departuresRaw)
      ? departuresRaw
      : [];
  return {
    vehiclesByKind: vehiclesByKind(raw.fleet),
    basis: {
      dayMinutes: num(raw.day_minutes, 1440),
      startMin: num(raw.start_min),
      requestedKw: nums(raw.requested_kw),
      deliveredKw: nums(raw.delivered_kw),
      backgroundKw: nums(raw.background_kw),
      pvKw: nums(raw.pv_kw),
      chpKw: nums(raw.chp_kw),
      gridCapKw: nums(raw.grid_cap_kw),
      gridImportKw: nums(raw.grid_import_kw),
      batteryKw: nums(raw.battery_kw),
      fleet,
      power: {
        gridImportLimitKw: num(p.grid_import_limit_kw),
        pvCapacityKwp: num(p.pv_capacity_kwp),
        batteryCapacityKwh: num(p.battery_capacity_kwh),
        batteryPowerKw: num(p.battery_power_kw),
        batteryInitialSocPct: num(p.battery_initial_soc_pct, 50),
        batteryReservePct: num(p.battery_reserve_pct, 10),
        batteryEfficiency: num(p.battery_efficiency, 0.95),
        batteryGridChargeBelowKw:
          typeof p.battery_grid_charge_below_kw === "number"
            ? p.battery_grid_charge_below_kw
            : null,
        transformerEfficiency: num(p.transformer_efficiency, 0.98),
        apronLimitKw: num(p.apron_limit_kw, 1e9),
        parkingLimitKw: num(p.parking_limit_kw, 1e9),
      },
    },
    departures: deps.filter(isObj).map((d) => ({
      startMin: num(d.start_min),
      count: num(d.count),
      delayed: num(d.delayed),
    })),
    delayedDepartures: typeof kpis.delayed_departures === "number" ? kpis.delayed_departures : null,
    departuresTotal: typeof kpis.departures_total === "number" ? kpis.departures_total : null,
    energyWaitSharePct:
      typeof kpis.energy_wait_share_pct === "number" ? kpis.energy_wait_share_pct : null,
    policy: isPolicy(raw.policy) ? raw.policy : null,
    backgroundUnservedKwh:
      typeof kpis.background_unserved_kwh === "number" ? kpis.background_unserved_kwh : null,
    computeMs: typeof raw.compute_ms === "number" ? raw.compute_ms : null,
    crisis:
      isObj(raw.crisis) && typeof raw.crisis.id === "string"
        ? { id: raw.crisis.id, name: str(raw.crisis.name), assumption: str(raw.crisis.assumption) }
        : null,
  };
}

/** Was die Vorschau schickt: Aenderungen gegenueber heute plus Krisenfall. */
export type PreviewBody = Record<string, number | string | Record<string, number>>;

/** Regler-Stellung als Aenderung gegenueber heute (nur was sich unterscheidet). */
export function changesFor(levers: Levers, today: Levers): Record<string, number> {
  const out: Record<string, number> = {};
  if (Math.abs(levers.gridLimitKw - today.gridLimitKw) > 0.5)
    out.grid_import_limit_kw = Math.round(levers.gridLimitKw);
  if (levers.batteryKwh > 0 && levers.batteryKwh !== today.batteryKwh) {
    out.storage_kwh = Math.round(levers.batteryKwh);
    out.storage_kw = Math.round(levers.batteryKw ?? levers.batteryKwh / 2);
  }
  if (Math.abs(levers.pvFactor - 1) > 1e-3) out.pv_factor = Math.round(levers.pvFactor * 100) / 100;
  return out;
}

/** Zusaetzliche Fahrzeuge je Klasse: eine gewaehlte Art, sonst im Verhaeltnis der Standardflotte. */
export function extraVehiclesFor(levers: Levers): Record<string, number> | undefined {
  if (!levers.extraVehicles) return undefined;
  if (levers.extraKind) return { [levers.extraKind]: Math.round(levers.extraVehicles) };
  const parts = distributeFleet(levers.extraVehicles).filter((f) => f.vehicles > 0);
  return Object.fromEntries(parts.map((f) => [f.kind, f.vehicles]));
}

/** Alles, was sich gegenueber heute geaendert hat, ohne Krisenfall (der gilt je Rechnung). */
export function variantChangesFor(levers: Levers, today: Levers): VariantChanges | null {
  const extra = extraVehiclesFor(levers);
  const changes = {
    ...changesFor(levers, today),
    ...(extra ? { extra_vehicles: extra } : {}),
    ...(levers.policy && levers.policy !== today.policy ? { charging_policy: levers.policy } : {}),
  } as VariantChanges;
  return Object.keys(changes).length ? changes : null;
}

/** Anfrage der Vorschau: Aenderungen gegenueber heute plus gewaehlter Krisenfall. */
export function previewBodyFor(levers: Levers, today: Levers) {
  return {
    ...(variantChangesFor(levers, today) ?? {}),
    ...(levers.crisis ? { crisis: levers.crisis } : {}),
  } as PreviewBody;
}

/** Meldungen der Vorschau in Kaeufersprache; was hier fehlt, geht durch die allgemeinen Saetze. */
export function previewError(detail: string): string {
  const d = detail.trim();
  if (d.startsWith("no_base")) return "Der Tag lässt sich ohne Flugplan nicht rechnen.";
  if (d.startsWith("invalid_assets")) {
    const reason = d
      .replace(/^invalid_assets: (Projektwerte passen nicht zur Basis: )?/, "")
      .replace(/\.$/, "");
    // Die Grenzen des Modells kommen als ganzer Satz, andere Gruende als Bruchstueck.
    const joined = /^Das Modell /.test(reason) ? `. ${reason}` : ` (${reason})`;
    return `Ihre Projektwerte passen nicht zusammen${reason ? joined : ""}. Korrigieren Sie sie unter „Daten“.`;
  }
  if (d.startsWith("invalid_variant")) {
    const limit = modelLimit(d);
    if (limit) return limit;
    const kind = /Fahrzeugklasse (\w+)/.exec(d)?.[1];
    return isFleetKind(kind)
      ? `${FLEET_LABEL[kind]} lassen sich in diesem Projekt nicht ergänzen.`
      : "Diese Einstellung lässt sich nicht rechnen.";
  }
  if (/^API-Fehler 5\d\d/.test(d)) return "Der Server konnte nicht rechnen.";
  return explain(d);
}

const detailOf = (e: unknown) => {
  const body = (e as ApiError | null)?.body;
  return isObj(body) && typeof body.detail === "string" ? body.detail : "";
};

/** Liegt es an den Daten des Projekts (Flugplan fehlt, Werte widersprechen sich)? */
export function isDataProblem(e: unknown): boolean {
  return /^(no_base|invalid_assets)/.test(detailOf(e));
}

/** Hilft ein zweiter Versuch? Nicht, wenn schon die Anfrage nicht zu rechnen ist (Daten, Grenzen des Modells). */
export function isRetryable(e: unknown): boolean {
  return !/^(no_base|invalid_)/.test(detailOf(e));
}

export async function getPreview(
  project: Project,
  changes: PreviewBody,
  signal?: AbortSignal,
): Promise<Preview> {
  const raw = await request<unknown>(
    `/projects/${enc(project.id)}/situation/preview`,
    { method: "POST", body: JSON.stringify(changes), signal },
    { timeoutMs: 15000, translate: previewError },
  );
  const preview = previewFromApi(raw);
  if (!preview) throw new Error("Die Vorschau hat keine Kurve geliefert.");
  return preview;
}
