import { useEffect, type ReactNode } from "react";
import type { EvidenceLevel } from "../../ui/EvidenceBadge";
import type { DataInputs, DataItem, DataItemId, DataStatus } from "../model/dataStatus";
import { AnswerHead } from "../parts";
import type { Route } from "../routes";
import type { Project } from "../types";
import AssetsForm from "./daten/AssetsForm";
import FlightPlanForm from "./daten/FlightPlanForm";
import LabForm from "./daten/LabForm";
import MeasurementForm from "./daten/MeasurementForm";
import { DataCard } from "./daten/shared";

type ProjectRoute = Extract<Route, { page: "projekt" }>;
export type DatenProps = {
  project: Project;
  inputs: DataInputs;
  status: DataStatus;
  reload: () => Promise<void>;
  route: ProjectRoute;
};

/** Warnhinweis an, solange die Runtime-Konfiguration ihn nicht ausdruecklich abschaltet. */
export function sharedDemoNotice(): boolean {
  return globalThis.__TWIN_CONFIG__?.sharedDemoNotice !== false;
}

const BEST: EvidenceLevel[] = ["empirical_passed", "empirical_open", "model_checked", "synthetic"];

export const FOCUS_KEY = "aec.focusData";

export default function DatenView({ project, inputs, status, reload, route }: DatenProps) {
  const disabled = !inputs.available;
  useEffect(() => {
    // Nach "Projekt anlegen": Abschnitt Flotte und Anlagen öffnen und fokussieren.
    let target: string | null = null;
    try {
      target = sessionStorage.getItem(FOCUS_KEY);
      sessionStorage.removeItem(FOCUS_KEY);
    } catch {
      /* ohne Sitzungsspeicher */
    }
    if (!target) return;
    const card = document.getElementById(`punkt-${target}`);
    card?.querySelector("details")?.setAttribute("open", "");
    card?.scrollIntoView?.({ block: "start" });
    requestAnimationFrame(() => card?.querySelector<HTMLInputElement>("form input")?.focus());
  }, []);
  const count = (s: DataItem["state"]) => status.items.filter((i) => i.state === s).length;
  const evidence = BEST.find((l) => status.items.some((i) => i.evidence === l)) ?? "assumption";
  const forms: Record<DataItemId, ReactNode> = {
    flugplan: <FlightPlanForm project={project} reload={reload} disabled={disabled} />,
    flotte: <AssetsForm project={project} inputs={inputs} reload={reload} disabled={disabled} />,
    messdaten: (
      <MeasurementForm
        project={project}
        inputs={inputs}
        reload={reload}
        disabled={disabled}
        route={route}
      />
    ),
    lab: <LabForm project={project} reload={reload} disabled={disabled} />,
  };
  // Ueberschrift = erster Satz; der Rest (was fehlt, was Annahme ist) steht darunter.
  const cut = status.answer.indexOf(". ");
  const headline = cut >= 0 ? status.answer.slice(0, cut + 1) : status.answer;
  const detail = cut >= 0 ? status.answer.slice(cut + 2) : "";
  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Ihre Daten · Was liegt schon vor?"
        answer={headline}
        lead={detail || undefined}
        evidence={evidence}
        source={inputs.available ? "api" : "beispiel"}
        kpis={[
          { value: String(status.real), unit: "von 4", label: "mit Quelle belegt" },
          { value: String(count("annahme")), label: "noch Annahme" },
          {
            value: String(count("fehlt")),
            label: "fehlen noch",
            tone: count("fehlt") ? "signal" : undefined,
          },
        ]}
      />
      {sharedDemoNotice() ? (
        <aside className="aec-dwarn" role="note" aria-label="Hinweis zur Demo-Instanz">
          <strong>Keine echten Kundendaten hochladen.</strong> Alle mit Demo-Zugang sehen, was hier
          liegt. Für echte Daten gibt es eine eigene Umgebung mit persönlicher Anmeldung.
        </aside>
      ) : null}
      {disabled ? (
        <p className="aec-notice">
          {project.source === "beispiel"
            ? "Im Beispielprojekt lassen sich keine Daten eintragen, dafür braucht es ein eigenes Projekt."
            : "Der Server antwortet nicht, Eintragen ist gerade nicht möglich."}
        </p>
      ) : null}
      <ol className="aec-dlist-cards" aria-label="Die vier Datenquellen">
        {status.items.map((item, i) => (
          <DataCard key={item.id} item={item} index={i}>
            {forms[item.id]}
          </DataCard>
        ))}
      </ol>
    </>
  );
}
