/** Heutiger Stand und festgehaltene Loesungen nebeneinander, am selben Tag gerechnet. */
import { EvidenceBadge } from "../../../ui/EvidenceBadge";
import { dec1, int, powerText } from "../../model/format";
import type { Variant, VariantBoard } from "../../types";

const BOTTLENECK: Record<string, string> = {
  none: "nichts",
  energy: "Strom",
  resource: "Fahrzeuge",
  energy_and_resource: "Strom und Fahrzeuge",
};

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${dec1(Math.abs(v))}`;

export default function Compare({ board, bestId }: { board: VariantBoard; bestId: string | null }) {
  const rows = board.variants;
  const crisis = board.run?.crisis;
  const hasCrisis = rows.some((v) => v.stressOnTimePct != null);
  // Alle Zeilen eines Laufs haben dieselbe Sicherheit; die niedrigste gilt fuer die Tabelle.
  const evidence = rows[0]?.evidence ?? "model_checked";
  return (
    <div className="ap-compare">
      <table>
        <caption className="ap-compare__caption">
          Heutiger Stand und festgehaltene Lösungen, alle am selben Tag gerechnet
        </caption>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Pünktlich fertig</th>
            <th scope="col">Nicht rechtzeitig fertig</th>
            <th scope="col">Anschluss voll ausgelastet</th>
            <th scope="col">Fehlt in der Spitze</th>
            <th scope="col">Was bremst</th>
            {hasCrisis ? (
              <th scope="col">{crisis ? `Unter „${crisis.name}“` : "Unter Stress"}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((v: Variant) => (
            <tr key={v.id} data-best={v.id === bestId ? "" : undefined}>
              <th scope="row">
                {v.kind === "basis" ? "Heutiger Stand" : v.name}
                {v.id === bestId ? <small>hilft am meisten</small> : null}
              </th>
              <td>
                {dec1(v.onTimePct)} %
                {v.deltaOnTimePct != null && v.kind !== "basis" ? (
                  <small>{signed(v.deltaOnTimePct)} Prozentpunkte</small>
                ) : null}
              </td>
              <td>
                {v.delayedDepartures != null
                  ? `${int(v.delayedDepartures)} von ${int(v.departuresTotal ?? 0)}`
                  : "–"}
              </td>
              <td>{int(v.minutesAtLimit)} min</td>
              <td>{v.missingKw != null ? powerText(v.missingKw) : "–"}</td>
              <td>{v.bottleneck ? (BOTTLENECK[v.bottleneck] ?? v.bottleneck) : "–"}</td>
              {hasCrisis ? (
                <td>{v.stressOnTimePct != null ? `${dec1(v.stressOnTimePct)} %` : "–"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ap-compare__foot">
        <EvidenceBadge level={evidence} />
        {crisis ? (
          <span>
            {" "}
            Annahme zu „{crisis.name}“: {crisis.assumption}
          </span>
        ) : null}
      </p>
    </div>
  );
}
