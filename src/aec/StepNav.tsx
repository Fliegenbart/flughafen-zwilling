/** Die drei Schritte eines Projekts als Rollwegbeschilderung; der aktuelle Ort ist das Schild. */
import { useEffect, useRef } from "react";
import Link from "./Link";
import { STEPS, stepRoute, type Step } from "./routes";

export default function StepNav({ projekt, current }: { projekt: string; current: Step }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [current]);
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="aec-qnav">
      <nav aria-label="Drei Schritte des Projekts">
        <ol ref={list}>
          {STEPS.map((s, i) => (
            <li key={s.id} data-state={i < index ? "past" : i === index ? "here" : "ahead"}>
              <Link
                to={stepRoute(projekt, s.id)}
                current={s.id === current ? "page" : undefined}
                className="aec-qnav__item"
              >
                <span className="aec-qnav__sign">
                  <span className="aec-qnav__letter" aria-hidden="true">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {s.label}
                </span>
                <span className="aec-qnav__q">{s.question}</span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="aec-visually-hidden" aria-live="polite">
          {`Schritt ${index + 1} von ${STEPS.length}: ${STEPS[index]!.label}. ${STEPS[index]!.question}`}
        </p>
      </nav>
    </div>
  );
}
