/** Die festgehaltenen Loesungen in der Zusage: der Vergleich, soweit gerechnet, sonst die Liste. */
import Link from "../../Link";
import { stepRoute } from "../../routes";
import type { Project, VariantBoard } from "../../types";
import Compare from "./Compare";
import { describeChanges } from "./describe";
import { currentBoard, isRunning, outdatedNote, outdatedReason, withoutResult } from "./results";

export default function KeptSolutions({
  board,
  projekt,
  source,
}: {
  board: VariantBoard;
  projekt: string;
  /** Herkunft des Projekts; ohne Angabe gilt die der Tafel. */
  source?: Project["source"];
}) {
  const toRechnen = <Link to={stepRoute(projekt, "rechnen")}>Durchrechnen</Link>;
  if ((source ?? board.source) !== "api")
    return <p>Festhalten geht nur in einem eigenen Projekt.</p>;
  // Ein eigenes Projekt, dessen Tafel nicht kam: nicht so tun, als gaebe es nichts Festgehaltenes.
  if (board.source !== "api")
    return <p>Die festgehaltenen Lösungen ließen sich nicht laden. Laden Sie die Seite neu.</p>;
  if (!board.definitions.length)
    return <p>Sie haben noch nichts festgehalten, das geht unter {toRechnen}.</p>;

  const running = isRunning(board);
  const shown = currentBoard(board);
  const hasTable = !running && shown.variants.length > 0;
  const note = running ? "" : outdatedNote(board);
  const again = outdatedReason(board) === "never" ? "starten Sie die Rechnung" : "rechnen Sie neu";
  // Neben der Tabelle bleiben nur Loesungen ohne Zeile uebrig, sonst steht jede in der Liste.
  const listed = hasTable ? withoutResult(board) : board.definitions;
  return (
    <>
      {hasTable && shown.answer ? <p>{shown.answer.headline}</p> : null}
      {hasTable ? <Compare board={shown} bestId={shown.answer?.bestId ?? null} /> : null}
      {running ? <p className="aec-fine">Die Rechnung läuft noch.</p> : null}
      {note ? (
        <p className="aec-fine">
          {note} Unter {toRechnen} {again}.
        </p>
      ) : null}
      {listed.length > 0 ? (
        <ul className="aec-facts">
          {listed.map((d) => {
            const detail = describeChanges(d.changes);
            return (
              <li key={d.id}>
                <span>{hasTable ? "ohne Ergebnis" : "festgehalten"}</span>
                {detail === d.name ? d.name : `${d.name} (${detail})`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
