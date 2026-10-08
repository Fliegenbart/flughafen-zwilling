/**
 * Schnelle Naeherung der Netzseite fuer die Live-Regler (Anschluss, Batterie, PV).
 *
 * Je Minute wird gerechnet wie im Backend: erst die Ladenachfrage der Flotte (liveFleet.ts, gleiche
 * Regeln wie coupled_simulator.py, Regel "uncontrolled"), darauf die Leistungsbilanz
 * (coupled_power.py PowerBalance.step: Grundlast, PV, BHKW, Netzgrenze, Batterie, Trafogrenzen).
 * Was nicht geliefert wird, bleibt im Energiestand der Fahrzeuge und wird spaeter erneut angefragt.
 * Die Minutenreihen des Basislaufs liefern nur Grundlast, PV, BHKW und Netzgrenze (sowie die
 * genauen Kennzahlen fuer resultFromExact); es gibt keine abgestimmten Konstanten.
 *
 * Nicht genaehert wird die Fahrzeugseite: Auftraege, Wartezeiten, Puenktlichkeit. Die kommen
 * erst aus der genauen Rechnung nach dem Loslassen des Reglers. Ebenfalls nicht abgebildet:
 * zusaetzliche Fahrzeuge, Krisenfall und die Laderegel "mission_priority"; dann weicht die
 * Naeherung ab (bei mission_priority im Beispieltag um bis zu rund 25 %).
 *
 * Abweichung gegen die genaue Rechnung: livePower.test.ts mit Referenz aus
 * backend/scripts/make_live_power_fixture.py.
 */

import type { FleetKind } from "../types";
import type { ChargingPolicy } from "./policy";
import { FleetState, type LiveFleet } from "./liveFleet";

export type LiveBasis = {
  dayMinutes: number;
  /** Erste Minute der Reihen (Intervallbeginn); negativ = Vorlauf vor Mitternacht. */
  startMin: number;
  requestedKw: number[];
  deliveredKw: number[];
  backgroundKw: number[];
  pvKw: number[];
  chpKw: number[];
  gridCapKw: number[];
  /** Nur aus einer genauen Rechnung: tatsaechlicher Netzbezug und Batterie (+ gibt ab). */
  gridImportKw?: number[];
  batteryKw?: number[];
  /** Weltdaten der Flotte fuer die Ladenachfrage (siehe liveFleet.ts). */
  fleet: LiveFleet;
  power: {
    gridImportLimitKw: number;
    pvCapacityKwp: number;
    batteryCapacityKwh: number;
    batteryPowerKw: number;
    batteryInitialSocPct: number;
    batteryReservePct: number;
    batteryEfficiency: number;
    batteryGridChargeBelowKw: number | null;
    transformerEfficiency: number;
    /** Trafogrenzen Vorfeld und Parkhaus (kW, Wirkleistung): jeder Sektor hat seine eigene. */
    apronLimitKw: number;
    parkingLimitKw: number;
  };
};

export type Levers = {
  gridLimitKw: number;
  batteryKwh: number;
  /** Leistung der Batterie; Standard wie bei Loesungen: halbe Kapazitaet je Stunde. */
  batteryKw?: number;
  pvFactor: number;
  /** Zusaetzliche Fahrzeuge; die Naeherung rechnet sie nicht, nur die genaue Vorschau. */
  extraVehicles?: number;
  /** Art der zusaetzlichen Fahrzeuge; ohne Angabe im Verhaeltnis der Standardflotte. */
  extraKind?: FleetKind;
  /** Laderegel; wirkt nur in der genauen Rechnung. */
  policy?: ChargingPolicy;
  /** Krisenfall der Bibliothek (scenarioId); wirkt nur in der genauen Rechnung. */
  crisis?: string;
};

