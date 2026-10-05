import React from "react";
import { createRoot } from "react-dom/client";
import WorkspaceApp from "./WorkspaceApp";
import AccessGate from "./pilot/AccessGate";

const rootElement = document.getElementById("root") as HTMLElement;

createRoot(rootElement).render(
  <React.StrictMode>
    <AccessGate>
      <WorkspaceApp />
    </AccessGate>
  </React.StrictMode>,
);
