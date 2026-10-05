/**
 * Beispieldaten: deterministisch erzeugt, nicht gemessen, nicht simuliert.
 * Werden nur gezeigt, wenn das Backend keine Daten liefert, und sind dann
 * in der Oberflaeche ueberall als "Beispieldaten" markiert.
 */
import type { ExchangeItem, Project, Situation, Variant } from "./types";

export const SAMPLE_PROJECT: Project = {
  id: "beispiel-muc-sued",
  name: "MUC · Vorfeld Süd (Beispiel)",
  airport: "München",
  site: "Netzabgang Vorfeld Süd",
  dayLabel: "Verkehrstag 03.10.2026",
  fleetSize: 100,
  gridLimitKw: 3500,
  decision: "Reicht der Anschluss für 100 E-Fahrzeuge, und wo wird es zuerst eng?",
  source: "beispiel",
};

const bump = (m: number, center: number, width: number, height: number) =>
  height * Math.exp(-(((m - center) / width) ** 2));

/** Glatte, reproduzierbare Tageskurve mit drei Flugwellen und einer Busspitze. */
export function sampleSituation(project: Project = SAMPLE_PROJECT): Situation {
  const step = 5;
  const scale = project.gridLimitKw / 3500;
  const load = Array.from({ length: (24 * 60) / step }, (_, i) => {
    const m = i * step;
    const base = 900 + bump(m, 13 * 60, 330, 380) + bump(m, 7 * 60, 160, 160);
    const charging =
      bump(m, 6 * 60 + 50, 46, 2600) +
      bump(m, 6 * 60 + 5, 40, 700) +
      bump(m, 12 * 60, 30, 2200) +
      bump(m, 17 * 60 + 10, 60, 1500) +
      bump(m, 20 * 60 + 30, 50, 900) +
      bump(m, 2 * 60, 140, 500) +
      180 * Math.sin(m / 23) ** 2;
    const pv = Math.max(0, Math.sin(((m - 6.5 * 60) / (13 * 60)) * Math.PI)) * 620;
    return {
      minute: m,
      demandKw: Math.round((base + charging - pv * 0.55) * scale),
      baseKw: Math.round(base * scale),
      pvKw: Math.round(pv * scale),
    };
  });
  const departures = Array.from({ length: 48 }, (_, i) => {
    const m = i * 30;
    const c =
      bump(m, 6 * 60 + 40, 55, 21) +
      bump(m, 11 * 60 + 50, 70, 13) +
      bump(m, 16 * 60 + 50, 80, 15) +
      bump(m, 20 * 60 + 10, 60, 9) +
      (m > 5 * 60 && m < 23 * 60 ? 3 : 0);
    return { minute: m, count: Math.round(c) };
  });
  return {
    projectId: project.id,
    source: "beispiel",
    evidence: "synthetic",
    kind: "bedarf",
    gridLimitKw: project.gridLimitKw,
    stepMinutes: step,
    load,
    departures,
    delayedDepartures: 38,
    vehicleShare: 0.96,
  };
}

export function sampleVariants(): Variant[] {
  const v = (x: Omit<Variant, "evidence" | "source">): Variant => ({
    ...x,
    evidence: "synthetic",
    source: "beispiel",
  });
  return [
    v({
      id: "basis",
      name: "Basis",
      kind: "basis",
      onTimePct: 78,
      minutesAtLimit: 52,
      gridEnergyMwh: 41.2,
      peakKw: 4140,
    }),
    v({
      id: "speicher",
      name: "Speicher 2 MWh",
      kind: "speicher",
      onTimePct: 79,
      minutesAtLimit: 0,
      gridEnergyMwh: 41.9,
      peakKw: 3480,
    }),
    v({
      id: "schlepper",
      name: "+5 Schlepper",
      kind: "fahrzeuge",
      onTimePct: 96,
      minutesAtLimit: 71,
      gridEnergyMwh: 43.0,
      peakKw: 4390,
    }),
    v({
      id: "laderegel",
      name: "Laderegel Fristpriorität",
      kind: "laderegel",
      onTimePct: 78,
      minutesAtLimit: 49,
      gridEnergyMwh: 41.2,
      peakKw: 4080,
    }),
  ];
}

export function sampleExchange(projectId: string): ExchangeItem[] {
  return [
    {
      id: `${projectId}-x1`,
      kind: "testanfrage",
      title: "Ladepunkt 150 kW unter Spitzenwelle prüfen",
      summary:
        "Hält der Ladepunkt die Leistung, wenn zwölf Schlepper zwischen 06:10 und 07:30 gleichzeitig nachladen?",
      from: "flughafen",
      status: "geplant",
      evidence: "empirical_open",
      source: "beispiel",
      history: [
        { status: "vorgeschlagen", at: "2026-10-01T09:12", by: "flughafen" },
        {
          status: "angenommen",
          at: "2026-10-01T14:40",
          by: "lab",
          note: "Prüfstand frei ab KW 42.",
        },
        {
          status: "geplant",
          at: "2026-10-02T10:05",
          by: "lab",
          note: "Termin 14.10., vier Stunden.",
        },
      ],
    },
    {
      id: `${projectId}-x2`,
      kind: "szenario",
      title: "Enteisungsfenster als Stresstest",
      summary:
        "Szenario aus der Bibliothek: Enteisung verlängert die Abfertigung, Ladefenster schrumpfen.",
      from: "flughafen",
      status: "vorgeschlagen",
      evidence: "synthetic",
      source: "beispiel",
      history: [{ status: "vorgeschlagen", at: "2026-10-03T08:30", by: "flughafen" }],
    },
    {
      id: `${projectId}-x3`,
      kind: "auswertung",
      title: "FlexLab: Speicherzyklus 2 MWh ausgewertet",
      summary: "Wirkungsgrad und Leistungsrampen aus der Labmessung; Datenqualität ausreichend.",
      from: "lab",
      status: "erledigt",
      evidence: "empirical_open",
      source: "beispiel",
      history: [
        { status: "vorgeschlagen", at: "2026-09-28T11:00", by: "lab" },
        { status: "angenommen", at: "2026-09-29T09:00", by: "flughafen" },
        { status: "geplant", at: "2026-09-29T09:30", by: "lab" },
        {
          status: "erledigt",
          at: "2026-10-02T16:20",
          by: "lab",
          note: "Auswertung liegt im Lab-Abgleich.",
        },
      ],
    },
  ];
}
