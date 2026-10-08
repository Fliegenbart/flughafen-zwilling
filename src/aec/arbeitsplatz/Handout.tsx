/**
 * Die Seite zum Hinterlassen: Beim Drucken (Als PDF sichern) steht oben, was gerechnet wurde, und
 * unten, wie sicher das ist. Auf dem Bildschirm sind beide Teile unsichtbar.
 */
import type { DataStatus } from "../model/dataStatus";
import { clock, powerText } from "../model/format";
import { worstShortfall } from "../model/headline";
import type { LiveResult } from "../model/livePower";
import type { Accuracy } from "./useLiveScenario";

const date = () =>
  new Date().toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

/** Ein ganzer Satz: was heute oder mit der Einstellung des Kunden am schlimmsten fehlt. */
function lead(result: LiveResult, changed: boolean): string {
  const who = changed ? "Mit Ihrer Einstellung" : "Heute";
  const worst = worstShortfall(result);
  return worst
    ? `${who} fehlen bis zu ${powerText(worst.maxMissingKw)} von ${clock(worst.start)} bis ${clock(worst.end)} Uhr.`
    : `${who} reicht der Anschluss den ganzen Tag.`;
}

export function HandoutHead({
  project,
  result,
  changed,
}: {
  project: string;
  result: LiveResult;
  changed: boolean;
}) {
  return (
    <div className="ap-handout ap-handout--head">
      <p className="ap-handout__meta">Airport Energy Check · {date()}</p>
      <h2 className="ap-handout__title">{project}</h2>
      <p className="ap-handout__lead">{lead(result, changed)}</p>
    </div>
  );
}

export function HandoutFoot({
  status,
  sample,
  accuracy,
}: {
  status: DataStatus | null;
  sample: boolean;
  accuracy: Accuracy;
}) {
  const parts = [
    sample
      ? "Beispieltag mit erfundenen Werten, nicht für ein echtes Projekt gerechnet."
      : (status?.answer ?? ""),
    accuracy === "naeherung" && !sample
      ? "Die Kurve ist eine Näherung, die Rechnung lief noch."
      : "",
    "Gerechnet mit dem Modell von electrified labs. Es ist nicht an Messungen kalibriert, die Zahlen sind keine Zusage.",
  ].filter(Boolean);
  return <p className="ap-handout ap-handout--foot">{parts.join(" ")}</p>;
}
