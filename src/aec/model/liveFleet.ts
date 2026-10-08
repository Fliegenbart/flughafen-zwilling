/**
 * Ladezustand der Flotte, Minute fuer Minute, fuer die Live-Naeherung (livePower.ts).
 *
 * Wie viel die Fahrzeuge anfragen, haengt davon ab, wer frei ist und sein Ladeziel noch nicht
 * erreicht hat. Bei knappem Anschluss bleiben Fahrzeuge laenger leer, fragen weiter an und
 * koennen spaeter keinen Einsatz fahren. Das ist Zustand, kein Messwert: Darum fuehrt dieses
 * Abbild die Energie der Fahrzeuge selbst mit, nach denselben Regeln wie
 * backend/app/munich/coupled_simulator.py (Regel "uncontrolled"). Es gibt keine abgestimmten
 * Konstanten. Aendert sich die Regel im Backend, muss sie hier mitgezogen werden; die
 * Referenzfaelle in livePower.test.ts (make_live_power_fixture.py) melden eine Abweichung.
 *
 * Eingabe sind nur Weltdaten, die nicht von den Reglern abhaengen (Backend: fleet_block in
 * backend/app/exchange/live.py). Nicht abgebildet: Auftraege und Verspaetungen (nur soweit sie
 * die Ladenachfrage bestimmen) und die Regel "mission_priority".
 */

/** Weltdaten der Flotte, unabhaengig von den Reglern. */
export type LiveFleet = {
  /** Wirkungsgrad der Ladegeraete (power.charging_efficiency des Backends). */
  chargingEfficiency: number;
  classes: {
    vehicles: number;
    chargers: number;
    chargerKw: number;
    capacityKwh: number;
    initialSocPct: number;
    targetSocPct: number;
    reserveSocPct: number;
    /** Energie eines Einsatzes; im Backend sind alle Einsaetze einer Klasse gleich. */
    missionKwh: number;
    /** Dauer eines Einsatzes inklusive Rueckfahrt in Minuten. */
    missionMin: number;
    /** Freigabe der Auftraege (Minute, aufsteigend). */
    releaseMin: number[];
    /** Ausgefallene Ladepunkte (Stoerung): im Fenster [startMin, endMin) fehlen so viele. */
    offline: { startMin: number; endMin: number; chargers: number }[];
  }[];
  /** Parkhaus-Ladeauftraege: Fenster, Energie, Ladeleistung. */
  parking: { releaseMin: number; deadlineMin: number; kwh: number; kw: number }[];
};

const DT_H = 1 / 60;
/** Wie coupled_simulator.py: Rundungsrauschen bei Energievergleichen (kWh). */
const ENERGY_EPS = 1e-8;

/** Ein Fahrzeug; die Eckdaten der Klasse (Ziel, Reserve, Einsatz) stehen in `Group`. */
type Vehicle = {
  energy: number;
  /** Bis zu dieser Minute (ausschliesslich) im Einsatz; vor dem ersten Einsatz minus unendlich. */
  busyUntil: number;
  /** Angefragte Ladeleistung in dieser Minute. */
  requestKw: number;
};

type Group = {
  spec: LiveFleet["classes"][number];
  vehicles: Vehicle[];
  /** Freie Fahrzeuge in der Reihenfolge, in der sie frei wurden (Warteschlange der Ladepunkte). */
  idle: Vehicle[];
  targetKwh: number;
  reserveKwh: number;
  /** Zahl der bisher freigegebenen Auftraege und davon noch nicht vergebene. */
  released: number;
  waiting: number;
};

/**
 * Regeln wie coupled_simulator.py (Regel "uncontrolled"):
 * - Ein Fahrzeug ist im Einsatz (Dauer inkl. Rueckfahrt, Energie gleichmaessig verbraucht) oder frei.
 * - Freigegebene Auftraege warten je Klasse. Sie gehen an das freie Fahrzeug mit der meisten Energie,
 *   sofern es nach dem Einsatz noch die Reserve hat; sonst bleibt der Auftrag liegen.
 * - Freie Fahrzeuge unter dem Ladeziel fragen mit Ladeleistung an. Nur die Ladepunkte der Klasse
 *   werden belegt, in der Reihenfolge, in der die Fahrzeuge frei wurden.
 * - Parkhaus-Auftraege fragen im Fenster an, bis ihre Energie geladen ist.
 */
