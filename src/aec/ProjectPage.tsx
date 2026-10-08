import { useEffect, useMemo, useRef, useState } from "react";
import { getProject } from "./api/projects";
import { getSituation } from "./api/situation";
import { runVariants, sampleBoard } from "./api/variants";
import { useBoard } from "./arbeitsplatz/festhalten/useBoard";
import Link from "./Link";
import DataMeter from "./DataMeter";
import { SourceTag } from "./parts";
import RecomputeBanner, { recomputeState } from "./RecomputeBanner";
import { computeDataStatus, EMPTY_INPUTS, type DataInputs } from "./model/dataStatus";
import { loadDataInputs } from "./api/data";
import { STEPS, stepRoute, type Route } from "./routes";
import StepNav from "./StepNav";
import DatenView from "./views/DatenView";
import type { Project, Situation, VariantBoard } from "./types";
import { WerkstattFrame } from "./Werkstatt";
import NachweisView from "./views/NachweisView";

type ProjectRoute = Extract<Route, { page: "projekt" }>;

export type ViewProps = {
  project: Project;
  situation: Situation;
  board: VariantBoard;
  route: ProjectRoute;
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
  const [inputs, setInputs] = useState<DataInputs | null>(null);
  // Die Tafel bleibt bei einem Fehler stehen und wird weiter abgefragt. Kommt noch keine, zeigt die
  // Seite die Beispiel-Tafel; die Zusage sagt bei einem eigenen Projekt selbst, dass sie fehlt.
  const { board: loaded, reload: reloadBoard, lost } = useBoard(project);
  const board = loaded ?? (lost ? sampleBoard() : null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await getProject(route.projekt);
      if (!alive) return;
      setProject(p);
      void loadDataInputs(p)
        .catch(() => EMPTY_INPUTS)
        .then((d) => alive && setInputs(d));
      const s = await getSituation(p);
      if (alive) setSituation(s);
    })();
    return () => {
      alive = false;
    };
  }, [route.projekt]);

  useEffect(() => {
    if (route.werkstatt) document.getElementById("werkstatt")?.scrollIntoView?.({ block: "start" });
  }, [route.werkstatt]);

  // Flottengroesse aus dem Modelllauf (bzw. der Varianten-Basis) statt "unbekannt".
  const fleetSize = situation?.fleet?.total ?? board?.base?.fleet.total ?? null;
  const shown = useMemo(
    () => (project && fleetSize ? { ...project, fleetSize } : project),
    [project, fleetSize],
  );
  const status = useMemo(() => (inputs ? computeDataStatus(inputs) : null), [inputs]);
  const reloadData = async () => {
    if (!project) return;
    setInputs(await loadDataInputs(project));
    // Neue Projektwerte veraendern die Varianten-Basis.
    await reloadBoard();
  };

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState("");
  const rstate = recomputeState(board);
  const solutions = board?.definitions.length ?? 0;
  // Endet ein Lauf, steht das Lagebild noch auf dem alten Stand.
  const before = useRef(rstate);
  useEffect(() => {
    const was = before.current;
    before.current = rstate;
    if (project && was !== "aktuell" && rstate === "aktuell")
      void getSituation(project).then(setSituation);
  }, [rstate, project]);
  const recompute = async () => {
    if (!project) return;
    setRecomputing(true);
    setRecomputeError("");
    try {
      // Festgehaltene Loesungen rechnen mit, sonst stuende die Zusage ohne ihre Ergebnisse da.
      // Ein Krisenfall des letzten Laufs bleibt dabei, wie bei "Neu rechnen" im Durchrechnen.
      const crisis = board?.run?.crisis?.id ?? null;
      if (solutions) await runVariants(project, !!crisis || !!board?.run?.stress, false, crisis);
      else await runVariants(project, false, true);
      await reloadBoard();
    } catch (e) {
      setRecomputeError(e instanceof Error ? e.message : "Die Rechnung ließ sich nicht starten.");
    } finally {
      setRecomputing(false);
    }
  };

  const props = shown && situation && board ? { project: shown, situation, board, route } : null;
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
            <span className="aec-projectbar__name">{shown?.name ?? "Wir laden das Projekt …"}</span>
            <span className="aec-projectbar__meta">
              {shown
                ? `${shown.site || shown.airport} · ${shown.dayLabel}${
                    shown.fleetSize ? ` · ${shown.fleetSize} Fahrzeuge` : ""
                  }`
                : ""}
            </span>
          </div>
          {shown ? <SourceTag source={situation?.source ?? shown.source} /> : null}
          <DataMeter status={status} projekt={route.projekt} />
        </div>
        <StepNav projekt={route.projekt} current={route.frage} />
      </div>

      <div className="aec-page" key={route.frage}>
        <RecomputeBanner
          state={rstate}
          busy={recomputing}
          error={recomputeError}
          solutions={solutions}
          lost={lost && !!loaded}
          onRun={() => void recompute()}
        />
        {route.frage === "daten" ? (
          shown && inputs && status ? (
            <DatenView
              project={shown}
              inputs={inputs}
              status={status}
              reload={reloadData}
              route={route}
            />
          ) : (
            <p className="aec-loading" role="status">
              Wir laden Ihre Daten …
            </p>
          )
        ) : !props ? (
          <p className="aec-loading" role="status">
            Wir laden den Tag …
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
