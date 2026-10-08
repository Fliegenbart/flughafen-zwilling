/**
 * Die Seite zum Hinterlassen: Beim Drucken (Als PDF sichern) steht oben, was gerechnet wurde, und
 * unten, wie sicher das ist. Auf dem Bildschirm sind beide Teile unsichtbar.
 */
import type { DataStatus } from "../model/dataStatus";
import { shortfallHeadline } from "../model/headline";
import type { LiveResult } from "../model/livePower";
import type { Accuracy } from "./useLiveScenario";

const date = () =>
  new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

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
      <p className="ap-handout__lead">
        {shortfallHeadline(result)}
        {changed ? " Mit der unten gezeigten Einstellung." : " Stand heute, ohne Änderung."}
      </p>
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
      : status
        ? `${status.real} von ${status.total} Datenquellen sind mit Quelle belegt, für den Rest gelten Annahmen.`
        : "",
    accuracy === "naeherung" && !sample
      ? "Die Kurve ist eine Näherung, die genaue Rechnung lief noch."
      : "",
    "Gerechnet mit dem Modell von electrified labs. Es ist nicht an Messungen kalibriert, die Zahlen sind keine Zusage.",
  ].filter(Boolean);
  return <p className="ap-handout ap-handout--foot">{parts.join(" ")}</p>;
}
