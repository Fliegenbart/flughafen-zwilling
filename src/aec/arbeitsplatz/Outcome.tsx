/** Vergleich heute gegen die aktuelle Stellung, mit dem Hinweis, woher die Zahl kommt. */
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import type { Preview } from "../api/preview";
import { int, powerText, unit } from "../model/format";
import type { LiveResult } from "../model/livePower";
import type { Accuracy } from "./useLiveScenario";

/** better: true = besser als heute, false = schlechter, null = keine Wertung. */
type Row = { label: string; today: string; now: string; better: boolean | null };

const kwh = (v: number) => unit(int(v), "kWh");

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
      ? `${int(p.delayedDepartures)}\u00a0von\u00a0${int(p.departuresTotal)}`
      : null;
  // Rest der Wartezeit: kein freies Fahrzeug. Bleiben Abfluege trotz genug Strom spaet,
  // liegt es an der Flotte, nicht am Anschluss.
  const cause = (p: Preview | null) =>
    p?.energyWaitSharePct != null && p.delayedDepartures
      ? `${unit(int(p.energyWaitSharePct), "%")} Strom, ${unit(int(100 - p.energyWaitSharePct), "%")} Fahrzeuge`
      : null;
  const pending = sample
    ? "nur mit eigenem Projekt"
    : accuracy === "fehler"
      ? "nicht gerechnet"
      : "wird gerechnet …";
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
      today: unit(int(today.minutesAtLimit), "min"),
      now: unit(int(result.minutesAtLimit), "min"),
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
      label: "Was die Abflüge bremst",
      today: cause(todayPreview) ?? "–",
      now: cause(exact) ?? (exact ? "–" : pending),
      better: null,
    },
    ...(todayPreview.backgroundUnservedKwh || exact?.backgroundUnservedKwh
      ? [
          {
            label: "Strom, der dem übrigen Flughafen fehlt",
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
            <th scope="col">
              <span className="aec-visually-hidden">Kennzahl</span>
            </th>
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
              <td>
                {changed ? r.now : "–"}
                {changed && r.better !== null ? (
                  <span className="aec-visually-hidden">
                    {r.better ? ", besser als heute" : ", schlechter als heute"}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ap-accuracy" data-accuracy={accuracy}>
        {sample || (accuracy === "genau" && changed) ? (
          <EvidenceBadge level="synthetic" label="Vorschau" />
        ) : null}{" "}
        {sample
          ? "Die Kurve des Beispieltags folgt den Reglern als Näherung, eine Rechnung gibt es nur in einem eigenen Projekt."
          : accuracy === "naeherung"
            ? "Die Kurve ist vorerst eine Näherung, die Rechnung läuft."
            : accuracy === "genau" && changed
              ? "Diese Rechnung ist nicht gespeichert, erst „Einstellung festhalten“ macht daraus eine Lösung im Projekt."
              : accuracy === "fehler"
                ? "Die Kurve bleibt eine Näherung, die Rechnung ist ausgefallen."
                : ""}
      </p>
      {/* Eine Ansage pro Rechnung: nur wenn sie fertig ist, ohne die Zeit und ohne den Hinweis oben. */}
      <span className="aec-visually-hidden" role="status">
        {!sample && accuracy === "genau" && changed ? "Die Rechnung ist fertig." : ""}
      </span>
    </section>
  );
}
