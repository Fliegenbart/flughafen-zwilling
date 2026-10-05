import { lazy, Suspense, useEffect } from "react";
import AirportWorkspaceShell from "./ui/AirportWorkspaceShell";
import "./WorkspaceApp.css";

const AirportApp = lazy(() => import("./App"));
const FlexLabApp = lazy(() => import("./lab/Workbench"));
const MunichApp = lazy(() => import("./munich/MunichPilot"));

export default function WorkspaceApp() {
  const basePath = import.meta.env.BASE_URL;
  const isFlexLab = new URLSearchParams(window.location.search).get("workspace") === "flexlab";
  const isMunich = new URLSearchParams(window.location.search).get("workspace") === "munich";
  const title = isFlexLab
    ? "FlexLab Workbench"
    : isMunich
      ? "München / Airport Twin Core"
      : "Airport Twin Core";

  useEffect(() => {
    document.title = title;
  }, [title]);

  if (!isFlexLab) {
    return (
      <AirportWorkspaceShell workspace={isMunich ? "munich" : "airport"} basePath={basePath}>
        <Suspense
          fallback={
            <p className="workspace-loading" role="status">
              {title} wird geladen…
            </p>
          }
        >
          {isMunich ? <MunichApp /> : <AirportApp />}
        </Suspense>
      </AirportWorkspaceShell>
    );
  }

  return (
    <div className="workspace-frame workspace-frame--flexlab">
      <header className="workspace-selector">
        <div className="workspace-selector__intro">
          <strong>Airport Twin Core / TestingLab</strong>
          <span>
            Flughafenbetrieb, Energie-Referenzpilot und separate Messdatenauswertung. Keine reale
            Anlagensteuerung.
          </span>
        </div>
        <nav className="workspace-selector__links" aria-label="Arbeitsbereich wählen">
          <a
            href={`${basePath}?workspace=airport`}
            aria-current={!isFlexLab && !isMunich ? "page" : undefined}
          >
            <span>Flughafen</span>
            <strong>Airport Twin Core</strong>
          </a>
          <a href={`${basePath}?workspace=munich`} aria-current={isMunich ? "page" : undefined}>
            <span>Flughafen / Energiepilot</span>
            <strong>München Referenz</strong>
          </a>
          <a href={`${basePath}?workspace=flexlab`} aria-current={isFlexLab ? "page" : undefined}>
            <span>Messdaten / Zusatzwerkzeug</span>
            <strong>FlexLab Workbench</strong>
          </a>
        </nav>
      </header>
      <Suspense
        fallback={
          <p className="workspace-loading" role="status">
            {title} wird geladen…
          </p>
        }
      >
        <FlexLabApp />
      </Suspense>
    </div>
  );
}
