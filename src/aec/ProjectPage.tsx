import { useEffect, useMemo, useState } from "react";
import { getProject } from "./api/projects";
import { getSituation } from "./api/situation";
import { getVariantBoard, runVariants } from "./api/variants";
import Link from "./Link";
import { SourceTag } from "./parts";
import {
  computeDataStatus,
  EMPTY_INPUTS,
  type DataInputs,
  type DataStatus,
} from "./model/dataStatus";
import { loadDataInputs } from "./api/data";
import { STEPS, stepRoute, type Route } from "./routes";
import StepNav from "./StepNav";
import DatenView from "./views/DatenView";
import type { Project, Situation, Variant, VariantBoard } from "./types";
import { WerkstattFrame } from "./Werkstatt";
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
        ? "Für die Zusage ist der Tag noch nicht mit Ihren Werten gerechnet."
        : "Seit der letzten Rechnung haben sich Ihre Werte geändert, die Zusage zeigt noch den alten Stand.";
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
  // Von den Daten geht es weiter zum Durchrechnen; die Zusage ist das Ende.
  const next = route.frage === "daten" ? STEPS[1] : null;

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
        <StepNav projekt={route.projekt} current={route.frage} />
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

        {next ? (
          <Link to={stepRoute(route.projekt, next.id)} className="aec-next">
            <span className="aec-eyebrow">Weiter mit</span>
            <span className="aec-next__q">
              {next.label}: {next.question}
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
