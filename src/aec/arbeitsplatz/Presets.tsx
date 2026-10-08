/** Einzelne benannte Aenderungen gegenueber heute zum Antippen; ein zweiter Tipp nimmt sie zurueck. */
import type { Levers } from "../model/livePower";
import { isPreset, PRESETS, presetLevers } from "./levers";

const NOTE_ID = "ap-chips-note";

export default function Presets({
  levers,
  today,
  onChange,
  onReset,
  exactEnabled,
}: {
  levers: Levers;
  today: Levers;
  onChange: (next: Levers) => void;
  onReset: () => void;
  exactEnabled: boolean;
}) {
  const shown = PRESETS.filter((p) => p.applies?.(today) ?? true);
  const anyBlocked = shown.some((p) => p.exactOnly) && !exactEnabled;
  // Ein Krisenfall bleibt beim Antippen und beim Zuruecknehmen eines Vorschlags erhalten.
  const keepCrisis = levers.crisis ? { crisis: levers.crisis } : {};
  return (
    <>
      <div className="ap-chips" role="group" aria-label="Vorschläge zum Ausprobieren">
        {shown.map((p) => {
          const on = isPreset(p, { ...levers, crisis: undefined }, today);
          const blocked = !!p.exactOnly && !exactEnabled;
          return (
            <button
              key={p.id}
              type="button"
              className="ap-chip"
              aria-pressed={on}
              aria-describedby={blocked ? NOTE_ID : undefined}
              disabled={blocked}
              title={blocked ? "Nur in einem eigenen Projekt." : undefined}
              onClick={() => {
                if (!on) onChange({ ...presetLevers(p, today), ...keepCrisis });
                else if (levers.crisis) onChange({ ...today, ...keepCrisis });
                else onReset();
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {anyBlocked ? (
        <p className="ap-chips__note" id={NOTE_ID}>
          Ausgegraute Vorschläge gibt es nur in einem eigenen Projekt.
        </p>
      ) : null}
    </>
  );
}
