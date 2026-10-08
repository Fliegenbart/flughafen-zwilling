/**
 * Eine Reglerstellung als Loesung im Projekt festhalten: anlegen, nachrechnen, vergleichen.
 * Festgehaltene Loesungen fuehrt auch die Zusage auf; die Vorschau darueber bleibt eine Vorschau.
 */
import { useState } from "react";
import { createVariant, deleteVariant, runVariants } from "../../api/variants";
import { variantChangesFor } from "../../api/preview";
import Link from "../../Link";
import type { Levers } from "../../model/livePower";
import { caseByScenarioId } from "../../scenarios";
import type { Project, VariantBoard, VariantChanges } from "../../types";
import { describeChanges } from "./describe";
import Compare from "./Compare";
import { currentBoard, outdatedNote, outdatedReason } from "./results";

const MAX_KEPT = 8;
const NAME_MAX = 80;

/** Gleiche Aenderungen, egal in welcher Reihenfolge die Felder stehen (auch verschachtelt). */
const canonical = (v: unknown): string =>
  v && typeof v === "object"
    ? `{${Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
        .join(",")}}`
    : JSON.stringify(v);

/** Name aus der Beschreibung der Aenderungen; eindeutig im Projekt, hoechstens 80 Zeichen. */
function nameFor(changes: VariantChanges, taken: Set<string>): string {
  const text = describeChanges(changes);
  const base = text.length > NAME_MAX - 4 ? `${text.slice(0, NAME_MAX - 5)}…` : text;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  return name;
}

export default function Festhalten({
  project,
  board,
  reload,
  running,
  levers,
  today,
  sample,
  lost = false,
}: {
  project: Project;
  board: VariantBoard | null;
  reload: () => Promise<VariantBoard | null>;
  running: boolean;
  levers: Levers;
  today: Levers;
  sample: boolean;
  /** Das Nachfragen der festgehaltenen Lösungen schlug fehl. */
  lost?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = variantChangesFor(levers, today);
  const crisis = caseByScenarioId(levers.crisis);
  const defs = board?.definitions ?? [];
  const same = changes ? defs.find((d) => canonical(d.changes) === canonical(changes)) : undefined;
  const removesBattery = today.batteryKwh > 0 && levers.batteryKwh === 0;

  let hint = "";
  if (sample) hint = "Festhalten geht nur in einem eigenen Projekt.";
  else if (lost && !board) hint = "Die festgehaltenen Lösungen ließen sich nicht laden.";
  else if (board && !board.base)
    hint = "Dafür braucht das Projekt zuerst einen Flugplan unter Daten.";
  else if (!changes) hint = "Verändern Sie erst einen Regler.";
  else if (removesBattery)
    hint = "Ein vorhandener Batteriespeicher bleibt in jeder festgehaltenen Lösung bestehen.";
  else if (same) hint = `Diese Einstellung ist schon festgehalten als „${same.name}“.`;
  else if (defs.length >= MAX_KEPT)
    hint = `Es sind schon ${MAX_KEPT} Lösungen festgehalten. Entfernen Sie eine.`;
  const canKeep = !hint && !busy && !running && !!changes && !!board;
  // Ein neuer Lauf gilt fuer alle Loesungen und nimmt nur den jetzt gewaehlten Krisenfall mit.
  const earlierCrisis = board?.run?.crisis;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das Festhalten hat nicht geklappt.");
    } finally {
      // Der Server kann trotz Fehler schon etwas angelegt haben: die Tafel immer neu holen.
      await reload().catch(() => null);
      setBusy(false);
    }
  }

  const keep = () =>
    act(async () => {
      const taken = new Set(defs.map((d) => d.name.toLowerCase()));
      await createVariant(project, nameFor(changes!, taken), changes!);
      try {
        await runVariants(project, !!crisis, false, crisis?.scenarioId ?? null);
      } catch (e) {
        throw new Error(
          [
            "Wir haben die Lösung festgehalten, die Berechnung hat aber nicht geklappt.",
            e instanceof Error ? e.message : "",
            "Mit „Neu rechnen“ starten Sie sie erneut.",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    });

  const rerun = () => {
    const id = board?.run?.crisis?.id ?? crisis?.scenarioId ?? null;
    return act(() => runVariants(project, !!id || !!board?.run?.stress, false, id));
  };

  const api = board?.source === "api";
  const shown = api ? currentBoard(board) : null;
  const results = !!shown && shown.variants.length > 0 && !running;
  const outdated = api && !!board.base && !running && outdatedReason(board) !== null;

  return (
    <section className="ap-keep" aria-labelledby="ap-keep-title">
      <h2 id="ap-keep-title" className="ap-outcome__title">
        Diese Einstellung festhalten
      </h2>
      <p className="ap-keep__lead">
        Festgehaltene Lösungen rechnen wir für den ganzen Tag nach und führen sie in der{" "}
        <Link to={{ page: "projekt", projekt: project.id, frage: "nachweis" }}>Zusage</Link> auf.
      </p>
      <div className="ap-keep__act">
        <button type="button" className="ap-tool" disabled={!canKeep} onClick={() => void keep()}>
          {busy ? "Wird festgehalten …" : running ? "Wird gerechnet …" : "Einstellung festhalten"}
        </button>
        {hint ? <span className="ap-keep__hint">{hint}</span> : null}
        {crisis && canKeep ? (
          <span className="ap-keep__hint">Wir rechnen die Lösung auch unter „{crisis.name}“.</span>
        ) : null}
        {!crisis && earlierCrisis && canKeep ? (
          <span className="ap-keep__hint">
            Ohne Krisenfall rechnen wir alle Lösungen neu und lassen „{earlierCrisis.name}“ weg.
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="ap-error ap-keep__error" role="alert">
          {error}
        </p>
      ) : null}

      {running && board?.run ? (
        <p className="ap-keep__progress" role="status">
          {board.run.done} von {board.run.total} Berechnungen fertig.
        </p>
      ) : null}

      {defs.length ? (
        <ul className="ap-keep__list" aria-label="Festgehaltene Lösungen">
          {defs.map((d) => {
            const detail = describeChanges(d.changes);
            return (
              <li key={d.id}>
                <b>{d.name}</b>
                {detail !== d.name ? <span>{detail}</span> : null}
                <button
                  type="button"
                  className="ap-keep__remove"
                  disabled={busy || running}
                  aria-label={`${d.name} entfernen`}
                  onClick={() => void act(() => deleteVariant(project, d.id))}
                >
                  entfernen
                </button>
              </li>
            );
          })}
        </ul>
      ) : api ? (
        <p className="ap-keep__hint">Noch nichts festgehalten.</p>
      ) : null}

      {outdated ? (
        <div className="ap-keep__act">
          <button type="button" className="ap-tool" disabled={busy} onClick={() => void rerun()}>
            Neu rechnen
          </button>
          <span className="ap-keep__hint">{outdatedNote(board)}</span>
        </div>
      ) : null}

      {results ? (
        <>
          {shown.answer ? <p className="ap-keep__answer">{shown.answer.headline}</p> : null}
          <Compare board={shown} bestId={shown.answer?.bestId ?? null} />
        </>
      ) : null}
    </section>
  );
}
