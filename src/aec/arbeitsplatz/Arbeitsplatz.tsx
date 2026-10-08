/**
 * Arbeitsbildschirm fuer den Kundentermin: Regler links, Tageskurve rechts, Vergleich darunter.
 * Ersetzt nach Abnahme die Seiten Tag, Engpass und Loesungen (?ansicht=neu).
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./arbeitsplatz.css";
import { useEffect, useState } from "react";
import { getProject } from "../api/projects";
import Link from "../Link";
import type { Route } from "../routes";
import type { Project } from "../types";
import LeverPanel from "./LeverPanel";
import LoadChart from "./LoadChart";
import Outcome from "./Outcome";
import { useLiveScenario } from "./useLiveScenario";

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
  const s = useLiveScenario(project);
  const changed =
    !!s.levers &&
    !!s.todayLevers &&
    (s.levers.gridLimitKw !== s.todayLevers.gridLimitKw ||
      s.levers.batteryKwh !== s.todayLevers.batteryKwh ||
      s.levers.pvFactor !== s.todayLevers.pvFactor ||
      (s.levers.extraVehicles ?? 0) > 0);

  return (
    <div className="ap">
      <header className="ap-head">
        <Link to={{ page: "start" }} className="ap-head__back" label="Zurück zu allen Projekten">
          Projekte
        </Link>
        <h1 className="ap-head__title">{project?.name ?? "Projekt wird geladen …"}</h1>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}
          className="ap-head__link"
        >
          Daten ergänzen
        </Link>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "lage" }}
          className="ap-head__link"
        >
          Bisherige Ansicht
        </Link>
      </header>

      {s.accuracy === "fehler" && !s.today ? (
        <p className="ap-error" role="alert">
          {s.error} Für eine Kurve braucht das Projekt einen Flugplan unter „Daten ergänzen“.
        </p>
      ) : !s.today || !s.levers || !s.todayLevers || !s.result || !s.todayResult ? (
        <p className="ap-loading" role="status">
          Der Tag wird gerechnet …
        </p>
      ) : (
        <div className="ap-body">
          <LeverPanel
            levers={s.levers}
            today={s.todayLevers}
            onChange={s.setLevers}
            onReset={s.reset}
          />
          <div className="ap-main">
            <LoadChart
              result={s.result}
              today={s.todayResult}
              departures={(s.exact ?? s.today).departures}
              changed={changed}
            />
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
          </div>
        </div>
      )}
    </div>
  );
}
