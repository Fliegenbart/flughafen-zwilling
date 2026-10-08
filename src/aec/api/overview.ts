/** Uebersicht fuer die Zusage: Evidenz je Element, gesperrte Kriterien. */
import type { EvidenceLevel } from "../../ui/EvidenceBadge";
import type { Fleet, Project } from "../types";
import { fleetFromApi } from "./situation";
import { request as call } from "./http";
import { enc, EVIDENCE_FROM_API, evidence, isObj, num, str } from "./parse";

export type Overview = {
  source: "api" | "beispiel";
  locked: boolean;
  sha256: string | null;
  elements: {
    kind: string;
    refId: string;
    title: string;
    status: string;
    evidence: EvidenceLevel;
  }[];
  summary: Partial<Record<EvidenceLevel, number>>;
  fleet?: Fleet;
};

export async function getOverview(project: Project): Promise<Overview> {
  if (project.source === "api") {
    try {
      const d = await call<unknown>(`/projects/${enc(project.id)}/overview`);
      if (isObj(d) && Array.isArray(d.elements)) {
        const acc = isObj(d.acceptance) ? d.acceptance : {};
        const summary: Overview["summary"] = {};
        if (isObj(d.evidence_summary))
          for (const [k, v] of Object.entries(d.evidence_summary)) {
            const lvl = EVIDENCE_FROM_API[k];
            if (lvl) summary[lvl] = num(v);
          }
        return {
          source: "api",
          locked: acc.locked === true,
          sha256: typeof acc.sha256 === "string" ? acc.sha256 : null,
          elements: d.elements.filter(isObj).map((e) => ({
            kind: str(e.kind),
            refId: str(e.ref_id),
            title: str(e.title, str(e.kind)),
            status: str(e.status),
            evidence: evidence(e.evidence_level),
          })),
          summary,
          fleet: fleetFromApi(d.fleet),
        };
      }
    } catch {
      /* Beispiel */
    }
  }
  return {
    source: "beispiel",
    locked: false,
    sha256: null,
    elements: [],
    summary: { assumption: 3, synthetic: 2, model_checked: 2, empirical_open: 2 },
  };
}
