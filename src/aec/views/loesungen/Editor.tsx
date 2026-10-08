/** Auswahl der Loesungen, Stresstest und Start der Berechnung. */
import { useState } from "react";
import { createVariant, deleteVariant, runVariants } from "../../api/variants";
import { dec1, powerText } from "../../model/format";
import { Details } from "../../parts";
import type { ViewProps } from "../../ProjectPage";
import { caseBySlug, SCENARIO_CASES } from "../../scenarios";
import type { VariantBoard } from "../../types";
import FreeForm from "./FreeForm";
import { describeChanges, suggestions } from "./levers";

/** Stresstest-Auswahl: keiner, Netzimport −20 % oder ein Krisenfall der Bibliothek (Slug). */
type StressChoice = "none" | "grid" | string;

export default function Editor({
  board,
  project,
  reload,
  krise,
}: Pick<ViewProps, "project"> & {
  board: VariantBoard;
  reload: () => Promise<VariantBoard>;
  krise?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stress, setStress] = useState<StressChoice>(caseBySlug(krise) ? krise! : "none");
  const crisis = caseBySlug(stress);
  const running = board.run?.status === "queued" || board.run?.status === "running";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!board.base)
    return (
      <p className="aec-muted" role="note">
        Um Lösungen für Ihr Projekt zu rechnen, braucht es einen Flugplan. Hinterlegen Sie ihn unter
        „Daten“. Bis dahin sehen Sie hier Beispielwerte.
      </p>
    );

  const sugg = suggestions(board);
  const full = board.definitions.length >= 8;
  return (
    <div className="aec-vareditor">
      <p className="aec-muted">
        Heute: {board.base.fleet.total ?? "?"} Fahrzeuge, Netzanschluss{" "}
        {powerText(board.base.gridLimitKw)}
        {board.base.storageKwh
          ? `, Batteriespeicher ${dec1(board.base.storageKwh / 1000)} MWh`
          : ", kein Batteriespeicher"}
        .{" "}
        {board.base.policy === "mission_priority"
          ? "Wer zuerst los muss, lädt zuerst."
          : "Jedes Fahrzeug lädt, sobald es steckt."}
        {board.base.source === "coupled_run" ? "" : " Vorerst sind das Standardwerte."} Jede Lösung
        ändert eine Sache daran.
      </p>
      {sugg.length && !full ? (
        <div className="aec-chips" role="group" aria-label="Vorschläge zum Ausprobieren">
          {sugg.map((s) => (
            <button
              key={s.name}
              type="button"
              className="aec-chip"
              disabled={busy}
              onClick={() => void act(() => createVariant(project, s.name, s.changes))}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!full ? (
        <Details summary="Eigene Lösung zusammenstellen">
          <FreeForm busy={busy} onAdd={(n, c) => void act(() => createVariant(project, n, c))} />
        </Details>
      ) : null}
      {board.definitions.length ? (
        <ul className="aec-vardefs">
          {board.definitions.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b>
              <span>{describeChanges(d.changes)}</span>
              <button
                type="button"
                className="aec-linkbtn"
                disabled={busy || running}
                aria-label={`${d.name} entfernen`}
                onClick={() => void act(() => deleteVariant(project, d.id))}
              >
                entfernen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aec-muted">Noch nichts ausgewählt.</p>
      )}
      <div className="aec-varrun">
        <button
          type="button"
          className="aec-button"
          disabled={busy || running || !board.definitions.length}
          onClick={() =>
            void act(() =>
              runVariants(project, stress !== "none", false, crisis?.scenarioId ?? null),
            )
          }
        >
          {running ? "Wird gerechnet …" : board.run ? "Neu rechnen" : "Lösungen durchrechnen"}
        </button>
        <label className="aec-stresspick">
          Zusätzlich unter Stress rechnen
          <select value={stress} onChange={(e) => setStress(e.target.value)}>
            <option value="none">nein</option>
            <option value="grid">Anschluss den ganzen Tag 20 % schwächer</option>
            <optgroup label="Ein Krisenfall aus der Bibliothek">
              {SCENARIO_CASES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {board.run ? (
          <div
            className="aec-progress"
            role="progressbar"
            aria-label="Fortschritt der Berechnung"
            aria-valuemin={0}
            aria-valuemax={board.run.total}
            aria-valuenow={board.run.done}
          >
            <em>
              {board.run.done} von {board.run.total} fertig
              {board.run.status === "partial" ? " · nicht alle haben geklappt" : ""}
            </em>
            <i className="aec-progress__track" aria-hidden="true">
              <span
                style={{ width: `${(board.run.done / Math.max(1, board.run.total)) * 100}%` }}
              />
            </i>
          </div>
        ) : null}
      </div>
      {crisis ? (
        <p className="aec-fine" role="note">
          <b>So rechnen wir „{crisis.name}“ (Annahme):</b> {crisis.energyStress} Der Flugplan bleibt
          derselbe, gerechnet werden der heutige Stand und jede Lösung zusätzlich unter dieser
          Störung.
        </p>
      ) : null}
      {board.run?.crisis && board.run.crisis.id !== crisis?.scenarioId ? (
        <p className="aec-fine">
          Zuletzt gerechnet unter „{board.run.crisis.name}“: {board.run.crisis.assumption}
        </p>
      ) : null}
      {board.run?.stale && !running ? (
        <p className="aec-muted">
          Sie haben die Auswahl geändert. Rechnen Sie neu, damit die Ergebnisse passen.
        </p>
      ) : null}
      {error ? (
        <p className="aec-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
