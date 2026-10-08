/**
 * Eine Reglerstellung als Loesung im Projekt festhalten: anlegen, gruendlich nachrechnen,
 * vergleichen. Erst festgehaltene Loesungen tauchen in der Zusage auf; die Vorschau darueber
 * bleibt eine Vorschau.
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
}: {
  project: Project;
  board: VariantBoard | null;
  reload: () => Promise<VariantBoard | null>;
  running: boolean;
  levers: Levers;
  today: Levers;
  sample: boolean;
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
  else if (board && !board.base)
    hint = "Dafür braucht das Projekt zuerst einen Flugplan unter Daten.";
  else if (!changes) hint = "Verändern Sie erst einen Regler.";
  else if (removesBattery)
    hint = "Einen vorhandenen Speicher zu entfernen lässt sich nicht festhalten.";
  else if (same) hint = `Diese Einstellung ist schon festgehalten als „${same.name}“.`;
  else if (defs.length >= MAX_KEPT)
    hint = `Es sind schon ${MAX_KEPT} Lösungen festgehalten. Entfernen Sie eine.`;
  const canKeep = !hint && !busy && !running && !!changes && !!board;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das Festhalten hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  const keep = () =>
    act(async () => {
      const taken = new Set(defs.map((d) => d.name.toLowerCase()));
      await createVariant(project, nameFor(changes!, taken), changes!);
      await runVariants(project, !!crisis, false, crisis?.scenarioId ?? null);
    });

  const results = board?.source === "api" && board.variants.length > 0 && !running;

  return (
    <section className="ap-keep" aria-labelledby="ap-keep-title">
      <h2 id="ap-keep-title" className="ap-outcome__title">
        Diese Einstellung festhalten
      </h2>
      <p className="ap-keep__lead">
        Festgehaltene Lösungen rechnen wir gründlich nach und führen sie in der{" "}
        <Link to={{ page: "projekt", projekt: project.id, frage: "nachweis" }}>Zusage</Link> auf.
      </p>
      <div className="ap-keep__act">
        <button type="button" className="ap-tool" disabled={!canKeep} onClick={() => void keep()}>
          {busy ? "Wird festgehalten …" : running ? "Wird gerechnet …" : "Einstellung festhalten"}
        </button>
        {hint ? <span className="ap-keep__hint">{hint}</span> : null}
        {crisis && canKeep ? (
          <span className="ap-keep__hint">Gerechnet wird auch unter „{crisis.name}“.</span>
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
          {defs.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b>
              <span>{describeChanges(d.changes)}</span>
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
          ))}
        </ul>
      ) : board?.source === "api" ? (
        <p className="ap-keep__hint">Noch nichts festgehalten.</p>
      ) : null}

      {board?.run?.stale && !running && defs.length ? (
        <div className="ap-keep__act">
          <button
            type="button"
            className="ap-tool"
            disabled={busy}
            onClick={() =>
              void act(() =>
                runVariants(project, !!board.run?.crisis, false, board.run?.crisis?.id ?? null),
              )
            }
          >
            Neu rechnen
          </button>
          <span className="ap-keep__hint">Die Auswahl hat sich geändert.</span>
        </div>
      ) : null}

      {results ? (
        <>
          {board.answer ? <p className="ap-keep__answer">{board.answer.headline}</p> : null}
          <Compare board={board} bestId={board.answer?.bestId ?? null} />
        </>
      ) : null}
    </section>
  );
}
