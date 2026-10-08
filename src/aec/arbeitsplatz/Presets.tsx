/** Einzelne benannte Aenderungen gegenueber heute zum Antippen; ein zweiter Tipp nimmt sie zurueck. */
import type { Levers } from "../model/livePower";
import { isPreset, PRESETS, presetLevers } from "./levers";

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
  return (
    <div className="ap-chips" role="group" aria-label="Vorschläge zum Ausprobieren">
      {PRESETS.filter((p) => p.applies?.(today) ?? true).map((p) => {
        const on = isPreset(p, levers, today);
        const blocked = !!p.exactOnly && !exactEnabled;
        return (
          <button
            key={p.id}
            type="button"
            className="ap-chip"
            aria-pressed={on}
            disabled={blocked}
            title={blocked ? "Nur in einem eigenen Projekt." : undefined}
            onClick={() => (on ? onReset() : onChange(presetLevers(p, today)))}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
