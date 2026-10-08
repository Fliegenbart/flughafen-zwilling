/** Die festgehaltenen Loesungen eines Projekts laden und waehrend der Berechnung nachfragen. */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVariantBoard } from "../../api/variants";
import type { Project, VariantBoard } from "../../types";
import { isRunning } from "./results";

const POLL_MS = 1500;
/** Nach Fehlschlaegen wird seltener gefragt, hoechstens alle 10 Sekunden. */
const SLOW_MS = 10000;
/** So oft in Folge darf eine Abfrage scheitern, solange nichts rechnet, bevor das Nachfragen endet. */
const MAX_MISSES = 5;

/**
 * `running` sagt, was der Server zuletzt meldete: Reisst die Verbindung ab, bleibt es dabei, und
 * `lost` zeigt den Abbruch. Solange es rechnet, fragt der Hook weiter, mit wachsendem Abstand.
 * Ein Aufruf von `reload` beginnt das Nachfragen neu.
 */
export function useBoard(project: Project | null) {
  const [board, setBoard] = useState<VariantBoard | null>(null);
  const [misses, setMisses] = useState(0);
  const latest = useRef(0);
  const pending = useRef(0);

  /** Holt die Tafel. Schlaegt das fehl, bleibt die letzte gute stehen. */
  const load = useCallback(async () => {
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

  /** Wie `load`, zaehlt aber die Fehlschlaege neu: Wer nachfragt, bekommt wieder alle Versuche. */
  const reload = useCallback(() => {
    setMisses(0);
    return load();
  }, [load]);

  useEffect(() => {
    // Ohne Projekt gilt keine laufende Antwort mehr.
    if (project) void load();
    else latest.current++;
  }, [project, load]);

  const running = !!board && isRunning(board);
  // Was gerade rechnet, wird weiter abgefragt. Sonst wiederholt der Hook nur einen Fehlschlag, auch
  // die erste Ladung, denn ohne Antwort sieht man nicht, was festgehalten ist oder rechnet.
  const polling = !!project && (running || (misses > 0 && misses < MAX_MISSES));
  const delay = Math.min(SLOW_MS, POLL_MS * 2 ** Math.max(0, misses - 1));
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = async () => {
      if (!pending.current) await load();
      if (alive) timer = setTimeout(() => void next(), delay);
    };
    timer = setTimeout(() => void next(), delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [polling, delay, load]);

  return { board, reload, running, lost: misses > 0 };
}
