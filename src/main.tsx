import React from "react";
import { createRoot } from "react-dom/client";
import WorkspaceApp from "./WorkspaceApp";

const rootElement = document.getElementById("root") as HTMLElement;

createRoot(rootElement).render(
  <React.StrictMode>
    <WorkspaceApp />
  </React.StrictMode>,
);
