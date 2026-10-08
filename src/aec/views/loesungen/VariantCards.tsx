/** Jede Loesung im Detail: Kennzahlen je Karte. */
import { EvidenceBadge } from "../../../ui/EvidenceBadge";
import Link from "../../Link";
import { dec1, int, powerText } from "../../model/format";
import { Section } from "../../parts";
import type { Variant, VariantBoard } from "../../types";

const BOTTLENECK: Record<string, string> = {
  none: "nichts",
  energy: "Strom",
  resource: "Fahrzeuge",
  energy_and_resource: "Strom und Fahrzeuge",
};

export default function VariantCards({
  variants,
  bestId,
  board,
  computed,
}: {
  variants: Variant[];
  bestId: string | null;
  board: VariantBoard;
  computed: boolean;
}) {
  return (
    <Section title="Jede Lösung im Detail" kicker="Die Zahlen dahinter" id="var-cards">
      <ul className="aec-variants">
        {variants.map((v) => (
          <li key={v.id} data-best={v.id === bestId ? "" : undefined}>
            <span className="aec-variants__tag">
              {v.id === bestId
                ? "hilft am meisten"
                : v.kind === "basis"
                  ? "heutiger Stand"
                  : "Lösung"}
            </span>
            <h3>{v.name}</h3>
            <dl>
              <div>
                <dt>pünktlich fertig</dt>
                <dd>
                  {dec1(v.onTimePct)} %
                  {v.deltaOnTimePct != null && v.kind !== "basis" ? (
                    <small>
                      {" "}
                      ({v.deltaOnTimePct >= 0 ? "+" : "−"}
                      {dec1(Math.abs(v.deltaOnTimePct))} Prozentpunkte)
                    </small>
                  ) : null}
                </dd>
              </div>
              {v.delayedDepartures != null ? (
                <div>
                  <dt>nicht rechtzeitig fertig</dt>
                  <dd>
                    {int(v.delayedDepartures)} von {int(v.departuresTotal ?? 0)}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Anschluss voll ausgelastet</dt>
                <dd>{int(v.minutesAtLimit)}</dd>
              </div>
              <div>
                <dt>höchster Strombedarf</dt>
                <dd>{powerText(v.peakKw)}</dd>
              </div>
              {v.missingKw != null ? (
                <div>
                  <dt>fehlen zum Laden in der Spitze</dt>
                  <dd>{powerText(v.missingKw)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Strom aus dem Netz am Tag</dt>
                <dd>{dec1(v.gridEnergyMwh)} MWh</dd>
              </div>
              {v.bottleneck ? (
                <div>
                  <dt>Was bremst</dt>
                  <dd>{BOTTLENECK[v.bottleneck] ?? v.bottleneck}</dd>
                </div>
              ) : null}
              {v.fleetTotal ? (
                <div>
                  <dt>Fahrzeuge</dt>
                  <dd>{int(v.fleetTotal)} Fahrzeuge</dd>
                </div>
              ) : null}
              {v.backgroundUnservedKwh ? (
                <div>
                  <dt>übriger Verbrauch nicht gedeckt</dt>
                  <dd>{int(v.backgroundUnservedKwh)} kWh</dd>
                </div>
              ) : null}
              {v.stressOnTimePct != null ? (
                <div>
                  <dt>{board.run?.crisis ? `unter „${board.run.crisis.name}“` : "unter Stress"}</dt>
                  <dd>{dec1(v.stressOnTimePct)} %</dd>
                </div>
              ) : null}
            </dl>
            <EvidenceBadge level={v.evidence} />
          </li>
        ))}
      </ul>
      <p className="aec-muted">
        {computed
          ? "„Rechnerisch geprüft“ heißt, die Berechnung ist vollständig, alle Lösungen hatten denselben Tag, keine Energie ging verloren und der übrige Verbrauch war gedeckt. "
          : ""}
        Wie robust eine Lösung ist, zeigen die Krisenfälle in der{" "}
        <Link to={{ page: "bibliothek" }}>Szenario-Bibliothek</Link>. Kosten zeigen wir erst, wenn
        Sie Preise freigeben.
      </p>
    </Section>
  );
}
