import { useEffect, useMemo, useRef, useState } from "react";
import { getProject } from "./api/projects";
import { getSituation } from "./api/situation";
import { getVariantBoard, runVariants } from "./api/variants";
import { useNav } from "./context";
import Link from "./Link";
import { SourceTag } from "./parts";
import {
  computeDataStatus,
  EMPTY_INPUTS,
  needsDataStep,
  type DataInputs,
  type DataStatus,
} from "./model/dataStatus";
import { loadDataInputs } from "./api/data";
import { DATA_STEP, QUESTIONS, STEPS, type Route, type Step } from "./routes";
import DatenView from "./views/DatenView";
import type { Project, Situation, Variant, VariantBoard } from "./types";
import { WerkstattFrame } from "./Werkstatt";
import LageView from "./views/LageView";
import EngpassView from "./views/EngpassView";
import VariantenView from "./views/VariantenView";
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
  const onData = route.frage === "daten";
  return (
    <div className="aec-qnav">
      <Link
        to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}
        current={onData ? "page" : undefined}
        className="aec-qnav__item aec-qnav__item--data"
      >
        <span className="aec-qnav__sign">
          <span className="aec-qnav__letter" aria-hidden="true">
            0
          </span>
          {DATA_STEP.label}
        </span>
        <span className="aec-qnav__q">{DATA_STEP.question}</span>
      </Link>
      <nav aria-label="Vier Fragen des Projekts">
        <ol ref={list}>
          {QUESTIONS.map((q, i) => (
            <li
              key={q.id}
              data-state={onData ? "ahead" : i < index ? "past" : i === index ? "here" : "ahead"}
            >
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
          {nav.route.page !== "projekt"
            ? ""
            : onData
              ? `Ihre Daten: ${DATA_STEP.question}`
              : `Frage ${index + 1} von ${QUESTIONS.length}: ${QUESTIONS[index]!.question}`}
        </p>
      </nav>
    </div>
  );
}

/** Zustand des Projekt-Basislaufs gegenueber den aktuellen Projektwerten. */
export function recomputeState(
  board: VariantBoard | null,
): "aktuell" | "veraltet" | "fehlt" | "laeuft" {
  if (!board || board.source !== "api" || !board.base) return "aktuell";
  if (board.run && (board.run.status === "queued" || board.run.status === "running"))
    return "laeuft";
  if (!board.run) return "fehlt";
  return board.run.inputsStale ? "veraltet" : "aktuell";
}

function RecomputeBanner({
  state,
  busy,
  error,
  onRun,
}: {
  state: ReturnType<typeof recomputeState>;
  busy: boolean;
  error: string;
  onRun: () => void;
}) {
  if (state === "aktuell") return null;
  const text =
    state === "laeuft"
      ? "Der Tag wird mit Ihren Werten neu gerechnet …"
      : state === "fehlt"
        ? "Ihr Tag ist noch nicht gerechnet, deshalb fehlen auf den folgenden Seiten Ihre Zahlen."
        : "Seit der letzten Rechnung haben sich Ihre Werte geändert, die Seiten zeigen noch den alten Stand.";
  return (
    <div className="aec-recompute" data-state={state} role="status">
      <p>
        {state === "veraltet" ? <strong className="aec-recompute__tag">veraltet</strong> : null}
        {text}
      </p>
      {state !== "laeuft" ? (
        <button type="button" className="aec-button" disabled={busy} onClick={onRun}>
          {busy ? "Wird gestartet …" : "Tag neu rechnen"}
        </button>
      ) : null}
      {error ? (
        <p className="aec-derror" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Datenstand im Projektkopf: N von 4 echt, Mini-Leiste, fuehrt zum Schritt Daten. */
function DataMeter({ status, projekt }: { status: DataStatus | null; projekt: string }) {
  const label = status
    ? `${status.real} von 4 Datenquellen belegt. ${status.answer} Zu Ihren Daten.`
    : "Datenstand wird geladen. Zu Ihren Daten.";
  return (
    <Link to={{ page: "projekt", projekt, frage: "daten" }} className="aec-dmeter" label={label}>
      <span className="aec-dmeter__text" aria-hidden="true">
        Belegt: <strong>{status ? `${status.real} von 4` : "…"}</strong>
      </span>
      <span className="aec-dmeter__bar" aria-hidden="true">
        {(status?.items ?? []).map((i) => (
          <i key={i.id} data-state={i.state} title={`${i.title}: ${i.state}`} />
        ))}
      </span>
    </Link>
  );
}

const NEXT: Partial<Record<Step, Step>> = {
  daten: "lage",
  lage: "engpass",
  engpass: "varianten",
  varianten: "nachweis",
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
  const [inputs, setInputs] = useState<DataInputs | null>(null);
  const nav = useNav();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await getProject(route.projekt);
      if (!alive) return;
      setProject(p);
      void loadDataInputs(p)
        .catch(() => EMPTY_INPUTS)
        .then((d) => alive && setInputs(d));
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

  const status = useMemo(() => (inputs ? computeDataStatus(inputs) : null), [inputs]);
  // Ohne `frage` in der Adresse: Daten zuerst, solange Flugplan und Flotte nicht echt sind.
  useEffect(() => {
    if (!route.auto || !project || !status) return;
    const frage = project.source === "api" && needsDataStep(status) ? "daten" : "lage";
    nav.navigate({ page: "projekt", projekt: route.projekt, frage }, { replace: true });
  }, [route.auto, route.projekt, project, status, nav]);

  const reloadData = async () => {
    if (!project) return;
    setInputs(await loadDataInputs(project));
    // Neue Projektwerte veraendern die Varianten-Basis.
    const b = await getVariantBoard(project);
    setBoard(b);
  };

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState("");
  const rstate = recomputeState(board);
  // Waehrend ein Basislauf rechnet: Tafel nachladen, danach Lagebild aktualisieren.
  useEffect(() => {
    if (rstate !== "laeuft" || !project) return;
    const timer = setInterval(() => {
      void getVariantBoard(project).then(async (b) => {
        setBoard(b);
        if (recomputeState(b) !== "laeuft") setSituation(await getSituation(project));
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [rstate, project]);
  const recompute = async () => {
    if (!project) return;
    setRecomputing(true);
    setRecomputeError("");
    try {
      setBoard(await runVariants(project, false, true));
    } catch (e) {
      setRecomputeError(e instanceof Error ? e.message : "Start fehlgeschlagen");
    } finally {
      setRecomputing(false);
    }
  };

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
  const nextQ = STEPS.find((q) => q.id === next);

  return (
    <div className="aec-project-page">
      <div className="aec-projectbar">
        <div className="aec-projectbar__id">
          <Link
            to={{ page: "start" }}
            className="aec-projectbar__back"
            label="Zurück zu allen Projekten"
          >
            ←
          </Link>
          <div>
            <span className="aec-projectbar__name">
              {project?.name ?? "Projekt wird geladen …"}
            </span>
            <span className="aec-projectbar__meta">
              {project
                ? `${project.site || project.airport} · ${project.dayLabel}${
                    project.fleetSize ? ` · ${project.fleetSize} Fahrzeuge` : ""
                  }`
                : ""}
            </span>
          </div>
          {project ? <SourceTag source={situation?.source ?? project.source} /> : null}
          <DataMeter status={status} projekt={route.projekt} />
        </div>
        <QuestionNav route={route} />
      </div>

      <div className="aec-page" key={route.frage}>
        <RecomputeBanner
          state={rstate}
          busy={recomputing}
          error={recomputeError}
          onRun={() => void recompute()}
        />
        {route.frage === "daten" ? (
          project && inputs && status ? (
            <DatenView
              project={project}
              inputs={inputs}
              status={status}
              reload={reloadData}
              route={route}
            />
          ) : (
            <p className="aec-loading" role="status">
              Ihre Daten werden geladen …
            </p>
          )
        ) : !props ? (
          <p className="aec-loading" role="status">
            Der Tag wird geladen …
          </p>
        ) : route.frage === "lage" ? (
          <LageView {...props} />
        ) : route.frage === "engpass" ? (
          <EngpassView {...props} />
        ) : route.frage === "varianten" ? (
          <VariantenView {...props} />
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
            <span className="aec-eyebrow">Weiter mit</span>
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
