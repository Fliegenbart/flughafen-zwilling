/** Vergleich heute gegen die aktuelle Stellung, mit dem Hinweis, wie genau die Zahl ist. */
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
  const share = (p: Preview | null) =>
    p?.energyWaitSharePct != null ? `${int(p.energyWaitSharePct)} %` : null;
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
      label: "Abfertigungen im Modell nicht rechtzeitig bereit",
      today: late(todayPreview) ?? "–",
      now: late(exact) ?? "noch kein berechnetes Ergebnis",
      better:
        exact?.delayedDepartures != null && todayPreview.delayedDepartures != null
          ? compare(todayPreview.delayedDepartures, exact.delayedDepartures, 0.5)
          : null,
    },
    {
      label: "Anteil energiebedingter Wartezeit im Modell",
      today: share(todayPreview) ?? "–",
      now: share(exact) ?? (sample ? "–" : "wird gerechnet …"),
      better: null,
    },
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
        Ausgangslage und Ihre Variante
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Ausgangslage</th>
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
        {accuracy === "naeherung"
          ? "Vorläufige Netz-Näherung. Die gekoppelte Simulation wird berechnet; Fahrzeugergebnisse folgen."
          : accuracy === "genau"
            ? `Simulation berechnet${exact?.computeMs != null ? ` in ${int(exact.computeMs)} ms` : ""}. ${sample ? "Synthetischer Verkehrstag, keine Messung am Flughafen München." : "Vorschau auf Basis der Projektannahmen."}`
            : "Berechnung fehlgeschlagen. Angezeigte Netz-Näherung ist kein fertiges Simulationsergebnis."}
      </p>
      {exact?.calculationId ? (
        <p className="ap-accuracy">
          Berechnungs-ID: <code>{exact.calculationId}</code>
          <br />
          Engine: {exact.engineVersion} · Eingabe-Hash: <code>{exact.inputHash}</code>
        </p>
      ) : null}
      <p className="ap-accuracy">
        Die Betriebskennzahl beschreibt die Bereitschaft modellierter Abfertigungen, nicht die reale
        Abflugpünktlichkeit. Das Modell ist nicht an Flughafenmessungen kalibriert und steuert keine
        Anlagen.
      </p>
    </section>
  );
}
