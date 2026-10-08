/**
 * Die Tageskurve: Was der Flughafen aus dem Netz braucht, gegen die Grenze des Anschlusses.
 * Ueber der Grenze: gruen, was die Batterie deckt; rot, was fehlt. Die heutige Kurve bleibt als
 * graue Linie stehen, sobald eine Stellschraube veraendert ist.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DepartureBin } from "../api/preview";
import { points, STEP, type Point } from "../model/dayCurve";
import { clock, powerText } from "../model/format";
import { shortfallHeadline, worstShortfall } from "../model/headline";
import type { LiveResult } from "../model/livePower";

const H = 360;
const DEP_H = 96;
const PAD = { left: 52, right: 16, top: 44, bottom: 28 };

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
  // Zeiger: mit der Maus ueber dem Diagramm, oder mit dem Schieber darunter (Tastatur, Touch).
  const [hover, setHover] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
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
  // Nennwert des Anschlusses; Stoerungen druecken die Linie nur zeitweise darunter.
  const capNow = Math.max(0, ...pts.map((p) => p.cap).filter(Number.isFinite));
  // Das Anschluss-Schild steht dort, wo die Kurve am laengsten weit unter der Grenze bleibt.
  const labelAt = (() => {
    let best = { len: 0, mid: pts.length / 2 };
    for (let i = 0, from = -1; i <= pts.length; i++) {
      const roomy = i < pts.length && pts[i]!.need < pts[i]!.cap - 300;
      if (roomy && from < 0) from = i;
      if (!roomy && from >= 0) {
        if (i - from > best.len) best = { len: i - from, mid: (from + i) / 2 };
        from = -1;
      }
    }
    return pts[Math.min(pts.length - 1, Math.floor(best.mid))]?.m ?? 0;
  })();
  const worst = worstShortfall(result);
  // Der Satz zur Engstelle steht mittig ueber ihr, aber nie ausserhalb der Grafik.
  const noteText = worst
    ? `${clock(worst.start)}–${clock(worst.end)} Uhr: bis zu ${powerText(worst.maxMissingKw)} fehlen`
    : "";
  const noteHalf = noteText.length * 4.6;
  const noteX = worst
    ? Math.min(
        width - PAD.right - noteHalf,
        Math.max(PAD.left + noteHalf, x((worst.start + worst.end) / 2)),
      )
    : 0;
  const ticks = Array.from({ length: Math.floor(top / 1000) + 1 }, (_, i) => i * 1000);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const maxDep = Math.max(1, ...departures.map((d) => d.count));
  const cursor = hover ?? scrub;
  const hp = cursor != null ? pts[Math.min(pts.length - 1, Math.round(cursor / STEP))] : null;
  const readout = hp
    ? `${clock(hp.m)} Uhr: ${powerText(hp.need)} gebraucht${
        hp.miss > 0.5
          ? `, ${powerText(hp.miss)} fehlen`
          : hp.cover > 0.5
            ? `, Batterie gibt ${powerText(hp.cover)}`
            : ""
      }`
    : "";

  return (
    <figure className="ap-chart" ref={box}>
      <svg
        width={width}
        height={H + DEP_H}
        viewBox={`0 0 ${width} ${H + DEP_H}`}
        style={{ maxWidth: "100%", height: "auto" }}
        role="img"
        aria-label={shortfallHeadline(result)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // Die Grafik kann kleiner dargestellt werden als gezeichnet (Druck, schmale Fenster).
          const px = (e.clientX - rect.left) * (width / rect.width);
          const m = ((px - PAD.left) / w) * dayMin;
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
        <text className="ap-chart__limitlabel" x={x(labelAt)} y={y(capNow) - 8} textAnchor="middle">
          Netzanschluss {powerText(capNow)}
        </text>
        {worst ? (
          <g className="ap-chart__note">
            <line x1={x(worst.start)} x2={x(worst.end)} y1={PAD.top - 14} y2={PAD.top - 14} />
            <text x={noteX} y={PAD.top - 22} textAnchor="middle">
              {noteText}
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
      <input
        type="range"
        className="ap-scrub"
        aria-label="Uhrzeit im Tagesverlauf"
        aria-valuetext={readout || undefined}
        min={0}
        max={dayMin - STEP}
        step={STEP}
        value={scrub ?? 0}
        onChange={(e) => setScrub(Number(e.target.value))}
        onBlur={() => setScrub(null)}
      />
      <figcaption className="ap-chart__readout" aria-live="polite">
        {readout}
      </figcaption>
    </figure>
  );
}
