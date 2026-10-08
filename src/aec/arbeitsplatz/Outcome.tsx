/** Vergleich heute gegen die aktuelle Stellung, mit dem Hinweis, wie genau die Zahl ist. */
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import type { Preview } from "../api/preview";
import { int, powerText } from "../model/format";
import type { LiveResult } from "../model/livePower";
import type { Accuracy } from "./useLiveScenario";

/** better: true = besser als heute, false = schlechter, null = keine Wertung. */
type Row = { label: string; today: string; now: string; better: boolean | null };

const kwh = (v: number) => `${int(v)} kWh`;

/** Weniger ist besser; innerhalb der Toleranz keine Wertung. */
function compare(today: number, now: number, tolerance: number): boolean | null {
  if (now < today - tolerance) return true;
  if (now > today + tolerance) return false;
  return null;
}

export default function Outcome({
  today,
  todayPreview,
  result,
  exact,
  accuracy,
  changed,
  sample,
}: {
  today: LiveResult;
  todayPreview: Preview;
  result: LiveResult;
  exact: Preview | null;
  accuracy: Accuracy;
  changed: boolean;
  sample: boolean;
}) {
  const late = (p: Preview | null) =>
    p?.delayedDepartures != null && p.departuresTotal
      ? `${int(p.delayedDepartures)} von ${int(p.departuresTotal)}`
      : null;
  // Rest der Wartezeit: kein freies Fahrzeug. Bleiben Abfluege trotz genug Strom spaet,
  // liegt es an der Flotte, nicht am Anschluss.
  const cause = (p: Preview | null) =>
    p?.energyWaitSharePct != null && p.delayedDepartures
      ? `${int(p.energyWaitSharePct)} % Strom, ${int(100 - p.energyWaitSharePct)} % Fahrzeuge`
      : null;
  const pending = sample ? "nur mit eigenem Projekt" : "wird gerechnet …";
  const rows: Row[] = [
    {
      label: "Fehlende Ladeleistung in der Spitze",
      today: powerText(today.maxMissingKw),
      now: powerText(result.maxMissingKw),
      better: compare(today.maxMissingKw, result.maxMissingKw, 1),
    },
    {
      label: "Fehlende Ladeenergie am Tag",
      today: kwh(today.missingKwh),
      now: kwh(result.missingKwh),
      better: compare(today.missingKwh, result.missingKwh, 1),
    },
    {
      label: "Minuten mit voll ausgelastetem Anschluss",
      today: `${int(today.minutesAtLimit)} min`,
      now: `${int(result.minutesAtLimit)} min`,
      better: compare(today.minutesAtLimit, result.minutesAtLimit, 1),
    },
    {
      label: "Abflüge nicht rechtzeitig fertig",
      today: late(todayPreview) ?? "–",
      now: late(exact) ?? pending,
      better:
        exact?.delayedDepartures != null && todayPreview.delayedDepartures != null
          ? compare(todayPreview.delayedDepartures, exact.delayedDepartures, 0.5)
          : null,
    },
    {
      label: "Woran die Wartezeit liegt",
      today: cause(todayPreview) ?? "–",
      now: cause(exact) ?? (exact ? "–" : pending),
      better: null,
    },
    ...(todayPreview.backgroundUnservedKwh || exact?.backgroundUnservedKwh
      ? [
          {
            label: "Übriger Flughafenbetrieb ohne Strom",
            today: kwh(todayPreview.backgroundUnservedKwh ?? 0),
            now: exact ? kwh(exact.backgroundUnservedKwh ?? 0) : pending,
            better: exact
              ? compare(
                  todayPreview.backgroundUnservedKwh ?? 0,
                  exact.backgroundUnservedKwh ?? 0,
                  1,
                )
              : null,
          },
        ]
      : []),
    {
      label: "Höchster Bezug aus dem Netz",
      today: powerText(today.peakImportKw),
      now: powerText(result.peakImportKw),
      better: null,
    },
  ];
  return (
    <section className="ap-outcome" aria-labelledby="ap-outcome-title">
      <h2 id="ap-outcome-title" className="ap-outcome__title">
        Heute und mit Ihrer Einstellung
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Heute</th>
            <th scope="col">Mit Ihrer Einstellung</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              data-better={changed && r.better === true ? "" : undefined}
              data-worse={changed && r.better === false ? "" : undefined}
            >
              <th scope="row">{r.label}</th>
              <td>{r.today}</td>
              <td>{changed ? r.now : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ap-accuracy" data-accuracy={accuracy} role="status">
        {sample || accuracy === "genau" ? (
          <EvidenceBadge level="synthetic" label="Vorschau" />
        ) : null}{" "}
        {sample
          ? "Beispieltag: Die Kurve folgt den Reglern als Näherung. Genau gerechnet wird in einem eigenen Projekt."
          : accuracy === "naeherung"
            ? "Näherung, die genaue Rechnung läuft."
            : accuracy === "genau"
              ? `Genau gerechnet${exact?.computeMs != null ? ` in ${int(exact.computeMs)} ms` : ""}. Vorschau, nicht als Berechnung gespeichert.`
              : ""}
      </p>
    </section>
  );
}
