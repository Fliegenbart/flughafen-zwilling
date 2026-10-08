/**
 * Die Tageskurve: Was der Flughafen aus dem Netz braucht, gegen die Grenze des Anschlusses.
 * Ueber der Grenze: gruen, was die Batterie deckt; rot, was fehlt. Die heutige Kurve bleibt als
 * graue Linie stehen, sobald eine Stellschraube veraendert ist.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DepartureBin } from "../api/preview";
import { clock, powerText } from "../model/format";
import type { LiveResult } from "../model/livePower";

const STEP = 5; // Minuten je Kurvenpunkt
const H = 360;
const DEP_H = 96;
const PAD = { left: 52, right: 16, top: 44, bottom: 28 };

type Point = { m: number; need: number; cap: number; cover: number; miss: number };

/** Je 5 Minuten: Mittel fuer die Linie, Maximum fuer Fehlendes (nichts darf verschwinden). */
function points(r: LiveResult): Point[] {
  const out: Point[] = [];
  for (let m = 0; m < r.importKw.length; m += STEP) {
    let need = 0;
    let cover = 0;
    let miss = 0;
    let cap = Infinity;
    const end = Math.min(r.importKw.length, m + STEP);
    for (let i = m; i < end; i++) {
      const discharge = Math.max(0, r.batteryKw[i]!);
      const n = r.importKw[i]! + discharge + r.missingKw[i]!;
      need = Math.max(need, n);
      cover = Math.max(cover, discharge);
      miss = Math.max(miss, r.missingKw[i]!);
      cap = Math.min(cap, r.capKw[i]!);
    }
    out.push({ m, need, cap, cover, miss });
  }
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function LoadChart({
  result,
  today,
  departures,
  changed,
}: {
  result: LiveResult;
  today: LiveResult;
  departures: DepartureBin[];
  changed: boolean;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => points(result), [result]);
  const base = useMemo(() => points(today), [today]);
  const dayMin = result.importKw.length || 1440;
  const top =
    Math.ceil(
      Math.max(...pts.map((p) => Math.max(p.need, p.cap)), ...base.map((p) => p.need)) / 500,
    ) *
      500 +
    250;
  const w = width - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / dayMin) * w;
  const y = (kw: number) => PAD.top + h - (kw / top) * h;
  const line = (ps: Point[], f: (p: Point) => number) =>
    ps.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(f(p)).toFixed(1)}`).join("");
  // Flaechen ueber der Grenze: Batterie (gruen) unten, Fehlendes (rot) darueber.
  const band = (lo: (p: Point) => number, hi: (p: Point) => number) => {
    const upper = pts.map((p) => `${x(p.m).toFixed(1)},${y(hi(p)).toFixed(1)}`);
    const lower = [...pts].reverse().map((p) => `${x(p.m).toFixed(1)},${y(lo(p)).toFixed(1)}`);
    return `M${upper.join("L")}L${lower.join("L")}Z`;
  };
  const coverTop = (p: Point) => (p.cover > 0.5 ? p.cap + p.cover : p.cap);
  const missTop = (p: Point) => coverTop(p) + (p.miss > 0.5 ? p.miss : 0);
  const capNow = pts[0]?.cap ?? 0;
  const worst = result.shortfalls.reduce<LiveResult["shortfalls"][number] | null>(
    (a, s) => (!a || s.maxMissingKw > a.maxMissingKw ? s : a),
    null,
  );
  const ticks = Array.from({ length: Math.floor(top / 1000) + 1 }, (_, i) => i * 1000);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const maxDep = Math.max(1, ...departures.map((d) => d.count));
  const hp = hover != null ? pts[Math.min(pts.length - 1, Math.round(hover / STEP))] : null;

  return (
    <figure className="ap-chart" ref={box}>
      <svg
        width={width}
        height={H + DEP_H}
        role="img"
        aria-label={
          worst
            ? `Von ${clock(worst.start)} bis ${clock(worst.end)} Uhr fehlen bis zu ${powerText(worst.maxMissingKw)}.`
            : "Der Anschluss reicht den ganzen Tag."
        }
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const m = ((e.clientX - rect.left - PAD.left) / w) * dayMin;
          setHover(m >= 0 && m <= dayMin ? m : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t} className="ap-chart__grid">
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {t / 1000} MW
            </text>
          </g>
        ))}
        {changed ? <path className="ap-chart__today" d={line(base, (p) => p.need)} /> : null}
        <path className="ap-chart__cover" d={band((p) => p.cap, coverTop)} />
        <path className="ap-chart__miss" d={band(coverTop, missTop)} />
        <path className="ap-chart__need" d={line(pts, (p) => p.need)} />
        <path className="ap-chart__limit" d={line(pts, (p) => p.cap)} />
        <text
          className="ap-chart__limitlabel"
          x={width - PAD.right}
          y={y(capNow) - 8}
          textAnchor="end"
        >
          Netzanschluss {powerText(capNow)}
        </text>
        {worst ? (
          <g className="ap-chart__note">
            <line x1={x(worst.start)} x2={x(worst.end)} y1={PAD.top - 14} y2={PAD.top - 14} />
            <text x={x(worst.start)} y={PAD.top - 22}>
              {clock(worst.start)}–{clock(worst.end)} Uhr: bis zu {powerText(worst.maxMissingKw)}{" "}
              fehlen
            </text>
          </g>
        ) : (
          <text className="ap-chart__ok" x={PAD.left} y={PAD.top - 22}>
            Der Anschluss reicht den ganzen Tag.
          </text>
        )}
        {hours.map((hr) => (
          <text key={hr} className="ap-chart__hour" x={x(hr * 60)} y={H - 8} textAnchor="middle">
            {hr}
          </text>
        ))}
        {departures.map((d) => {
          const bw = (30 / dayMin) * w - 2;
          const bh = (d.count / maxDep) * (DEP_H - 18);
          const dh = (d.delayed / maxDep) * (DEP_H - 18);
          return (
            <g key={d.startMin}>
              <rect
                className="ap-chart__dep"
                x={x(d.startMin) + 1}
                y={H + DEP_H - 4 - bh}
                width={bw}
                height={bh}
              />
              {d.delayed ? (
                <rect
                  className="ap-chart__late"
                  x={x(d.startMin) + 1}
                  y={H + DEP_H - 4 - dh}
                  width={bw}
                  height={dh}
                />
              ) : null}
            </g>
          );
        })}
        <text className="ap-chart__deplabel" x={PAD.left} y={H + 10}>
          Abflüge je halbe Stunde
          {departures.some((d) => d.delayed) ? ", rot: nicht rechtzeitig fertig" : ""}
        </text>
        {hp ? (
          <g className="ap-chart__cursor">
            <line x1={x(hp.m)} x2={x(hp.m)} y1={PAD.top} y2={PAD.top + h} />
            <circle cx={x(hp.m)} cy={y(hp.need)} r={4} />
          </g>
        ) : null}
      </svg>
      <figcaption className="ap-chart__readout" aria-live="polite">
        {hp
          ? `${clock(hp.m)} Uhr: ${powerText(hp.need)} gebraucht${
              hp.miss > 0.5
                ? `, ${powerText(hp.miss)} fehlen`
                : hp.cover > 0.5
                  ? `, Batterie gibt ${powerText(hp.cover)}`
                  : ""
            }`
          : ""}
      </figcaption>
    </figure>
  );
}
