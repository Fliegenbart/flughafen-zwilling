import { bestVariant, dec1, int, powerText, variantsAnswer } from "../analysis";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import { WerkstattLinks } from "../Werkstatt";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import Link from "../Link";

const LO = 60;
const pos = (pct: number) => `${Math.max(0, Math.min(100, ((pct - LO) / (100 - LO)) * 100))}%`;

export default function VariantenView({ variants, route }: ViewProps) {
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  const best = bestVariant(variants);
  if (!base || !best) return <p className="aec-muted">Noch keine Varianten gerechnet.</p>;
  const delta = best.onTimePct - base.onTimePct;
  // Antwortsatz: erster Satz gross, Nebenbefunde in den Vorspann.
  const answer = variantsAnswer(variants);
  const cut = answer.indexOf(". ") >= 0 ? answer.indexOf(". ") + 1 : answer.length;
  const source = variants.every((v) => v.source === "api") ? "api" : "beispiel";

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Varianten · Was hilft?"
        answer={answer.slice(0, cut)}
        lead={`${answer.slice(cut).trim()} Gleicher Flugplan, gleiche Annahmen; jede Variante ändert genau einen Hebel.`.trim()}
        evidence={best.evidence}
        source={source}
        kpis={[
          {
            value: `${best.onTimePct}`,
            unit: "%",
            label: `pünktlich abgefertigt mit „${best.name}“`,
            tone: "signal",
          },
          { value: `+${delta}`, unit: "Pp.", label: "gegenüber Basis" },
          { value: int(best.minutesAtLimit), unit: "min", label: "am Anschlusslimit" },
          { value: dec1(best.gridEnergyMwh), unit: "MWh", label: "Netzenergie am Tag" },
        ]}
      />

      <Section title="Pünktlich abgefertigte Abflüge je Variante" kicker="Vergleich" id="var-chart">
        <div className="aec-runway" role="list">
          <div className="aec-runway__scale" aria-hidden="true">
            {[60, 70, 80, 90, 100].map((t) => (
              <span key={t} style={{ left: pos(t) }}>
                {t} %
              </span>
            ))}
          </div>
          {variants.map((v, i) => (
            <div
              key={v.id}
              className="aec-runway__row"
              role="listitem"
              data-best={v.id === best.id ? "" : undefined}
              style={{ "--i": i } as React.CSSProperties}
              aria-label={`${v.name}: ${v.onTimePct} Prozent pünktlich, ${v.minutesAtLimit} Minuten am Limit, Spitze ${powerText(v.peakKw)}`}
            >
              <span className="aec-runway__name">{v.name}</span>
              <span className="aec-runway__track" aria-hidden="true">
                <span className="aec-runway__base" style={{ left: pos(base.onTimePct) }} />
                <span className="aec-runway__fill" style={{ width: pos(v.onTimePct) }} />
                <span className="aec-runway__val" style={{ left: pos(v.onTimePct) }}>
                  {v.onTimePct} %
                </span>
              </span>
              <span
                className="aec-runway__limit"
                aria-hidden="true"
                title={`${v.minutesAtLimit} min am Limit`}
              >
                {Array.from({ length: Math.min(12, Math.ceil(v.minutesAtLimit / 10)) }, (_, j) => (
                  <i key={j} />
                ))}
                <em>{v.minutesAtLimit} min</em>
              </span>
            </div>
          ))}
        </div>
        <p className="aec-muted aec-runway__legend">
          <i className="aec-legend__basis" aria-hidden="true" /> Basis ·{" "}
          <i className="aec-legend__stopdots" aria-hidden="true" /> je Punkt 10 Minuten am
          Anschlusslimit
        </p>
      </Section>

      <Section title="Varianten im Einzelnen" kicker="Kennzahlen" id="var-cards">
        <ul className="aec-variants">
          {variants.map((v) => (
            <li key={v.id} data-best={v.id === best.id ? "" : undefined}>
              <span className="aec-variants__tag">
                {v.id === best.id
                  ? "bester Effekt"
                  : v.kind === "basis"
                    ? "Ist-Annahme"
                    : "Variante"}
              </span>
              <h3>{v.name}</h3>
              <dl>
                <div>
                  <dt>pünktlich abgefertigt</dt>
                  <dd>{v.onTimePct} %</dd>
                </div>
                <div>
                  <dt>Minuten am Limit</dt>
                  <dd>{v.minutesAtLimit}</dd>
                </div>
                <div>
                  <dt>Netzenergie / Tag</dt>
                  <dd>{dec1(v.gridEnergyMwh)} MWh</dd>
                </div>
                <div>
                  <dt>Spitze</dt>
                  <dd>{powerText(v.peakKw)}</dd>
                </div>
              </dl>
              <EvidenceBadge level={v.evidence} />
            </li>
          ))}
        </ul>
        <p className="aec-muted">
          Stresstest je Variante: 20 % weniger Netzimport, ein Ladepunkt aus, halbe PV. Krisenfälle
          aus der <Link to={{ page: "bibliothek" }}>Szenario-Bibliothek</Link> lassen sich
          zusätzlich übernehmen. Kosten erscheinen erst mit vom Kunden freigegebenen Preisen.
        </p>
      </Section>

      <Details summary="Werkstatt: Stresstests und Abfertigungssimulation">
        <WerkstattLinks items={["robustheit", "simulation"]} base={route} />
      </Details>
    </>
  );
}