export class FleetState {
  private readonly eff: number;
  private readonly groups: Group[];
  private readonly parking: {
    job: LiveFleet["parking"][number];
    leftKwh: number;
    requestKw: number;
  }[];
  /** Angefragte Leistung des Vorfelds (Fahrzeugklassen) in der laufenden Minute (kW). */
  apronKw = 0;
  /** Angefragte Leistung des Parkhauses in der laufenden Minute (kW). */
  parkingKw = 0;

  constructor(f: LiveFleet) {
    this.eff = f.chargingEfficiency;
    this.groups = f.classes.map((spec) => {
      const vehicles = Array.from({ length: spec.vehicles }, () => ({
        energy: (spec.capacityKwh * spec.initialSocPct) / 100,
        busyUntil: Number.NEGATIVE_INFINITY, // zu Beginn alle frei
        requestKw: 0,
      }));
      return {
        spec,
        vehicles,
        idle: [...vehicles],
        targetKwh: (spec.capacityKwh * spec.targetSocPct) / 100,
        reserveKwh: (spec.capacityKwh * spec.reserveSocPct) / 100,
        released: 0,
        waiting: 0,
      };
    });
    this.parking = f.parking.map((job) => ({ job, leftKwh: job.kwh, requestKw: 0 }));
  }

  /** Rueckkehr, neue Auftraege, Einsatzvergabe; setzt `apronKw` und `parkingKw` der Minute. */
  request(minute: number): void {
    let apron = 0;
    for (const g of this.groups) {
      const { spec, vehicles, idle } = g;
      for (const v of vehicles) {
        v.requestKw = 0;
        if (v.busyUntil === minute) idle.push(v);
      }
      while (g.released < spec.releaseMin.length && spec.releaseMin[g.released]! <= minute) {
        g.released += 1;
        g.waiting += 1;
      }
      // Einsatzvergabe: freies Fahrzeug mit der meisten Energie (bei Gleichstand das erste).
      while (g.waiting > 0) {
        let best: Vehicle | undefined;
        for (const v of vehicles)
          if (
            v.busyUntil <= minute &&
            v.energy + ENERGY_EPS >= spec.missionKwh + g.reserveKwh &&
            (!best || v.energy > best.energy)
          )
            best = v;
        if (!best) break;
        best.busyUntil = minute + spec.missionMin;
        idle.splice(idle.indexOf(best), 1);
        g.waiting -= 1;
      }
      // Ladepunkte: freie Fahrzeuge unter dem Ladeziel, am laengsten wartende zuerst.
      const down = spec.offline.reduce(
        (s, o) => s + (o.startMin <= minute && minute < o.endMin ? o.chargers : 0),
        0,
      );
      let points = Math.max(0, spec.chargers - down);
      for (const v of idle) {
        if (points === 0) break;
        if (v.energy >= g.targetKwh - ENERGY_EPS) continue;
        v.requestKw = Math.min(spec.chargerKw, (g.targetKwh - v.energy) / DT_H / this.eff);
        apron += v.requestKw;
        points -= 1;
      }
    }
    let parking = 0;
    for (const p of this.parking) {
      const { job } = p;
      const open = job.releaseMin <= minute && minute < job.deadlineMin && p.leftKwh > ENERGY_EPS;
      p.requestKw = open ? Math.min(job.kw, p.leftKwh / DT_H / this.eff) : 0;
      parking += p.requestKw;
    }
    this.apronKw = apron;
    this.parkingKw = parking;
  }

  /**
   * Geliefert wird der Anteil `apronShare` der Vorfeld- und `parkingShare` der Parkhaus-Anfragen
   * (jede Anfrage bekommt ihres Sektors denselben Anteil); Einsatzfahrten verbrauchen Energie.
   */
  deliver(apronShare: number, parkingShare: number, minute: number): void {
    for (const g of this.groups) {
      const cost = g.spec.missionMin ? g.spec.missionKwh / g.spec.missionMin : 0;
      for (const v of g.vehicles) {
        v.energy += v.requestKw * apronShare * DT_H * this.eff;
        if (v.busyUntil > minute) v.energy -= cost;
      }
    }
    for (const p of this.parking)
      p.leftKwh = Math.max(0, p.leftKwh - p.requestKw * parkingShare * DT_H * this.eff);
  }
}
