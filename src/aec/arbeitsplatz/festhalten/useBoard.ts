/** Die festgehaltenen Loesungen eines Projekts laden und waehrend der Berechnung nachfragen. */
import { useCallback, useEffect, useState } from "react";
import { getVariantBoard } from "../../api/variants";
import type { Project, VariantBoard } from "../../types";

const POLL_MS = 1500;

export function useBoard(project: Project | null) {
  const [board, setBoard] = useState<VariantBoard | null>(null);
  const reload = useCallback(async () => {
    if (!project) return null;
    const next = await getVariantBoard(project);
    setBoard(next);
    return next;
  }, [project]);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    void getVariantBoard(project).then((next) => alive && setBoard(next));
    return () => {
      alive = false;
    };
  }, [project]);

  const running = board?.run?.status === "queued" || board?.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  return { board, reload, running };
}
