/**
 * Die Treppe: je Baustein der benoetigte Anschluss als Balken, der Anschluss des Flughafens als
 * rote Linie. Was ueber die Linie hinausragt, fehlt. Ein Klick auf eine Stufe zeigt ihre Tageskurve.
 */
import { dec1 } from "../model/format";
import { kw, lineFor, type Line, type Stage, type StageId } from "./stufen";

const SUB: Record<StageId, (storageKwh: number, stage: Stage) => string> = {
  uncontrolled: () => "volle Leistung, sobald ein Ladepunkt frei ist, nichts wird gesteuert",
  managed: () => "Ladezeiten nach dem Einsatzplan",
  managed_storage: (s, stage) =>
    !s
      ? "kein Speicher eingestellt"
      : stage.noGain
        ? `${dec1(s / 1000)} MWh Speicher senken hier den Bedarf nicht`
        : `mit ${dec1(s / 1000)} MWh Speicher`,
};

/** Runde Skala, auf der Anschluss und alle Stufen Platz haben. */
export function scaleMax(stages: Stage[], connectionKw: number): number {
  const top = Math.max(
    connectionKw,
    ...stages.filter((s) => !s.inactive).map((s) => s.needKw ?? 0),
  );
  const step = top > 4000 ? 1000 : 500;
  return Math.ceil((top * 1.12) / step) * step;
}

export default function Treppe({
  stages,
  connectionKw,
  storageKwh,
  selected,
  onSelect,
  line = lineFor(null, false),
}: {
  stages: Stage[];
  connectionKw: number;
  storageKwh: number;
  selected: StageId;
  onSelect: (s: StageId) => void;
  /** Wie die rote Linie heisst (Anschluss, Reserve oder Bedarf bei offener Reserve). */
  line?: Line;
}) {
  const max = scaleMax(stages, connectionKw);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const tick = max > 4000 ? 1000 : 500;
  const ticks = Array.from({ length: Math.floor(max / tick) + 1 }, (_, i) => i * tick);
  const last = [...stages].reverse().find((s) => !s.inactive)!;
  const missing = last.needKw !== null ? last.needKw - connectionKw : null;
  return (
    <figure
      className="oe-treppe"
      data-open={line.overload ? undefined : true}
      aria-label={`${line.need} je Baustein`}
    >
      <div className="oe-treppe__row oe-treppe__head" aria-hidden="true">
        <span />
        <span />
        <span className="oe-treppe__cell">
          <span className="oe-treppe__limitlabel" style={{ left: pct(connectionKw) }}>
            {line.label}: {kw(connectionKw)}
          </span>
        </span>
        <span />
      </div>
      <ol className="oe-treppe__stages">
        {stages.map((s) => {
          // Eine abgeschaltete Stufe zeigt keine Zahl: Sie wuerde im Termin nicht gebaut.
          const need = s.inactive ? null : s.needKw;
          const above = need !== null && need > connectionKw;
          // Ueber einer offenen Reserve liegt kein Mangel, nur Mehrbedarf ohne Steuerung (grau).
          const over = above && line.overload;
          return (
            <li key={s.id}>
              <button
                type="button"
                className="oe-treppe__row oe-stage"
                aria-pressed={selected === s.id}
                disabled={s.inactive}
                onClick={() => onSelect(s.id)}
              >
                <span className="oe-sign" aria-hidden="true">
                  {s.sign}
                </span>
                <span className="oe-stage__name">
                  {s.title}
                  <small>{SUB[s.id](storageKwh, s)}</small>
                </span>
                <span className="oe-treppe__cell oe-stage__track" aria-hidden="true">
                  {need !== null ? (
                    <>
                      <span
                        className="oe-stage__fill"
                        style={{ width: pct(Math.min(need, connectionKw)) }}
                      />
                      {above ? (
                        <span
                          className={
                            over ? "oe-stage__over" : "oe-stage__over oe-stage__over--neutral"
                          }
                          style={{ left: pct(connectionKw), width: pct(need - connectionKw) }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <span className="oe-stage__limit" style={{ left: pct(connectionKw) }} />
                </span>
                <span className="oe-stage__value" data-over={over || undefined}>
                  {s.inactive ? "–" : s.needKw === null ? "über 8.000\u00a0kW" : kw(s.needKw)}
                  {!s.inactive && s.savingKw ? <small>{kw(s.savingKw)} weniger</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="oe-treppe__row oe-treppe__axis" aria-hidden="true">
        <span />
        <span />
        <span className="oe-treppe__cell">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {t === 0 ? "0" : `${(t / 1000).toLocaleString("de-DE")}\u00a0MW`}
            </span>
          ))}
        </span>
        <span />
      </div>
      {line.more && missing !== null && missing > 0 ? (
        <p className="oe-treppe__grid">
          <span className="oe-sign oe-sign--stop" aria-hidden="true">
            4
          </span>
          {line.more(kw(missing))}
        </p>
      ) : null}
    </figure>
  );
}