export type LiveResult = {
  /** Je Minute des Verkehrstags (0 … dayMinutes-1). */
  importKw: number[];
  capKw: number[];
  missingKw: number[];
  batteryKw: number[];
  minutesAtLimit: number;
  peakImportKw: number;
  maxMissingKw: number;
  missingKwh: number;
  /** Zusammenhaengende Phasen mit fehlender Ladeleistung. */
  shortfalls: { start: number; end: number; maxMissingKw: number; missingKwh: number }[];
};

const DT_H = 1 / 60;
const LIMIT_TOLERANCE_KW = 0.5;
/** Wie backend/app/exchange/variants.py: Speicher laedt aus dem Netz unter 80 % der Grenze. */
const STORAGE_GRID_CHARGE_SHARE = 0.8;
/** Netzgrenze des Basislaufs gilt als gestoert, wenn sie mehr als das unter dem Anschluss liegt (kW). */
const CAP_EPS_KW = 1e-6;

export function leversFromBasis(b: LiveBasis): Levers {
  return {
    gridLimitKw: b.power.gridImportLimitKw,
    batteryKwh: b.power.batteryCapacityKwh,
    batteryKw: b.power.batteryCapacityKwh ? b.power.batteryPowerKw : undefined,
    pvFactor: 1,
  };
}

export function simulateLive(b: LiveBasis, levers: Levers): LiveResult {
  const p = b.power;
  const n = b.requestedKw.length;
  const eta = p.transformerEfficiency;
  const batteryChanged = levers.batteryKwh !== p.batteryCapacityKwh;
  const capacity = levers.batteryKwh;
  const bPower = levers.batteryKw ?? (capacity ? capacity / 2 : 0);
  // Neue Batterie: Start-SOC und Netzladeschwelle wie bei einer Loesung im Backend.
  const socPct = batteryChanged ? Math.max(p.batteryReservePct, 50) : p.batteryInitialSocPct;
  const gridChargeBelow = !capacity
    ? null
    : batteryChanged || levers.gridLimitKw !== p.gridImportLimitKw
      ? levers.gridLimitKw * STORAGE_GRID_CHARGE_SHARE
      : p.batteryGridChargeBelowKw;
  const reserve = (capacity * p.batteryReservePct) / 100;
  let stored = (capacity * socPct) / 100;

  const fleet = new FleetState(b.fleet);

  const out = emptyResult();
  for (let i = 0; i < n; i++) {
    const minute = b.startMin + i;
    // Rueckkehr, neue Auftraege, Einsatzvergabe; dann fragen die ladebereiten Fahrzeuge an.
    fleet.request(minute);
    const request = fleet.apronKw + fleet.parkingKw;

    const baseCap = b.gridCapKw[i]!;
    // Stoerungen im Basislauf (Grenze unter dem Anschluss) bleiben erhalten.
    const cap =
      baseCap < p.gridImportLimitKw - CAP_EPS_KW
        ? Math.min(baseCap, levers.gridLimitKw)
        : levers.gridLimitKw;
    const pv = b.pvKw[i]! * levers.pvFactor;
    const chp = b.chpKw[i]!;
    const background = b.backgroundKw[i]!;

    const dischargeAvail = Math.min(
      bPower,
      (Math.max(0, stored - reserve) * p.batteryEfficiency) / DT_H,
    );
    const supply = pv + chp + cap + dischargeAvail;
    const served = Math.min(background, supply);
    const available = Math.max(0, supply - served);
    // Zuteilung wie PowerBalance.step (Regel "uncontrolled"): erst begrenzt der Trafo jeden
    // Sektor, dann kuerzt die verfuegbare Leistung alle Anfragen um denselben Anteil.
    const apronFactor = sectorFactor(fleet.apronKw, p.apronLimitKw, eta);
    const parkingFactor = sectorFactor(fleet.parkingKw, p.parkingLimitKw, eta);
    const granted = fleet.apronKw * apronFactor + fleet.parkingKw * parkingFactor;
    const wanted = granted / eta;
    const scale = wanted > 0 ? Math.min(1, available / wanted) : 1;
    const upstream = wanted * scale;
    const delivered = granted * scale;
    const demand = served + upstream;
    const deficit = Math.max(0, demand - pv - chp);
    let imported = Math.min(cap, deficit);
    const discharge = Math.min(dischargeAvail, Math.max(0, deficit - imported));
    const surplus = Math.max(0, pv + chp - demand);
    const room = capacity ? Math.max(0, capacity - stored) / DT_H / p.batteryEfficiency : 0;
    const chargeSurplus = Math.min(bPower, surplus, room);
    let gridCharge = 0;
    if (gridChargeBelow != null && discharge <= 0 && capacity) {
      gridCharge = Math.max(
        0,
        Math.min(
          bPower - chargeSurplus,
          room - chargeSurplus,
          Math.min(gridChargeBelow, cap) - imported,
        ),
      );
      imported += gridCharge;
    }
    const charge = chargeSurplus + gridCharge;
    stored += (charge * p.batteryEfficiency - discharge / p.batteryEfficiency) * DT_H;
    stored = Math.min(capacity, Math.max(reserve, stored));

    // Was geliefert wurde, laedt die Fahrzeuge; der Rest bleibt als Rueckstau in ihrem Energiestand.
    fleet.deliver(apronFactor * scale, parkingFactor * scale, minute);

    record(
      out,
      minute,
      b.dayMinutes,
      imported,
      cap,
      Math.max(0, request - delivered),
      discharge - charge,
    );
  }
  return out;
}

