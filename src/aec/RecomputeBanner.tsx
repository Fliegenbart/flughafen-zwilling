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
  onRun,
}: {
  state: ReturnType<typeof recomputeState>;
  busy: boolean;
  error: string;
  onRun: () => void;
}) {
  if (state === "aktuell") return null;
  const text =
    state === "laeuft"
      ? "Der Tag wird mit Ihren Werten neu gerechnet …"
      : state === "fehlt"
        ? "Für die Zusage ist der Tag noch nicht mit Ihren Werten gerechnet."
        : "Seit der letzten Rechnung haben sich Ihre Werte geändert, die Zusage zeigt noch den alten Stand.";
  return (
    <div className="aec-recompute" data-state={state} role="status">
      <p>
        {state === "veraltet" ? <strong className="aec-recompute__tag">veraltet</strong> : null}
        {text}
      </p>
      {state !== "laeuft" ? (
        <button type="button" className="aec-button" disabled={busy} onClick={onRun}>
          {busy ? "Wird gestartet …" : "Tag neu rechnen"}
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
