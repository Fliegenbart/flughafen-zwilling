import type { Route } from "../routes";
import { Details } from "../parts";
import { WerkstattFrame, WerkstattLinks } from "../Werkstatt";
import MeasurementWorkflow from "./MeasurementWorkflow";
type LabRoute = Extract<Route, { page: "lab" }>;
export default function LabPage({ route, theme }: { route: LabRoute; theme?: "light" | "dark" }) {
  return (
    <>
      <MeasurementWorkflow
        projectId={route.projekt}
        initialRun={"run" in route ? (route.run as string) : undefined}
      />
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
