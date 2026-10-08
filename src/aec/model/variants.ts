/**
 * Antwortsatz der Seite Loesungen fuer Beispieldaten. Gerechnete Projekte bekommen ihren
 * Satz aus dem Backend (build_answer); Schwellen und Formulierungen sind dort gleich.
 */
import type { Variant } from "../types";
import { dec1, int } from "./format";

export function bestVariant(variants: Variant[]): Variant | null {
  return variants.reduce<Variant | null>(
    (best, v) =>
      !best ||
      v.onTimePct > best.onTimePct ||
      (v.onTimePct === best.onTimePct && v.minutesAtLimit < best.minutesAtLimit)
        ? v
        : best,
    null,
  );
}

/** Antwortsatz: Pünktlichkeit und Netzentlastung getrennt (Schwellen wie im Backend). */
export function variantsAnswer(variants: Variant[]): string {
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  if (!base) return "Noch keine Lösung gerechnet.";
  const others = variants.filter((v) => v.id !== base.id);
  const gain = (v: Variant) => v.onTimePct - base.onTimePct;
  const relief = (v: Variant) => base.minutesAtLimit - v.minutesAtLimit;
  const punctual = others.filter((v) => gain(v) >= 0.5);
  const gridBest = others
    .filter((v) => relief(v) > 1)
    .reduce<Variant | null>((a, v) => (!a || relief(v) > relief(a) ? v : a), null);
  const gridSentence = gridBest
    ? `„${gridBest.name}“ entlastet den Anschluss am stärksten, um ${int(relief(gridBest))} Minuten am Limit.`
    : "Keine Lösung verkürzt die Zeit am Limit um mehr als eine Minute.";
  const noEffect = others.filter((v) => Math.abs(gain(v)) < 0.5 && Math.abs(relief(v)) <= 1);
  const tail = noEffect.length
    ? ` Mit ${noEffect.map((v) => `„${v.name}“`).join(" und ")} ändert sich weniger als ein halber Prozentpunkt.`
    : "";
  if (!punctual.length)
    return `Keine Lösung bringt mehr als einen halben Prozentpunkt mehr pünktliche Abflüge. ${gridSentence}${tail}`;
  const best = punctual.reduce((a, v) => (gain(v) > gain(a) ? v : a));
  let grid: string;
  if (-relief(best) > 1)
    grid = `Dafür ist der Anschluss ${int(-relief(best))} Minuten länger am Limit.${gridBest ? ` ${gridSentence}` : ""}`;
  else if (gridBest === best)
    grid = `Den Anschluss entlastet sie ebenfalls am stärksten, um ${int(relief(best))} Minuten am Limit.`;
  else grid = gridSentence;
  return `„${best.name}“ hilft am meisten, mit ${dec1(gain(best))} Prozentpunkten mehr pünktlichen Abflügen. ${grid}${tail}`;
}
