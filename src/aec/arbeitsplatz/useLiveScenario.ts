/**
 * Zustand des Arbeitsbildschirms: heutiger Tag, Regler-Stellung und was gerade zu sehen ist.
 *
 * Beim Ziehen rechnet der Browser sofort eine Naeherung (model/livePower). Nach einer kurzen
 * Pause holt er die genaue Vorschau vom Backend und ersetzt die Naeherung. Beispielprojekte ohne
 * Server bleiben bei der Naeherung auf einem synthetischen Referenztag.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  changesFor,
  extraVehiclesFor,
  getPreview,
  previewFromApi,
  type Preview,
} from "../api/preview";
import {
  leversFromBasis,
  resultFromExact,
  simulateLive,
  type Levers,
  type LiveResult,
} from "../model/livePower";
import type { Project } from "../types";

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
  /** Beispielprojekt ohne Server: nur Naeherung auf einem Referenztag. */
  sample: boolean;
  setLevers: (next: Levers) => void;
  reset: () => void;
};

const SETTLE_MS = 280;

async function loadToday(project: Project): Promise<{ preview: Preview; sample: boolean }> {
  if (project.source === "api") return { preview: await getPreview(project, {}), sample: false };
  const ref = await import("../model/__fixtures__/livePowerReference.json");
  const preview = previewFromApi(
    { ...ref.default.basis, kpis: ref.default.kpis },
    ref.default.departures,
  );
  if (!preview) throw new Error("Beispieltag fehlt.");
  return { preview, sample: true };
}

export function useLiveScenario(project: Project | null): Scenario {
  const [today, setToday] = useState<Preview | null>(null);
  const [sample, setSample] = useState(false);
  const [levers, setLeversState] = useState<Levers | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [exact, setExact] = useState<Preview | null>(null);
  const [accuracy, setAccuracy] = useState<Accuracy>("laedt");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    loadToday(project)
      .then(({ preview, sample: isSample }) => {
        if (!alive) return;
        const todayLevers = leversFromBasis(preview.basis);
        setToday(preview);
        setSample(isSample);
        setLeversState(todayLevers);
        setResult(resultFromExact(preview.basis));
        setExact(preview);
        setAccuracy("genau");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Der Tag ließ sich nicht rechnen.");
        setAccuracy("fehler");
      });
    return () => {
      alive = false;
      clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, [project]);

  const todayLevers = today ? leversFromBasis(today.basis) : null;
  const todayResult = today ? resultFromExact(today.basis) : null;

  const setLevers = useCallback(
    (next: Levers) => {
      if (!today || !project) return;
      setLeversState(next);
      setResult(simulateLive(today.basis, next));
      setExact(null);
      setAccuracy("naeherung");
      clearTimeout(timer.current);
      inflight.current?.abort();
      if (sample) return;
      const extra = extraVehiclesFor(next);
      const changes = {
        ...changesFor(next, leversFromBasis(today.basis)),
        ...(extra ? { extra_vehicles: extra } : {}),
      };
      timer.current = setTimeout(() => {
        const controller = new AbortController();
        inflight.current = controller;
        getPreview(project, changes, controller.signal)
          .then((p) => {
            if (controller.signal.aborted) return;
            setExact(p);
            setResult(resultFromExact(p.basis));
            setAccuracy("genau");
            setError("");
          })
          .catch((e: unknown) => {
            if (controller.signal.aborted) return;
            setError(e instanceof Error ? e.message : "Die genaue Rechnung ist fehlgeschlagen.");
          });
      }, SETTLE_MS);
    },
    [today, project, sample],
  );

  const reset = useCallback(() => {
    if (!today) return;
    clearTimeout(timer.current);
    inflight.current?.abort();
    setLeversState(leversFromBasis(today.basis));
    setResult(resultFromExact(today.basis));
    setExact(today);
    setAccuracy("genau");
  }, [today]);

  return {
    today,
    todayResult,
    todayLevers,
    levers,
    result,
    exact,
    accuracy,
    error,
    sample,
    setLevers,
    reset,
  };
}
