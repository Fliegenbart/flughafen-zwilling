/** Flottenblock der Vorschau (backend/app/exchange/live.py, fleet_block) in die Browser-Form bringen. */
import type { LiveFleet } from "../model/liveFleet";
import { isObj, num } from "./parse";

const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(x)) : []);
const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);

/** null, wenn der Block fehlt: Ohne Flotte laesst sich die Ladenachfrage nicht nachrechnen. */
export function fleetFromApi(raw: unknown): LiveFleet | null {
  if (!isObj(raw) || !Array.isArray(raw.classes) || !Array.isArray(raw.parking)) return null;
  return {
    chargingEfficiency: num(raw.charging_efficiency, 1),
    classes: list(raw.classes).map((c) => ({
      vehicles: num(c.vehicles),
      chargers: num(c.chargers),
      chargerKw: num(c.charger_kw),
      capacityKwh: num(c.capacity_kwh),
      initialSocPct: num(c.initial_soc_pct),
      targetSocPct: num(c.target_soc_pct),
      reserveSocPct: num(c.reserve_soc_pct),
      missionKwh: num(c.mission_kwh),
      missionMin: num(c.mission_min),
      releaseMin: nums(c.release_min),
      offline: list(c.offline).map((o) => ({
        startMin: num(o.start_min),
        endMin: num(o.end_min),
        chargers: num(o.chargers),
      })),
    })),
    parking: list(raw.parking).map((j) => ({
      releaseMin: num(j.release_min),
      deadlineMin: num(j.deadline_min),
      kwh: num(j.kwh),
      kw: num(j.kw),
    })),
  };
}
