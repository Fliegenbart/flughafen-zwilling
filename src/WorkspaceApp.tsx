import { lazy, Suspense, useEffect } from "react";
import "./WorkspaceApp.css";

const AirportApp = lazy(() => import("./App"));
const FlexLabApp = lazy(() => import("./lab/Workbench"));

export default function WorkspaceApp() {
  const isFlexLab = new URLSearchParams(window.location.search).get("workspace") === "flexlab";
  const title = isFlexLab ? "FlexLab Workbench" : "Airport Twin Core";

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className={`workspace-frame workspace-frame--${isFlexLab ? "flexlab" : "airport"}`}>
      <header className="workspace-selector">
        <div className="workspace-selector__intro">
          <strong>TestingLab / Zwei Arbeitsbereiche</strong>
          <span>Flughafen-Stresstests und separate Messdatenauswertung. Keine reale Anlagensteuerung.</span>
        </div>
        <nav className="workspace-selector__links" aria-label="Arbeitsbereich wählen">
          <a href="/?workspace=airport" aria-current={!isFlexLab ? "page" : undefined}>
            <span>Flughafen</span>
            <strong>Airport Twin Core</strong>
          </a>
          <a href="/?workspace=flexlab" aria-current={isFlexLab ? "page" : undefined}>
            <span>Messdaten / Zusatzwerkzeug</span>
            <strong>FlexLab Workbench</strong>
          </a>
        </nav>
      </header>
      <Suspense fallback={<p className="workspace-loading" role="status">{title} wird geladen…</p>}>
        {isFlexLab ? <FlexLabApp /> : <AirportApp />}
      </Suspense>
    </div>
  );
}
