/**
 * Zustand des Arbeitsbildschirms: heutiger Tag, Regler-Stellung und was gerade zu sehen ist.
 *
 * Beim Ziehen rechnet der Browser sofort eine Naeherung (model/livePower). Nach einer kurzen
 * Pause holt er die genaue Vorschau vom Backend und ersetzt die Naeherung. Beispielprojekte ohne
 * Server bleiben bei der Naeherung auf einem synthetischen Referenztag.
 *
 * Es laeuft nie mehr als eine genaue Anfrage zugleich: Der Server rechnet eine begonnene Vorschau
 * zu Ende, auch wenn der Browser sie laengst abgebrochen hat. Wer weiterzieht, wartet also auf
 * die laufende und schickt dann nur die neueste Stellung.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPreview,
  isDataProblem,
  previewBodyFor,
  type Preview,
  type PreviewBody,
} from "../api/preview";
import {
  leversFromBasis,
  resultFromExact,
  simulateLive,
  type Levers,
  type LiveResult,
} from "../model/livePower";
import { samplePreview } from "../sample";
import type { Project } from "../types";
import { clampToRanges } from "./levers";

export type Accuracy = "laedt" | "naeherung" | "genau" | "fehler";

export type Scenario = {
  today: Preview | null;
  todayResult: LiveResult | null;
  todayLevers: Levers | null;
  levers: Levers | null;
  result: LiveResult | null;
  /** Genaue Vorschau zur aktuellen Stellung, solange sie zur Stellung passt. */
  exact: Preview | null;
  accuracy: Accuracy;
  error: string;
  /** Der Fehler liegt an den Daten des Projekts (Flugplan fehlt, Werte widersprechen sich). */
  errorInData: boolean;
  /** Beispielprojekt ohne Server: nur Naeherung auf einem Referenztag. */
  sample: boolean;
  setLevers: (next: Levers) => void;
  reset: () => void;
};

const SETTLE_MS = 280;

/** Regler-Stellung von heute, inklusive der Laderegel, mit der gerechnet wurde. */
export const startLevers = (p: Preview): Levers => ({
  ...leversFromBasis(p.basis),
  ...(p.policy ? { policy: p.policy } : {}),
});

/** Ohne Server rechnet nur die Naeherung: Laderegel, Fahrzeuge und Krisenfall gehen nicht. */
const approximable = ({ gridLimitKw, batteryKwh, batteryKw, pvFactor }: Partial<Levers>) =>
  Object.fromEntries(
    Object.entries({ gridLimitKw, batteryKwh, batteryKw, pvFactor }).filter(
      ([, v]) => v !== undefined,
    ),
  ) as Partial<Levers>;

const problemOf = (e: unknown, fallback: string) => ({
  message: e instanceof Error ? e.message : fallback,
  inData: isDataProblem(e),
});

async function loadToday(project: Project): Promise<{ preview: Preview; sample: boolean }> {
  if (project.source === "api") return { preview: await getPreview(project, {}), sample: false };
  return { preview: samplePreview(), sample: true };
}

/**
 * `initial`: Stellung, mit der der Bildschirm nach dem Laden gleich startet (zuletzt benutzte
 * Regler oder ein Krisenfall aus der Adresse). Muss stabil sein, sonst laedt der Tag neu.
 */
