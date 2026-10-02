import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import Workbench from "./lab/Workbench";

const AirportApp = lazy(() => import("./App"));
const showAirport = new URLSearchParams(window.location.search).get("workspace") === "airport";

const rootElement = document.getElementById("root") as HTMLElement;

createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={<p>Arbeitsplatz wird geladen…</p>}>
      {showAirport ? <AirportApp /> : <Workbench />}
    </Suspense>
  </React.StrictMode>,
);
