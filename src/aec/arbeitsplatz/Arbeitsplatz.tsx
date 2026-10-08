/**
 * Durchrechnen (Schritt B): der Arbeitsbildschirm fuer den Kundentermin. Regler links,
 * Tageskurve rechts, Vergleich darunter.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./arbeitsplatz.css";
import { useEffect, useState } from "react";
import { getProject } from "../api/projects";
import { useNav } from "../context";
import Link from "../Link";
import type { Levers } from "../model/livePower";
import { needsFlightPlan } from "../model/dataStatus";
import { caseBySlug } from "../scenarios";
import type { Route } from "../routes";
import type { Project } from "../types";
import { HandoutFoot, HandoutHead } from "./Handout";
import LeverPanel from "./LeverPanel";
import LoadChart from "./LoadChart";
import Outcome from "./Outcome";
import Presets from "./Presets";
import Shortfalls from "./Shortfalls";
import StepBar from "./StepBar";
import BasisNote from "./BasisNote";
import Festhalten from "./festhalten/Festhalten";
import { useBoard } from "./festhalten/useBoard";
import { loadLevers, saveLevers } from "./leverMemory";
import { useDataStatus } from "./useDataStatus";
import { useLiveScenario } from "./useLiveScenario";
import { usePresentation } from "./usePresentation";

type ArbeitsplatzRoute = Extract<Route, { page: "arbeitsplatz" }>;

export default function Arbeitsplatz({ route }: { route: ArbeitsplatzRoute }) {
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    let alive = true;
    void getProject(route.projekt).then((p) => alive && setProject(p));
    return () => {
      alive = false;
    };
  }, [route.projekt]);
  const status = useDataStatus(project);
  const nav = useNav();
  // Nackte Projektadresse: ohne Flugplan gibt es nichts zu rechnen, also zuerst zu den Daten.
  // Bis das geklaert ist, startet auch die Rechnung nicht.
  const noPlan = needsFlightPlan(status);
  const checking = !!route.auto && project?.source === "api" && (!status || noPlan);
  useEffect(() => {
    if (checking && noPlan)
      nav.navigate({ page: "projekt", projekt: route.projekt, frage: "daten" }, { replace: true });
  }, [checking, noPlan, route.projekt, nav]);
  // Zuletzt benutzte Regler dieser Sitzung; ein Krisenfall aus der Adresse hat Vorrang.
  const [initial] = useState<Partial<Levers>>(() => {
    const crisis = caseBySlug(route.krise)?.scenarioId;
    return { ...loadLevers(route.projekt), ...(crisis ? { crisis } : {}) };
  });
  const s = useLiveScenario(checking ? null : project, initial);
  const { board, reload: reloadBoard, running } = useBoard(checking ? null : project);
  const { presenting, setPresenting } = usePresentation();
  const changed =
    !!s.levers &&
    !!s.todayLevers &&
    (s.levers.gridLimitKw !== s.todayLevers.gridLimitKw ||
      s.levers.batteryKwh !== s.todayLevers.batteryKwh ||
      s.levers.pvFactor !== s.todayLevers.pvFactor ||
      (s.levers.extraVehicles ?? 0) > 0 ||
      !!s.levers.crisis);

  useEffect(() => {
    if (s.levers) saveLevers(route.projekt, changed ? s.levers : null);
  }, [route.projekt, s.levers, changed]);

  const ready = !!(s.today && s.levers && s.todayLevers && s.result && s.todayResult);

  return (
    <div className="ap" data-presenting={presenting || undefined}>
      <header className="ap-head">
        <Link to={{ page: "start" }} className="ap-head__back" label="Zurück zu allen Projekten">
          Projekte
        </Link>
        <h1 className="ap-head__title">{project?.name ?? "Projekt wird geladen …"}</h1>
        <StepBar projekt={route.projekt} />
        <span className="ap-head__data">
          Daten: {status ? `${status.real} von ${status.total} belegt` : "…"}
        </span>
        <button
          type="button"
          className="ap-tool"
          onClick={() => setPresenting(!presenting)}
          aria-pressed={presenting}
          title="Taste P"
        >
          {presenting ? "Präsentation beenden" : "Präsentieren"}
        </button>
        <button
          type="button"
          className="ap-tool"
          onClick={() => window.print()}
          disabled={!ready || (!s.sample && s.accuracy === "naeherung")}
          title={
            !s.sample && s.accuracy === "naeherung"
              ? "Erst wenn die genaue Rechnung fertig ist"
              : "Als PDF sichern: im Druckdialog „Als PDF speichern“ wählen"
          }
        >
          Als PDF sichern
        </button>
      </header>

      <main id="aec-main" tabIndex={-1} className="ap-page">
        {s.accuracy === "fehler" && !s.today ? (
          <p className="ap-error" role="alert">
            {s.error} Für eine Kurve braucht das Projekt einen Flugplan.{" "}
            <Link to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}>
              Daten ergänzen
            </Link>
          </p>
        ) : !s.today || !s.levers || !s.todayLevers || !s.result || !s.todayResult ? (
          <p className="ap-loading" role="status">
            Der Tag wird gerechnet …
          </p>
        ) : (
          <div className="ap-body">
            <HandoutHead project={project?.name ?? ""} result={s.result} changed={changed} />
            <LeverPanel
              levers={s.levers}
              today={s.todayLevers}
              onChange={s.setLevers}
              onReset={s.reset}
              pvKwp={s.today.basis.power.pvCapacityKwp}
              exactEnabled={!s.sample}
            />
            <div className="ap-main">
              <Presets
                levers={s.levers}
                today={s.todayLevers}
                onChange={s.setLevers}
                onReset={s.reset}
                exactEnabled={!s.sample}
              />
              <LoadChart
                result={s.result}
                today={s.todayResult}
                departures={(s.exact ?? s.today).departures}
                changed={changed}
              />
              <Shortfalls result={s.result} />
              <Outcome
                today={s.todayResult}
                todayPreview={s.today}
                result={s.result}
                exact={s.exact}
                accuracy={s.accuracy}
                changed={changed}
                sample={s.sample}
              />
              {s.error && s.today ? (
                <p className="ap-error" role="alert">
                  {s.error}
                </p>
              ) : null}
              <BasisNote
                today={s.today}
                exact={s.exact}
                board={board}
                status={status}
                sample={s.sample}
              />
              {project ? (
                <Festhalten
                  project={project}
                  board={board}
                  reload={reloadBoard}
                  running={running}
                  levers={s.levers}
                  today={s.todayLevers}
                  sample={s.sample}
                />
              ) : null}
            </div>
            <HandoutFoot status={status} sample={s.sample} accuracy={s.accuracy} />
          </div>
        )}
      </main>
    </div>
  );
}