export function useLiveScenario(project: Project | null, initial?: Partial<Levers>): Scenario {
  const [today, setToday] = useState<Preview | null>(null);
  const [sample, setSample] = useState(false);
  const [levers, setLeversState] = useState<Levers | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [exact, setExact] = useState<Preview | null>(null);
  const [accuracy, setAccuracy] = useState<Accuracy>("laedt");
  const [problem, setProblem] = useState<{ message: string; inData: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Neueste gewuenschte Anfrage; sie wartet, solange eine andere laeuft. */
  const queued = useRef<{ at: number; project: Project; body: PreviewBody } | null>(null);
  const busy = useRef(false);
  /** Zaehlt jede neue Absicht (Regler, Zuruecksetzen, Wechsel); Antworten auf aeltere gelten nicht. */
  const epoch = useRef(0);

  const invalidate = useCallback(() => {
    epoch.current++;
    queued.current = null;
    clearTimeout(timer.current);
  }, []);

  /** Schickt die neueste Anfrage nach kurzer Pause, sobald keine andere mehr laeuft. */
  const pump = useCallback(function pump() {
    clearTimeout(timer.current);
    const w = queued.current;
    if (!w || busy.current) return;
    timer.current = setTimeout(
      () => {
        queued.current = null;
        busy.current = true;
        const mine = epoch.current;
        getPreview(w.project, w.body)
          .then((p) => {
            if (mine !== epoch.current) return;
            setExact(p);
            setResult(resultFromExact(p.basis));
            setAccuracy("genau");
            setProblem(null);
          })
          .catch((e: unknown) => {
            if (mine === epoch.current)
              setProblem(problemOf(e, "Die genaue Rechnung ist fehlgeschlagen."));
          })
          .finally(() => {
            busy.current = false;
            pump();
          });
      },
      // Hat die Pause waehrend einer laufenden Anfrage schon verstrichen, geht es sofort los.
      Math.min(SETTLE_MS, Math.max(0, w.at + SETTLE_MS - Date.now())),
    );
  }, []);

  /** Genaue Rechnung nach kurzer Pause; die neueste Stellung ersetzt aeltere. */
  const requestExact = useCallback(
    (proj: Project, base: Preview, next: Levers) => {
      epoch.current++;
      queued.current = {
        at: Date.now(),
        project: proj,
        body: previewBodyFor(next, startLevers(base)),
      };
      setProblem(null);
      pump();
    },
    [pump],
  );

  useEffect(() => {
    if (!project) return;
    let alive = true;
    loadToday(project)
      .then(({ preview, sample: isSample }) => {
        if (!alive) return;
        const todayLevers = startLevers(preview);
        setToday(preview);
        setSample(isSample);
        setProblem(null);
        const wanted = clampToRanges(
          isSample ? approximable(initial ?? {}) : (initial ?? {}),
          todayLevers,
        );
        const start: Levers = { ...todayLevers, ...wanted };
        if (JSON.stringify(start) === JSON.stringify(todayLevers)) {
          setLeversState(todayLevers);
          setResult(resultFromExact(preview.basis));
          setExact(preview);
          setAccuracy("genau");
          return;
        }
        // Gleich mit der gemerkten oder aus der Adresse gelesenen Stellung starten.
        setLeversState(start);
        setResult(simulateLive(preview.basis, start));
        setExact(null);
        setAccuracy("naeherung");
        if (!isSample) requestExact(project, preview, start);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setProblem(problemOf(e, "Der Tag ließ sich nicht rechnen."));
        setAccuracy("fehler");
      });
    return () => {
      alive = false;
      invalidate();
    };
  }, [project, initial, requestExact, invalidate]);

  const todayLevers = useMemo(() => (today ? startLevers(today) : null), [today]);
  const todayResult = useMemo(() => (today ? resultFromExact(today.basis) : null), [today]);

  const setLevers = useCallback(
    (next: Levers) => {
      if (!today || !project) return;
      setLeversState(next);
      setResult(simulateLive(today.basis, next));
      setExact(null);
      setAccuracy("naeherung");
      if (!sample) requestExact(project, today, next);
    },
    [today, project, sample, requestExact],
  );

  const reset = useCallback(() => {
    if (!today || !todayLevers) return;
    invalidate();
    setLeversState(todayLevers);
    setResult(resultFromExact(today.basis));
    setExact(today);
    setAccuracy("genau");
    setProblem(null);
  }, [today, todayLevers, invalidate]);

  return {
    today,
    todayResult,
    todayLevers,
    levers,
    result,
    exact,
    accuracy,
    error: problem?.message ?? "",
    errorInData: problem?.inData ?? false,
    sample,
    setLevers,
    reset,
  };
}
