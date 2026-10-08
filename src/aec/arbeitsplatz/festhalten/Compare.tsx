/** Heutiger Stand und festgehaltene Loesungen nebeneinander, am selben Tag gerechnet. */
import { EVIDENCE_ORDER, EvidenceBadge, type EvidenceLevel } from "../../../ui/EvidenceBadge";
import { dec1, int, powerText, unit } from "../../model/format";
import type { Variant, VariantBoard } from "../../types";

const BOTTLENECK: Record<string, string> = {
  none: "nichts",
  energy: "Strom",
  resource: "Fahrzeuge",
  energy_and_resource: "Strom und Fahrzeuge",
};

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${dec1(Math.abs(v))}`;
const rowName = (v: Variant) => (v.kind === "basis" ? "Heutiger Stand" : v.name);
const rank = (l: EvidenceLevel) => EVIDENCE_ORDER.indexOf(l);

export default function Compare({ board, bestId }: { board: VariantBoard; bestId: string | null }) {
  const rows = board.variants;
  const crisis = board.run?.crisis;
  const hasCrisis = rows.some((v) => v.stressOnTimePct != null);
  // Die Sicherheit steht je Zeile fest (etwa bleibt bei zu kleinem Anschluss Grundlast unversorgt);
  // fuer die Tabelle gilt die niedrigste.
  const weakest = rows.reduce<Variant | null>(
    (low, v) => (!low || rank(v.evidence) < rank(low.evidence) ? v : low),
    null,
  );
  const evidence = weakest?.evidence ?? "assumption";
  const differs = rows.some((v) => v.evidence !== evidence);
  return (
    <div className="ap-compare">
      <table>
        <caption className="ap-compare__caption">
          Heutiger Stand und festgehaltene Lösungen, alle am selben Tag gerechnet
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="aec-visually-hidden">Lösung</span>
            </th>
            <th scope="col">Rechtzeitig fertig</th>
            <th scope="col">Nicht rechtzeitig fertig</th>
            <th scope="col">Anschluss voll ausgelastet</th>
            <th scope="col">Fehlende Ladeleistung in der Spitze</th>
            <th scope="col">Was bremst</th>
            {hasCrisis ? (
              <th scope="col">
                {crisis
                  ? `Rechtzeitig fertig unter „${crisis.name}“`
                  : `Rechtzeitig fertig bei ${unit(20, "%")} weniger Anschluss`}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((v: Variant) => (
            <tr key={v.id} data-best={v.id === bestId ? "" : undefined}>
              <th scope="row">
                {rowName(v)}
                {v.id === bestId ? <small>hilft am meisten</small> : null}
              </th>
              <td>
                {unit(dec1(v.onTimePct), "%")}
                {v.deltaOnTimePct != null && v.kind !== "basis" ? (
                  <small>{unit(signed(v.deltaOnTimePct), "Prozentpunkte")}</small>
                ) : null}
              </td>
              <td>
                {v.delayedDepartures != null
                  ? `${int(v.delayedDepartures)}\u00a0von\u00a0${int(v.departuresTotal ?? 0)}`
                  : "–"}
              </td>
              <td>{unit(int(v.minutesAtLimit), "min")}</td>
              <td>{v.missingKw != null ? powerText(v.missingKw) : "–"}</td>
              <td>{v.bottleneck ? (BOTTLENECK[v.bottleneck] ?? v.bottleneck) : "–"}</td>
              {hasCrisis ? (
                <td>{v.stressOnTimePct != null ? unit(dec1(v.stressOnTimePct), "%") : "–"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ap-compare__foot">
        <EvidenceBadge
          level={evidence}
          detail={
            differs && weakest
              ? `Die Stufe gilt für die ganze Tabelle und stammt von der schwächsten Zeile „${rowName(weakest)}“.`
              : undefined
          }
        />
        {crisis ? (
          <span>
            {" "}
            Annahme für „{crisis.name}“. {crisis.assumption}
          </span>
        ) : null}
      </p>
    </div>
  );
}
