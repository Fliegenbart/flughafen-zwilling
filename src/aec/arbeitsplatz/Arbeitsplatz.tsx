/**
 * Durchrechnen (Schritt B): der Arbeitsbildschirm fuer den Kundentermin. Regler links,
 * Tageskurve rechts, Vergleich darunter.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./arbeitsplatz.css";
import { useEffect, useMemo, useState } from "react";
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
import { isChanged } from "./levers";
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
  const { board, reload: reloadBoard, running, lost } = useBoard(checking ? null : project);
  const { presenting, setPresenting, toggleRef } = usePresentation();
  const changed = !!s.levers && !!s.todayLevers && isChanged(s.levers, s.todayLevers);

  useEffect(() => {
    if (s.levers && s.todayLevers)
      saveLevers(route.projekt, changed ? s.levers : null, s.todayLevers);
  }, [route.projekt, s.levers, s.todayLevers, changed]);

  // Den Dateinamen des PDFs bestimmt der Seitentitel: Beim Drucken nennt er das Projekt.
  const printName = project ? `${project.name} · Airport Energy Check` : null;
  useEffect(() => {
    if (!printName) return;
    let before: string | null = null;
    const start = () => {
      before ??= document.title;
      document.title = printName;
    };
    const end = () => {
      if (before !== null) document.title = before;
      before = null;
    };
    window.addEventListener("beforeprint", start);
    window.addEventListener("afterprint", end);
    return () => {
      window.removeEventListener("beforeprint", start);
      window.removeEventListener("afterprint", end);
      end();
    };
  }, [printName]);

  const ready = !!(s.today && s.levers && s.todayLevers && s.result && s.todayResult);

  // Verspaetete Abfluege kennt nur die genaue Rechnung. Kommt keine mehr (Beispielprojekt,
  // Fehler), stuenden unter der geaenderten Kurve die roten Balken von heute. Solange sie noch
  // laeuft, bleiben diese stehen, damit sie nicht bei jeder Pause aufblitzen.
  const noDelays = !!s.today && changed && !s.exact && (s.sample || !!s.error);
  const departures = useMemo(() => {
    const bins = (s.exact ?? s.today)?.departures ?? [];
    return noDelays ? bins.map((d) => ({ ...d, delayed: 0 })) : bins;
  }, [s.exact, s.today, noDelays]);

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
          ref={toggleRef}
          className="ap-tool"
          onClick={() => setPresenting(!presenting)}
          aria-pressed={presenting}
          aria-keyshortcuts="P"
          title="Taste P schaltet um, Esc beendet"
        >
          Präsentieren{" "}
          <kbd className="ap-tool__key" aria-hidden="true">
            P
          </kbd>
        </button>
        <button
          type="button"
          className="ap-tool"
          onClick={() => window.print()}
          disabled={!ready || (!s.sample && s.accuracy === "naeherung")}
          title={
            !s.sample && s.accuracy === "naeherung"
              ? "Erst wenn die Rechnung fertig ist"
              : "Als PDF sichern: im Druckdialog „Als PDF speichern“ wählen"
          }
        >
          Als PDF sichern
        </button>
      </header>

      <main id="aec-main" tabIndex={-1} className="ap-page">
        {s.accuracy === "fehler" && !s.today ? (
          <p className="ap-error" role="alert">
            {s.error}
            {s.errorInData ? (
              <>
                {" "}
                <Link to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}>
                  Zu den Daten
                </Link>
              </>
            ) : null}
          </p>
        ) : !s.today || !s.levers || !s.todayLevers || !s.result || !s.todayResult ? (
          <p className="ap-loading" role="status">
            {!project || checking ? "Projekt wird geöffnet …" : "Der Tag wird gerechnet …"}
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
              fleetVehicles={s.today.basis.fleet.classes.reduce((n, c) => n + c.vehicles, 0)}
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
                departures={departures}
                changed={changed}
              />
              <Outcome
                today={s.todayResult}
                todayPreview={s.today}
                result={s.result}
                exact={s.exact}
                accuracy={s.error ? "fehler" : s.accuracy}
                changed={changed}
                sample={s.sample}
              />
              <Shortfalls result={s.result} />
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
                  lost={lost}
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
