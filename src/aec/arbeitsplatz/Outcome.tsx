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
  const ready = accuracy === "genau" && !!exact;
  const energyDelta = result.missingKwh - today.missingKwh;
  const lateDelta =
    exact?.delayedDepartures != null && todayPreview.delayedDepartures != null
      ? exact.delayedDepartures - todayPreview.delayedDepartures
      : null;
  const cards = [
    {
      title: "Ungedeckter Ladebedarf",
      before: kwh(today.missingKwh),
      after: kwh(result.missingKwh),
      delta: `${int(Math.abs(energyDelta))} kWh ${energyDelta < 0 ? "weniger" : "mehr"}`,
      better: compare(today.missingKwh, result.missingKwh, 1),
      help: "Ladeenergie, die im Modell innerhalb des Tages nicht bereitgestellt wird.",
    },
    {
      title: "Abfertigungen mit Wartezeit",
      before: late(todayPreview) ?? "–",
      after: late(exact) ?? "–",
      delta:
        lateDelta == null
          ? ""
          : lateDelta === 0
            ? "Unverändert"
            : `${int(Math.abs(lateDelta))} ${lateDelta < 0 ? "weniger" : "mehr"}`,
      better: lateDelta == null || lateDelta === 0 ? null : lateDelta < 0,
      help: "Modellierte Abfertigungen, für die Fahrzeuge nicht rechtzeitig bereitstehen.",
    },
    {
      title: "Höchste Netzlast",
      before: powerText(today.peakImportKw),
      after: powerText(result.peakImportKw),
      delta: `${powerText(Math.abs(result.peakImportKw - today.peakImportKw))} ${result.peakImportKw < today.peakImportKw ? "weniger" : "mehr"}`,
      better: null,
      help: "Die größte gleichzeitig bezogene Leistung am Netzanschluss.",
    },
  ];
  return (
    <section className="ap-outcome" aria-labelledby="ap-outcome-title">
      <h2 id="ap-outcome-title" className="ap-outcome__title">
        2 · Was verändert Ihre Variante?
      </h2>
      <p className="ap-result-lead">
        Gleicher Flughafentag. Gleiche Einsatzaufträge. Ihre Einstellungen im Vergleich zur
        Ausgangslage.
      </p>
      <div className="ap-result-cards" aria-busy={!ready}>
        {cards.map((card) => (
          <article className="ap-result-card" key={card.title}>
            <h3>{card.title}</h3>
            <div className="ap-result-pair">
              <div>
                <span>Ausgangslage</span>
                <strong>{card.before}</strong>
              </div>
              <div>
                <span>Ihre Variante</span>
                <strong>
                  {ready ? card.after : accuracy === "fehler" ? "Nicht verfügbar" : "Berechnet …"}
                </strong>
              </div>
            </div>
            <p
              className="ap-delta"
              data-direction={
                ready && changed
                  ? card.better === true
                    ? "better"
                    : card.better === false
                      ? "worse"
                      : "neutral"
                  : "neutral"
              }
            >
              {ready
                ? changed
                  ? card.delta
                  : "Identische Einstellungen"
                : accuracy === "fehler"
                  ? "Berechnung fehlgeschlagen"
                  : "Simulation läuft"}
            </p>
            <p>{card.help}</p>
          </article>
        ))}
      </div>
      <p className="ap-takeaway" aria-live="polite">
        {accuracy === "fehler"
          ? "Die Variante konnte nicht berechnet werden. Verändern Sie einen Regler, um die Berechnung erneut zu starten."
          : !ready
            ? "Die gekoppelte Simulation berechnet jetzt auch die Auswirkungen auf Fahrzeuge und Einsätze."
            : !changed
              ? "Starten Sie mit einer Frage: Was passiert, wenn 20 zusätzliche Elektrofahrzeuge zum Einsatz kommen? Bewegen Sie dafür den ersten Regler."
              : energyDelta < -1 && lateDelta != null && lateDelta >= 0
                ? "Mehr Ladeenergie wird gedeckt. Die Wartezeiten bei den Abfertigungen sinken jedoch nicht: Auch Fahrzeugverfügbarkeit und Einsatzplanung begrenzen den Betrieb."
                : lateDelta != null && lateDelta < 0
                  ? "In dieser Variante stehen Fahrzeuge für mehr Abfertigungen rechtzeitig bereit. Prüfen Sie daneben den Ladebedarf und die Netzlast: Mehr Einsatzbereitschaft kann zusätzlichen Strom erfordern."
                  : lateDelta != null && lateDelta > 0
                    ? "In dieser Variante müssen mehr Abfertigungen auf Fahrzeuge warten. Vergleichen Sie nun einen größeren Speicher oder mehr Anschlussleistung mit dieser Einstellung."
                    : "Die Variante verändert die Energieversorgung, ohne die Zahl wartender Abfertigungen zu verändern. Der Stromanschluss ist nur ein Teil des Systems."}
      </p>
      <details className="ap-extra">
        <summary>Alle Kennzahlen und Berechnungsnachweis</summary>
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
        {exact?.calculationId ? (
          <p className="ap-accuracy">
            Berechnungs-ID: <code>{exact.calculationId}</code>
            <br />
            Engine: {exact.engineVersion} · Eingabe-Hash: <code>{exact.inputHash}</code>
          </p>
        ) : null}
      </details>
      <p className="ap-accuracy" data-accuracy={accuracy} role="status">
        {accuracy === "naeherung"
          ? "Vorläufige Netz-Näherung. Die gekoppelte Simulation wird berechnet; Fahrzeugergebnisse folgen."
          : accuracy === "genau"
            ? `Simulation berechnet${exact?.computeMs != null ? ` in ${int(exact.computeMs)} ms` : ""}. ${sample ? "Synthetischer Verkehrstag, keine Messung am Flughafen München." : "Vorschau auf Basis der Projektannahmen."}`
            : "Berechnung fehlgeschlagen. Angezeigte Netz-Näherung ist kein fertiges Simulationsergebnis."}
      </p>
      <p className="ap-accuracy">
        Die Betriebskennzahl beschreibt die Bereitschaft modellierter Abfertigungen, nicht die reale
        Abflugpünktlichkeit. Das Modell ist nicht an Flughafenmessungen kalibriert und steuert keine
        Anlagen.
      </p>
    </section>
  );
}
