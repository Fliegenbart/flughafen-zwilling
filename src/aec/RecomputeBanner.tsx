import type { VariantBoard } from "./types";

/** Zustand des Projekt-Basislaufs gegenueber den aktuellen Projektwerten. */
export function recomputeState(
  board: VariantBoard | null,
): "aktuell" | "veraltet" | "fehlt" | "laeuft" {
  if (!board || board.source !== "api" || !board.base) return "aktuell";
  if (board.run && (board.run.status === "queued" || board.run.status === "running"))
    return "laeuft";
  if (!board.run) return "fehlt";
  return board.run.inputsStale ? "veraltet" : "aktuell";
}

export default function RecomputeBanner({
  state,
  busy,
  error,
  solutions = 0,
  lost = false,
  onRun,
}: {
  state: ReturnType<typeof recomputeState>;
  busy: boolean;
  error: string;
  /** Wie viele Lösungen festgehalten sind; sie rechnen mit, wenn der Knopf gedrückt wird. */
  solutions?: number;
  /** Die letzte Abfrage ist gescheitert, die Seite zeigt den Stand von vorher. */
  lost?: boolean;
  onRun: () => void;
}) {
  if (state === "aktuell" && !lost) return null;
  const text =
    state === "laeuft"
      ? `Wir rechnen den Tag${solutions ? " und Ihre Lösungen" : ""} mit Ihren Werten neu …`
      : state === "fehlt"
        ? "Für die Zusage ist der Tag noch nicht mit Ihren Werten gerechnet."
        : "Seit der letzten Rechnung haben sich Ihre Werte geändert, die Zusage zeigt noch den alten Stand.";
  return (
    <div className="aec-recompute" data-state={state} role="status">
      {state !== "aktuell" ? (
        <p>
          {state === "veraltet" ? <strong className="aec-recompute__tag">veraltet</strong> : null}
          {text}
        </p>
      ) : null}
      {lost ? (
        <p>Die Verbindung zum Server ist unterbrochen, der Stand kann veraltet sein.</p>
      ) : null}
      {state === "veraltet" || state === "fehlt" ? (
        <button type="button" className="aec-button" disabled={busy} onClick={onRun}>
          {busy
            ? "Wir starten die Rechnung …"
            : solutions
              ? "Tag und Lösungen neu rechnen"
              : "Tag neu rechnen"}
        </button>
      ) : null}
      {error ? (
        <p className="aec-derror" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
