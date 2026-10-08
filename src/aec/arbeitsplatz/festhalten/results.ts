/**
 * Was von der letzten Berechnung noch zu den festgehaltenen Loesungen passt. Festhalten (Schritt B)
 * und Zusage (Schritt C) zeigen dieselbe Tafel, also entscheidet diese Datei, was davon gilt.
 */
import type { VariantBoard, VariantDefinition } from "../../types";

/** Warum die Tabelle nicht (mehr) zu den festgehaltenen Loesungen passt; null = sie passt. */
export type Outdated = "never" | "definitions" | "inputs" | "failed";

export const isRunning = (board: VariantBoard) =>
  board.run?.status === "queued" || board.run?.status === "running";

/** Festgehaltene Loesungen ohne Zeile in der letzten Berechnung (neu dazugekommen oder gescheitert). */
export const withoutResult = (board: VariantBoard): VariantDefinition[] =>
  board.definitions.filter((d) => !board.variants.some((v) => v.id === d.id));

export function outdatedReason(board: VariantBoard): Outdated | null {
  if (board.source !== "api" || !board.definitions.length) return null;
  if (!board.run) return "never";
  if (board.run.stale) return "definitions";
  if (board.run.inputsStale) return "inputs";
  return withoutResult(board).length ? "failed" : null;
}

/** Ein Satz dazu, was fehlt; leer, wenn die Tabelle passt. */
export function outdatedNote(board: VariantBoard): string {
  switch (outdatedReason(board)) {
    case "never":
      return "Die festgehaltenen Lösungen sind noch nicht gerechnet.";
    case "definitions":
      return "Die Auswahl hat sich geändert.";
    case "inputs":
      return "Ihre Daten haben sich seit der Berechnung geändert.";
    case "failed": {
      const missing = withoutResult(board);
      return missing.length === 1
        ? `„${missing[0]!.name}“ ließ sich nicht rechnen.`
        : `${missing.length} Lösungen ließen sich nicht rechnen.`;
    }
    default:
      return "";
  }
}

/**
 * Die Tafel so, wie sie jetzt gilt: ohne Zeilen entfernter Loesungen, ohne Antwortsatz ueber eine
 * alte Auswahl und ohne Tabelle, wenn die Projektwerte seither anders sind.
 */
export function currentBoard(board: VariantBoard): VariantBoard {
  const ids = new Set(board.definitions.map((d) => d.id));
  const rows = board.variants.filter((v) => v.kind === "basis" || ids.has(v.id));
  const reason = outdatedReason(board);
  const show = rows.some((v) => v.kind !== "basis") && reason !== "inputs";
  return {
    ...board,
    variants: show ? rows : [],
    answer: show && reason === null ? board.answer : null,
  };
}
