import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { clock, power, powerText } from "./model/format";
import { limitWindows, pointAt } from "./model/situation";
import type { Situation } from "./types";

type Props = {
  situation: Situation;
  /** Laesst den Cursor einmal durch den Tag laufen, bis jemand eingreift. */
  autoplay?: boolean;
  size?: "hero" | "panel";
  label?: string;
  onMinute?: (minute: number) => void;
};

const DAY = 1440;
const reducedMotion = () => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

/**
 * Lagebild des Tages: Lastgang als Landschaft gegen die Anschlussgrenze (Haltebalken),
 * Abflugwellen als Befeuerung darunter, Engpassfenster leuchten signalgelb.
 * Per Zeiger oder Tastatur durch den Tag scrubben (Pfeile 5 min, Bild 1 h, Pos1/Ende).
 */
export default function DayLandscape({
  situation,
  autoplay = false,
  size = "panel",
  label,
  onMinute,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const windows = useMemo(() => limitWindows(situation), [situation]);
  const initial = windows[0]?.start ?? 7 * 60;
  const [minute, setMinute] = useState(autoplay && !reducedMotion() ? 0 : initial);
  const [playing, setPlaying] = useState(autoplay && !reducedMotion());

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () =>
      setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width) || 960));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      // 24 h in 12 s, danach Halt auf dem Engpass
      const m = ((t - start) / 12000) * DAY;
      if (m >= DAY) {
        setMinute(initial);
        setPlaying(false);
        return;
      }
      setMinute(m);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, initial]);

  useEffect(() => onMinute?.(minute), [minute, onMinute]);

  const compact = width < 640;
  const H = size === "hero" ? (compact ? 300 : 420) : compact ? 260 : 320;
  const padL = compact ? 8 : 16;
  const padR = compact ? 8 : 16;
  const top = 28;
  const lightsH = compact ? 44 : 60;
  const axisH = 26;
  const baseY = H - lightsH - axisH;
  const plotW = width - padL - padR;
  const peak = situation.load.reduce((m, p) => Math.max(m, p.demandKw), 0);
  const yMax = Math.max(peak, situation.gridLimitKw) * 1.14 || 1;
  const x = (m: number) => padL + (m / DAY) * plotW;
  const y = (kw: number) => baseY - (kw / yMax) * (baseY - top);
  const limitY = y(situation.gridLimitKw);

  const paths = useMemo(() => {
    const pts = situation.load;
    if (!pts.length) return { demand: "", demandArea: "", base: "" };
    const line = (get: (p: (typeof pts)[number]) => number) =>
      pts
        .map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)},${y(get(p)).toFixed(1)}`)
        .join("");
    const last = pts[pts.length - 1]!;
    const close = `L${x(last.minute + situation.stepMinutes).toFixed(1)},${baseY}L${x(pts[0]!.minute).toFixed(1)},${baseY}Z`;
    const demand = line((p) => p.demandKw);
    return {
      demand,
      demandArea: `${demand}${close}`,
      base: `${line((p) => Math.min(p.baseKw, p.demandKw))}${close}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, width, H]);

  const maxDeps = Math.max(1, ...situation.departures.map((d) => d.count));
  const slotW = plotW / 48;
  const now = pointAt(situation, minute);
  const over = now.reserveKw < 0 || (situation.kind === "bezug" && now.reserveKw <= 0.5);
  const inWindow = windows.some((w) => minute >= w.start && minute < w.end);
  const cx = x(minute);
  const cy = y(now.demandKw);
  const demandLabel = situation.kind === "bezug" ? "aus dem Netz" : "Strombedarf";

  const select = (m: number) => {
    setPlaying(false);
    setMinute(Math.max(0, Math.min(DAY - situation.stepMinutes, m)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 60 : situation.stepMinutes;
    const map: Record<string, number> = {
      ArrowRight: minute + step,
      ArrowUp: minute + step,
      ArrowLeft: minute - step,
      ArrowDown: minute - step,
      PageUp: minute + 60,
      PageDown: minute - 60,
      Home: 0,
      End: DAY,
    };
    if (e.key in map) {
      e.preventDefault();
      select(Math.round(map[e.key]! / situation.stepMinutes) * situation.stepMinutes);
    } else if (e.key === "Escape") setPlaying(false);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = ((e.clientX - rect.left - padL) / Math.max(1, plotW)) * DAY;
    select(Math.round(m / situation.stepMinutes) * situation.stepMinutes);
  };

  const p = power(now.demandKw);
  const reserve = powerText(Math.abs(now.reserveKw));
  const valueText = `${clock(minute)} Uhr: ${demandLabel} ${p.value} ${p.unit}, ${
    over
      ? situation.kind === "bezug"
        ? "Anschluss voll ausgelastet"
        : `es fehlen ${reserve}`
      : `noch ${reserve} frei`
  }, ${now.departures} Abflüge in dieser halben Stunde${inWindow ? ", knappe Phase" : ""}.`;
  const readoutLeft = Math.min(Math.max(cx, 90), width - 90);

  return (
    <figure className={`aec-land aec-land--${size}`} data-playing={playing ? "" : undefined}>
      <div
        ref={wrap}
        className="aec-land__stage"
        role="slider"
        tabIndex={0}
        aria-label={label ?? "Uhrzeit im Tagesverlauf"}
        aria-valuemin={0}
        aria-valuemax={DAY - situation.stepMinutes}
        aria-valuenow={Math.round(minute)}
        aria-valuetext={valueText}
        aria-describedby={`${uid}-sum`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || e.pointerType === "mouse") fromPointer(e);
        }}
        style={{ height: H }}
      >
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${uid}-land`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--night-land-top)" stopOpacity="0.95" />
              <stop offset="1" stopColor="var(--night-land-bottom)" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id={`${uid}-glow`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--night-signal)" stopOpacity="0" />
              <stop offset="0.55" stopColor="var(--night-signal)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--night-signal)" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`${uid}-above`}>
              <rect x="0" y="0" width={width} height={Math.max(0, limitY)} />
            </clipPath>
            <clipPath id={`${uid}-reveal`}>
              <rect className="aec-land__reveal" x="0" y="0" width={width} height={H} />
            </clipPath>
            <pattern id={`${uid}-stopbar`} width="12" height="6" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.6" fill="var(--night-stop)" />
            </pattern>
          </defs>

          {/* Stunden-Raster wie Rollwegfugen */}
          {Array.from({ length: 25 }, (_, h) => (
            <line
              key={h}
              x1={x(h * 60)}
              x2={x(h * 60)}
              y1={top - 8}
              y2={baseY}
              className={h % 6 === 0 ? "aec-land__grid aec-land__grid--major" : "aec-land__grid"}
            />
          ))}

          {/* Engpassfenster: leuchtender Korridor */}
          {windows.map((w) => (
            <rect
              key={w.start}
              className="aec-land__window"
              x={x(w.start)}
              y={top - 8}
              width={Math.max(2, x(w.end) - x(w.start))}
              height={baseY - top + 8}
              fill={`url(#${uid}-glow)`}
            />
          ))}

          <g clipPath={`url(#${uid}-reveal)`}>
            <path d={paths.demandArea} fill={`url(#${uid}-land)`} />
            <path d={paths.base} className="aec-land__base" />
            {/* Teil oberhalb der Grenze: Signal */}
            <path d={paths.demandArea} clipPath={`url(#${uid}-above)`} className="aec-land__over" />
            <path d={paths.demand} className="aec-land__line" />
          </g>

          {/* Haltebalken = Anschlussgrenze */}
          <rect x={padL} y={limitY - 3} width={plotW} height={6} fill={`url(#${uid}-stopbar)`} />
          <line x1={padL} x2={padL + plotW} y1={limitY} y2={limitY} className="aec-land__limit" />

          {/* Flugwellen als Befeuerung */}
          {situation.departures.map((d) => {
            const h = (d.count / maxDeps) * (lightsH - 14);
            return (
              <rect
                key={d.minute}
                className="aec-land__dep"
                x={x(d.minute) + 1.5}
                y={H - axisH - h - 4}
                width={Math.max(1, slotW - 3)}
                height={Math.max(1.5, h)}
                rx={Math.min(2, slotW / 4)}
                data-active={minute >= d.minute && minute < d.minute + 30 ? "" : undefined}
              />
            );
          })}
          <line
            x1={padL}
            x2={padL + plotW}
            y1={baseY + 0.5}
            y2={baseY + 0.5}
            className="aec-land__ground"
          />

          {/* Zeitachse */}
          {[0, 3, 6, 9, 12, 15, 18, 21, 24]
            .filter((h) => !compact || h % 6 === 0)
            .map((h) => (
              <text
                key={h}
                x={x(h * 60)}
                y={H - 8}
                className="aec-land__tick"
                textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
              >
                {String(h).padStart(2, "0")}:00
              </text>
            ))}

          {/* Cursor */}
          <line x1={cx} x2={cx} y1={top - 8} y2={H - axisH} className="aec-land__cursor" />
          <circle
            cx={cx}
            cy={cy}
            r={5}
            className="aec-land__dot"
            data-over={over ? "" : undefined}
          />
        </svg>

        <div className="aec-land__limit-label" style={{ top: Math.max(4, limitY - 26) }}>
          Netzanschluss <b>{powerText(situation.gridLimitKw)}</b>
        </div>
        <div
          className="aec-land__readout"
          style={{ left: readoutLeft }}
          data-over={over ? "" : undefined}
          aria-hidden="true"
        >
          <span className="aec-land__time">{clock(minute)}</span>
          <span>
            {demandLabel} <b>{p.value}</b> {p.unit}
          </span>
          <span className="aec-land__reserve">
            {over
              ? situation.kind === "bezug"
                ? "voll ausgelastet"
                : `fehlen ${reserve}`
              : `noch ${reserve} frei`}
          </span>
        </div>
        <div className="aec-land__lights-label" aria-hidden="true">
          Abflüge je halbe Stunde
        </div>
      </div>
      <figcaption id={`${uid}-sum`} className="aec-land__caption">
        {windows.length
          ? `Knapp wird es ${windows.map((w) => `${clock(w.start)}–${clock(w.end)} Uhr`).join(", ")}. `
          : "Der Anschluss reicht den ganzen Tag. "}
        Mit den Pfeiltasten gehen Sie durch den Tag, mit Umschalt oder Bild-Tasten in
        Stundenschritten.
      </figcaption>
    </figure>
  );
}
