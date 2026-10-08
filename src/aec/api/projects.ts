/** Projekte: Liste, Laden, Anlegen (Server oder lokal fuer Beispielprojekte). */
import { SAMPLE_PROJECT } from "../sample";
import type { Project } from "../types";
import { request as call } from "./http";
import { enc, isObj, str } from "./parse";

const LOCAL_PROJECTS = "aec.localProjects";

function localProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_PROJECTS) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw.filter(isObj) as Project[]) : [];
  } catch {
    return [];
  }
}

function fromPilot(p: Record<string, unknown>): Project {
  return {
    id: str(p.id),
    name: str(p.name, "Projekt"),
    airport: str(p.scope, "Flughafen"),
    site: str(p.scope, ""),
    dayLabel: "Ihr gerechneter Tag",
    fleetSize: 0,
    gridLimitKw: 3500,
    decision: str(p.decision),
    source: "api",
  };
}

export async function listProjects(): Promise<Project[]> {
  let remote: Project[] = [];
  try {
    const data = await call<unknown>("/pilot/projects");
    if (Array.isArray(data))
      remote = data
        .filter((p) => isObj(p) && typeof p.id === "string")
        .map((p) => fromPilot(p as Record<string, unknown>));
  } catch {
    /* ohne Backend: nur Beispiel und lokale Entwuerfe */
  }
  return [SAMPLE_PROJECT, ...remote, ...localProjects()];
}

export async function getProject(id: string): Promise<Project> {
  if (id === SAMPLE_PROJECT.id) return SAMPLE_PROJECT;
  const local = localProjects().find((p) => p.id === id);
  if (local) return local;
  try {
    const data = await call<unknown>(`/pilot/projects/${enc(id)}`);
    if (isObj(data) && typeof data.id === "string") return fromPilot(data);
  } catch {
    /* faellt unten auf das Beispiel zurueck */
  }
  return { ...SAMPLE_PROJECT, id, name: SAMPLE_PROJECT.name };
}

export type NewProject = {
  name: string;
  airport: string;
  decision: string;
  gridLimitKw: number;
  fleetSize: number;
};

export async function createProject(input: NewProject): Promise<Project> {
  try {
    const data = await call<unknown>("/pilot/projects", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        decision: input.decision,
        scope: input.airport,
        acceptance_note: `Anschlussgrenze ${input.gridLimitKw} kW, Flotte ${input.fleetSize} Fahrzeuge (Annahmen).`,
      }),
    });
    if (isObj(data) && typeof data.id === "string")
      return { ...fromPilot(data), gridLimitKw: input.gridLimitKw, fleetSize: input.fleetSize };
  } catch {
    /* lokal anlegen */
  }
  const project: Project = {
    id: `lokal-${Date.now().toString(36)}`,
    name: input.name,
    airport: input.airport,
    site: input.airport,
    dayLabel: "Entwurf ohne Backend",
    fleetSize: input.fleetSize,
    gridLimitKw: input.gridLimitKw,
    decision: input.decision,
    source: "beispiel",
  };
  try {
    localStorage.setItem(LOCAL_PROJECTS, JSON.stringify([...localProjects(), project]));
  } catch {
    /* nur in dieser Sitzung */
  }
  return project;
}
