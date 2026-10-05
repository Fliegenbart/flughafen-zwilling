import { useEffect, useRef, useState } from "react";
import { getProject, getSituation, getVariantBoard } from "./api";
import { useNav } from "./context";
import Link from "./Link";
import { SourceTag } from "./parts";
import { QUESTIONS, type Question, type Route } from "./routes";
import type { Project, Situation, Variant, VariantBoard } from "./types";
import { WerkstattFrame } from "./Werkstatt";
import LageView from "./views/LageView";
import EngpassView from "./views/EngpassView";
import VariantenView from "./views/VariantenView";
import AbgleichView from "./views/AbgleichView";
import NachweisView from "./views/NachweisView";

type ProjectRoute = Extract<Route, { page: "projekt" }>;

export type ViewProps = {
  project: Project;
  situation: Situation;
  variants: Variant[];
  board: VariantBoard;
  reloadBoard: () => Promise<VariantBoard>;
  route: ProjectRoute;
};

/** Navigation als Rollwegbeschilderung: der aktuelle Ort ist das gelb-schwarze Positionsschild. */
function QuestionNav({ route }: { route: ProjectRoute }) {
  const nav = useNav();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [route.frage]);
  const index = QUESTIONS.findIndex((q) => q.id === route.frage);
  return (
    <nav className="aec-qnav" aria-label="Fünf Fragen des Projekts">
      <ol ref={list}>
        {QUESTIONS.map((q, i) => (
          <li key={q.id} data-state={i < index ? "past" : i === index ? "here" : "ahead"}>
            <Link
              to={{ page: "projekt", projekt: route.projekt, frage: q.id }}
              current={q.id === route.frage ? "page" : undefined}
              className="aec-qnav__item"
            >
              <span className="aec-qnav__sign">
                <span className="aec-qnav__letter" aria-hidden="true">
                  {String.fromCharCode(65 + i)}
                </span>
                {q.label}
              </span>
              <span className="aec-qnav__q">{q.question}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="aec-visually-hidden" aria-live="polite">
        {nav.route.page === "projekt"
          ? `Frage ${index + 1} von 5: ${QUESTIONS[index]!.question}`
          : ""}
      </p>
    </nav>
  );
}

const NEXT: Partial<Record<Question, Question>> = {
  lage: "engpass",
  engpass: "varianten",
  varianten: "abgleich",
  abgleich: "nachweis",
};

export default function ProjectPage({
  route,
  theme,
}: {
  route: ProjectRoute;
  theme?: "light" | "dark";
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [situation, setSituation] = useState<Situation | null>(null);
  const [board, setBoard] = useState<VariantBoard | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await getProject(route.projekt);
      if (!alive) return;
      setProject(p);
      const [s, b] = await Promise.all([getSituation(p), getVariantBoard(p)]);
      if (!alive) return;
      // Flottengroesse aus dem Modelllauf (bzw. der Varianten-Basis) statt "unbekannt".
      const fleet = s.fleet?.total ?? b.base?.fleet.total ?? null;
      if (fleet) setProject({ ...p, fleetSize: fleet });
      setSituation(s);
      setBoard(b);
    })();
    return () => {
      alive = false;
    };
  }, [route.projekt]);

  useEffect(() => {
    if (route.werkstatt) document.getElementById("werkstatt")?.scrollIntoView?.({ block: "start" });
  }, [route.werkstatt]);

  const reloadBoard = async () => {
    const b = project ? await getVariantBoard(project) : null;
    if (b) setBoard(b);
    return b!;
  };
  const props =
    project && situation && board
      ? { project, situation, variants: board.variants, board, reloadBoard, route }
      : null;
  const next = NEXT[route.frage];
  const nextQ = QUESTIONS.find((q) => q.id === next);

  return (
    <div className="aec-project-page">
      <div className="aec-projectbar">
        <div className="aec-projectbar__id">
          <Link to={{ page: "start" }} className="aec-projectbar__back" label="Alle Projekte">
            ←
          </Link>
          <div>
            <span className="aec-projectbar__name">{project?.name ?? "Projekt wird geladen…"}</span>
            <span className="aec-projectbar__meta">
              {project
                ? `${project.site || project.airport} · ${project.dayLabel}${
                    project.fleetSize ? ` · ${project.fleetSize} Fahrzeuge` : ""
                  }`
                : ""}
            </span>
          </div>
          {project ? <SourceTag source={situation?.source ?? project.source} /> : null}
        </div>
        <QuestionNav route={route} />
      </div>

      <div className="aec-page" key={route.frage}>
        {!props ? (
          <p className="aec-loading" role="status">
            Lagebild wird geladen…
          </p>
        ) : route.frage === "lage" ? (
          <LageView {...props} />
        ) : route.frage === "engpass" ? (
          <EngpassView {...props} />
        ) : route.frage === "varianten" ? (
          <VariantenView {...props} />
        ) : route.frage === "abgleich" ? (
          <AbgleichView {...props} />
        ) : (
          <NachweisView {...props} />
        )}

        {route.werkstatt ? (
          <WerkstattFrame
            werkstatt={route.werkstatt}
            theme={theme}
            close={{ page: "projekt", projekt: route.projekt, frage: route.frage }}
          />
        ) : null}

        {nextQ ? (
          <Link
            to={{ page: "projekt", projekt: route.projekt, frage: nextQ.id }}
            className="aec-next"
          >
            <span className="aec-eyebrow">Nächste Frage</span>
            <span className="aec-next__q">
              {nextQ.label}: {nextQ.question}
            </span>
            <span className="aec-next__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
