import type { Route } from "../routes";
import { Details } from "../parts";
import { WerkstattFrame, WerkstattLinks } from "../Werkstatt";
import MeasurementWorkflow from "./MeasurementWorkflow";
import QuickMeasurementCheck from "./QuickMeasurementCheck";
import { useState } from "react";
type LabRoute = Extract<Route, { page: "lab" }>;
export default function LabPage({ route, theme }: { route: LabRoute; theme?: "light" | "dark" }) {
  const [formal, setFormal] = useState(false);
  return (
    <>
      <QuickMeasurementCheck
        key={`${route.projekt}:${route.run ?? ""}`}
        initialRun={"run" in route ? (route.run as string) : undefined}
      />
      <div className="aec-page">
        <details
          onToggle={(e) => {
            if (e.currentTarget.open) setFormal(true);
          }}
        >
          <summary>Formalen Nachweis mit Prüfkriterien und gespeicherten Daten führen</summary>
          {formal && (
            <>
              <p>
                Separater Expertenablauf mit Server-Upload. In der öffentlichen Demo keine
                vertraulichen Daten hochladen.
              </p>
              <MeasurementWorkflow
                key={route.projekt}
                projectId={route.projekt}
                initialRun={"run" in route ? (route.run as string) : undefined}
              />
            </>
          )}
        </details>
      </div>
      <div className="aec-page">
        <Details summary="Weitere Messdaten-Werkzeuge">
          <WerkstattLinks items={["pilot", "flexlab"]} base={route} />
        </Details>
      </div>
      {route.werkstatt && (
        <WerkstattFrame
          werkstatt={route.werkstatt}
          theme={theme}
          close={{ page: "lab", projekt: route.projekt }}
        />
      )}
    </>
  );
}
