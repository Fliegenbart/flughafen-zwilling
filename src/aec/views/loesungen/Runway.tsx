/** Vergleichsgrafik: puenktliche Abfluege je Loesung, Minuten am Limit als Punkte. */
import { dec1, int, powerText } from "../../model/format";
import type { Variant } from "../../types";

export default function Runway({
  variants,
  base,
  bestId,
}: {
  variants: Variant[];
  base: Variant;
  bestId: string | null;
}) {
  const min = Math.min(...variants.map((v) => v.onTimePct));
  const lo = Math.max(0, Math.min(60, Math.floor((min - 5) / 10) * 10));
  const pos = (pct: number) => `${Math.max(0, Math.min(100, ((pct - lo) / (100 - lo)) * 100))}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(lo + ((100 - lo) * i) / 4));
  const perDot = Math.max(
    10,
    Math.ceil(Math.max(...variants.map((v) => v.minutesAtLimit)) / 120) * 10,
  );
  return (
    <>
      <div className="aec-runway" role="list">
        <div className="aec-runway__scale" aria-hidden="true">
          {ticks.map((t) => (
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
            data-best={v.id === bestId ? "" : undefined}
            style={{ "--i": i } as React.CSSProperties}
            aria-label={`${v.name}: ${dec1(v.onTimePct)} Prozent pünktlich, ${v.minutesAtLimit} Minuten Anschluss voll ausgelastet, höchster Bedarf ${powerText(v.peakKw)}`}
          >
            <span className="aec-runway__name">{v.name}</span>
            <span className="aec-runway__track" aria-hidden="true">
              <span className="aec-runway__base" style={{ left: pos(base.onTimePct) }} />
              <span className="aec-runway__fill" style={{ width: pos(v.onTimePct) }} />
              <span className="aec-runway__val" style={{ left: pos(v.onTimePct) }}>
                {dec1(v.onTimePct)} %
              </span>
            </span>
            <span
              className="aec-runway__limit"
              aria-hidden="true"
              title={`${v.minutesAtLimit} Minuten Anschluss voll ausgelastet`}
            >
              {Array.from(
                { length: Math.min(12, Math.ceil(v.minutesAtLimit / perDot)) },
                (_, j) => (
                  <i key={j} />
                ),
              )}
              <em>{int(v.minutesAtLimit)} min</em>
            </span>
          </div>
        ))}
      </div>
      <p className="aec-muted aec-runway__legend">
        <i className="aec-legend__basis" aria-hidden="true" /> heutiger Stand ·{" "}
        <i className="aec-legend__stopdots" aria-hidden="true" /> ein Punkt steht für {perDot}{" "}
        Minuten voll ausgelasteten Anschluss
      </p>
    </>
  );
}
