/**
 * Schnelle Naeherung der Netzseite fuer die Live-Regler (Anschluss, Batterie, PV).
 *
 * Grundlage sind die Minutenreihen des letzten genauen Laufs (backend/app/exchange/live.py).
 * Je Minute wird die Leistungsbilanz des Backends (coupled_power.py) nachgerechnet. Was ein
 * Fahrzeug in einer Minute nicht laden kann, fragt es in der naechsten erneut an (Rueckstau).
 * Nicht genaehert wird die Fahrzeugseite: Auftraege, Wartezeiten, Puenktlichkeit. Die kommen
 * erst aus der genauen Rechnung nach dem Loslassen des Reglers.
 *
 * Abweichung gegen die genaue Rechnung: livePower.test.ts mit Referenz aus
 * backend/scripts/make_live_power_fixture.py.
 */

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
    chargingLimitKw: number;
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
const EPS = 1e-6;
const CARRY_DECAY = 0.8;

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
  // Hoechste angefragte Leistung als Ersatz fuer die Zahl der Ladepunkte.
  const requestCap = b.requestedKw.reduce((m, v) => Math.max(m, v), 0);

  const out = emptyResult();
  let carryBase = 0;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const fresh = Math.max(0, b.requestedKw[i]! - carryBase * CARRY_DECAY);
    carryBase = Math.max(0, b.requestedKw[i]! - b.deliveredKw[i]!);
    const request = Math.min(fresh + carry, Math.max(requestCap, fresh));

    const baseCap = b.gridCapKw[i]!;
    // Stoerungen im Basislauf (Grenze unter dem Anschluss) bleiben erhalten.
    const cap =
      baseCap < p.gridImportLimitKw - EPS
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
    const upstream = Math.min(request / eta, p.chargingLimitKw, available);
    const delivered = upstream * eta;
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

    const missing = Math.max(0, request - delivered);
    // Der Rueckstau klingt pro Minute auf 80 % ab: Ein Teil der wartenden Fahrzeuge faehrt
    // ohnehin los oder ist voll. Gegen die genaue Rechnung gemessen (2,2 bis 3 MW) am besten.
    carry = missing * CARRY_DECAY;

    record(out, b.startMin + i, b.dayMinutes, imported, cap, missing, discharge - charge);
  }
  return out;
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
