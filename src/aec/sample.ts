/**
 * Beispielwerte: ein erfundener Verkehrstag, nicht gemessen. Sie erscheinen, wenn das Backend
 * keine Daten liefert, und sind in der Oberflaeche ueberall als "Beispielwerte" markiert.
 */
import { previewFromApi, type Preview } from "./api/preview";
import day from "./beispieltag.json";
import { points, STEP } from "./model/dayCurve";
import { resultFromExact } from "./model/livePower";
import type { ExchangeItem, Project, Situation } from "./types";

export const SAMPLE_PROJECT: Project = {
  id: "beispiel-muc-sued",
  name: "MUC · Vorfeld Süd (Beispiel)",
  airport: "München",
  site: "Netzabgang Vorfeld Süd",
  dayLabel: "Verkehrstag 03.10.2026",
  fleetSize: 101,
  gridLimitKw: 3500,
  decision: "Reicht der Anschluss für 101 E-Fahrzeuge, und wo wird es zuerst eng?",
  source: "beispiel",
};

/** Der Beispieltag, gerechnet mit dem Backend (backend/app/exchange/demo_day.py). */
export function samplePreview(): Preview {
  const preview = previewFromApi({ ...day.basis, kpis: day.kpis }, day.departures);
  if (!preview) throw new Error("Beispieltag fehlt.");
  return preview;
}

/** Die Tageskurve des Beispieltags in der Form der Lage-Grafik (Startseite). */
export function sampleSituation(project: Project = SAMPLE_PROJECT): Situation {
  const preview = samplePreview();
  const b = preview.basis;
  const curve = points(resultFromExact(b));
  // Grundlast und Photovoltaik je Fuenf-Minuten-Fenster; Reihen beginnen bei startMin.
  const at = (series: number[], m: number) => series[m - b.startMin] ?? 0;
  const load = curve.map((p) => ({
    minute: p.m,
    demandKw: Math.round(p.need),
    baseKw: Math.round(at(b.backgroundKw, p.m)),
    pvKw: Math.round(at(b.pvKw, p.m)),
  }));
  return {
    projectId: project.id,
    source: "beispiel",
    evidence: "synthetic",
    kind: "bedarf",
    gridLimitKw: b.power.gridImportLimitKw,
    stepMinutes: STEP,
    load,
    departures: preview.departures.map((d) => ({ minute: d.startMin, count: d.count })),
  };
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
