import type { ReactElement } from "react";
/**
 * Je Krisenfall eine kleine, ruhige Bewegtgrafik (SVG + CSS-Animation).
 * Bei prefers-reduced-motion stehen alle Grafiken still im aussagekraeftigsten Zustand.
 */
const W = 200;
const H = 120;
const GROUND = 100;

function Bars({ values, className }: { values: number[]; className?: string }) {
  const w = W / values.length;
  return (
    <g className={className}>
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * w + 2}
          y={GROUND - v}
          width={w - 4}
          height={v}
          rx={2}
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </g>
  );
}

function Limit({ y = 40 }: { y?: number }) {
  return (
    <g className="sv-limit">
      <line x1="0" x2={W} y1={y} y2={y} />
      {Array.from({ length: 17 }, (_, i) => (
        <circle key={i} cx={6 + i * 12} cy={y} r="1.5" />
      ))}
    </g>
  );
}

const VIZ: Record<string, () => ReactElement> = {
  spitzenwelle: () => (
    <>
      <Limit y={34} />
      <Bars className="sv-bars sv-wave" values={[14, 18, 26, 40, 58, 72, 64, 44, 28, 20, 16, 14]} />
    </>
  ),
  guillotine: () => (
    <>
      <Limit y={36} />
      <path className="sv-line" d="M0 52 L70 50 L84 92 L130 92 L140 56 L200 54" />
      <rect className="sv-blade" x="76" y="8" width="14" height="6" rx="1" />
    </>
  ),
  wetter: () => (
    <>
      <g className="sv-rain">
        {Array.from({ length: 14 }, (_, i) => (
          <line
            key={i}
            x1={8 + i * 14}
            y1={-10}
            x2={2 + i * 14}
            y2={10}
            style={{ animationDelay: `${(i % 5) * 160}ms` }}
          />
        ))}
      </g>
      <Limit y={42} />
      <Bars className="sv-bars sv-squeeze" values={[18, 22, 30, 48, 54, 50, 30, 22]} />
    </>
  ),
  gepaeckstau: () => (
    <>
      <line className="sv-belt" x1="10" x2="190" y1="88" y2="88" />
      <g className="sv-bags">
        {Array.from({ length: 9 }, (_, i) => (
          <rect
            key={i}
            x={14 + i * 14}
            y="74"
            width="11"
            height="11"
            rx="2"
            style={{ animationDelay: `${i * 220}ms` }}
          />
        ))}
      </g>
      <g className="sv-pile">
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={150 + (i % 2) * 13}
            y={74 - Math.floor(i / 2) * 13}
            width="11"
            height="11"
            rx="2"
          />
        ))}
      </g>
    </>
  ),
  personal: () => (
    <g className="sv-people">
      {Array.from({ length: 9 }, (_, i) => (
        <g
          key={i}
          transform={`translate(${18 + i * 20} 54)`}
          data-gone={i % 3 === 1 ? "" : undefined}
        >
          <circle cx="0" cy="0" r="5" />
          <path d="M-7 28 Q0 6 7 28" />
        </g>
      ))}
    </g>
  ),
  sicherheit: () => (
    <>
      <path className="sv-queue" d="M10 70 Q40 40 70 70 T130 70 T190 70" />
      <g className="sv-dots">
        {Array.from({ length: 12 }, (_, i) => (
          <circle
            key={i}
            r="3.2"
            style={
              {
                offsetPath: "path('M10 70 Q40 40 70 70 T130 70 T190 70')",
                animationDelay: `${-i * 520}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </g>
      <rect className="sv-gate" x="150" y="44" width="6" height="40" rx="2" />
    </>
  ),
  enteisung: () => (
    <>
      <rect className="sv-window" x="40" y="10" width="64" height="90" rx="4" />
      <g transform="translate(72 52)">
        <g className="sv-flake">
          {[0, 60, 120].map((a) => (
            <g key={a} transform={`rotate(${a})`}>
              <line x1="-18" x2="18" y1="0" y2="0" />
              <line x1="10" x2="15" y1="0" y2="-5" />
              <line x1="10" x2="15" y1="0" y2="5" />
              <line x1="-10" x2="-15" y1="0" y2="-5" />
              <line x1="-10" x2="-15" y1="0" y2="5" />
            </g>
          ))}
        </g>
      </g>
      <Limit y={30} />
      <Bars className="sv-bars sv-dim" values={[10, 12, 14, 16, 20, 24, 30, 36, 40, 44, 46, 48]} />
    </>
  ),
  schwarzstart: () => (
    <>
      <Limit y={36} />
      <path
        className="sv-line sv-ramp"
        d="M0 98 L60 98 L80 80 L100 80 L120 58 L140 58 L160 44 L200 44"
      />
      <g className="sv-lamps">
        {Array.from({ length: 8 }, (_, i) => (
          <circle
            key={i}
            cx={64 + i * 18}
            cy={110}
            r="3"
            style={{ animationDelay: `${i * 260}ms` }}
          />
        ))}
      </g>
    </>
  ),
};

export default function ScenarioViz({ slug }: { slug: string }) {
  const Viz = VIZ[slug];
  return (
    <svg
      className="aec-sv"
      viewBox={`0 0 ${W} ${H}`}
      data-viz={slug}
      aria-hidden="true"
      focusable="false"
    >
      <line className="sv-ground" x1="0" x2={W} y1={GROUND + 0.5} y2={GROUND + 0.5} />
      {Viz ? <Viz /> : null}
    </svg>
  );
}
