/** Die festgehaltenen Loesungen eines Projekts laden und waehrend der Berechnung nachfragen. */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVariantBoard } from "../../api/variants";
import type { Project, VariantBoard } from "../../types";

const POLL_MS = 1500;
/** So oft in Folge darf das Nachfragen scheitern, bevor es aufhoert. */
const MAX_MISSES = 5;

export function useBoard(project: Project | null) {
  const [board, setBoard] = useState<VariantBoard | null>(null);
  const [misses, setMisses] = useState(0);
  const latest = useRef(0);
  const pending = useRef(0);

  /** Holt die Tafel. Schlaegt das fehl, bleibt die letzte gute stehen. */
  const reload = useCallback(async () => {
    if (!project) return null;
    const mine = ++latest.current;
    pending.current++;
    try {
      const next = await fetchVariantBoard(project);
      // Eine aeltere Antwort darf keine neuere ueberschreiben.
      if (mine === latest.current) {
        setBoard(next);
        setMisses(0);
      }
      return next;
    } catch {
      if (mine === latest.current) setMisses((n) => n + 1);
      return null;
    } finally {
      pending.current--;
    }
  }, [project]);

  useEffect(() => {
    // Ohne Projekt gilt keine laufende Antwort mehr.
    if (project) void reload();
    else latest.current++;
  }, [project, reload]);

  const active = board?.run?.status === "queued" || board?.run?.status === "running";
  // Auch die erste Ladung wird wiederholt; ohne Antwort gibt es nichts, woran man sieht, was laeuft.
  const polling = (active || (!board && misses > 0)) && misses < MAX_MISSES;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (!pending.current) void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, reload]);

  return { board, reload, running: active && misses < MAX_MISSES, lost: misses > 0 };
}
