/**
 * Antwortsatz der Seite Varianten fuer Beispieldaten. Gerechnete Projekte bekommen ihren
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

/** Antwortsatz: Einsatzbereitschaft und Netzentlastung getrennt (Schwellen wie im Backend). */
export function variantsAnswer(variants: Variant[]): string {
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  if (!base) return "Noch keine Variante simuliert.";
  const others = variants.filter((v) => v.id !== base.id);
  const gain = (v: Variant) => v.onTimePct - base.onTimePct;
  const relief = (v: Variant) => base.minutesAtLimit - v.minutesAtLimit;
  const punctual = others.filter((v) => gain(v) >= 0.5);
  const gridBest = others
    .filter((v) => relief(v) > 1)
    .reduce<Variant | null>((a, v) => (!a || relief(v) > relief(a) ? v : a), null);
  const gridSentence = gridBest
    ? `„${gridBest.name}“ verkürzt in dieser Simulation die Zeit am Anschlusslimit am stärksten, um ${int(relief(gridBest))} Minuten.`
    : "Keine Variante verkürzt in dieser Simulation die Zeit am Anschlusslimit um mehr als eine Minute.";
  const noEffect = others.filter((v) => Math.abs(gain(v)) < 0.5 && Math.abs(relief(v)) <= 1);
  const tail = noEffect.length
    ? ` Mit ${noEffect.map((v) => `„${v.name}“`).join(" und ")} ändert sich in dieser Simulation weniger als ein halber Prozentpunkt.`
    : "";
  if (!punctual.length)
    return `Keine Variante steigert in dieser Simulation die Einsatzbereitschaft um mehr als einen halben Prozentpunkt. ${gridSentence}${tail}`;
  const best = punctual.reduce((a, v) => (gain(v) > gain(a) ? v : a));
  let grid: string;
  if (-relief(best) > 1)
    grid = `Dafür liegt der Anschluss in dieser Simulation ${int(-relief(best))} Minuten länger am Limit.${gridBest ? ` ${gridSentence}` : ""}`;
  else if (gridBest === best)
    grid = `Sie verkürzt in dieser Simulation auch die Zeit am Anschlusslimit am stärksten, um ${int(relief(best))} Minuten.`;
  else grid = gridSentence;
  return `In dieser Simulation erreicht „${best.name}“ die höchste Einsatzbereitschaft, ${dec1(gain(best))} Prozentpunkte über der Ausgangslage. ${grid}${tail}`;
}