/** Anteil der Anfrage eines Sektors, den dessen Trafo durchlaesst (1 = ohne Kuerzung). */
function sectorFactor(requestKw: number, limitKw: number, efficiency: number): number {
  return requestKw > 0 ? Math.min(1, (limitKw * efficiency) / requestKw) : 1;
}

function emptyResult(): LiveResult {
  return {
    importKw: [],
    capKw: [],
    missingKw: [],
    batteryKw: [],
    minutesAtLimit: 0,
    peakImportKw: 0,
    maxMissingKw: 0,
    missingKwh: 0,
    shortfalls: [],
  };
}

/** Eine Minute verbuchen; gleiche Definitionen fuer Naeherung und genaue Rechnung. */
function record(
  out: LiveResult,
  minute: number,
  dayMinutes: number,
  imported: number,
  cap: number,
  missing: number,
  battery: number,
) {
  if (minute < 0 || minute >= dayMinutes) return;
  out.importKw.push(imported);
  out.capKw.push(cap);
  out.missingKw.push(missing);
  out.batteryKw.push(battery);
  if (cap > 0 && imported >= cap - LIMIT_TOLERANCE_KW) out.minutesAtLimit += 1;
  out.peakImportKw = Math.max(out.peakImportKw, imported);
  out.maxMissingKw = Math.max(out.maxMissingKw, missing);
  out.missingKwh += missing * DT_H;
  const last = out.shortfalls[out.shortfalls.length - 1];
  if (missing <= LIMIT_TOLERANCE_KW) return;
  if (last && last.end === minute) {
    last.end = minute + 1;
    last.maxMissingKw = Math.max(last.maxMissingKw, missing);
    last.missingKwh += missing * DT_H;
  } else
    out.shortfalls.push({
      start: minute,
      end: minute + 1,
      maxMissingKw: missing,
      missingKwh: missing * DT_H,
    });
}

/** Kennzahlen direkt aus einer genauen Vorschau (ohne Naeherung). */
export function resultFromExact(b: LiveBasis): LiveResult {
  const out = emptyResult();
  const grid = b.gridImportKw ?? [];
  const battery = b.batteryKw ?? [];
  for (let i = 0; i < b.requestedKw.length; i++)
    record(
      out,
      b.startMin + i,
      b.dayMinutes,
      grid[i] ?? 0,
      b.gridCapKw[i]!,
      Math.max(0, b.requestedKw[i]! - b.deliveredKw[i]!),
      battery[i] ?? 0,
    );
  return out;
}
