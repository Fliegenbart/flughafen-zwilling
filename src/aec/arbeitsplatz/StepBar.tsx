/** Die drei Schritte in der Kopfzeile des Arbeitsbildschirms; Durchrechnen ist der aktuelle. */
import Link from "../Link";
import { STEPS, stepRoute } from "../routes";

export default function StepBar({ projekt }: { projekt: string }) {
  return (
    <nav className="ap-steps" aria-label="Drei Schritte des Projekts">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <Link
              to={stepRoute(projekt, s.id)}
              current={s.id === "rechnen" ? "page" : undefined}
              className="ap-steps__item"
            >
              <span aria-hidden="true">{String.fromCharCode(65 + i)}</span> {s.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
