/**
 * Adressen des Airport Energy Check. Alles haengt an `?projekt=`.
 *
 *   ?projekt=<id>                       Durchrechnen (Hauptseite, Regler und Tageskurve)
 *   ?projekt=<id>&krise=<slug>          Durchrechnen, Krisenfall vorgewaehlt
 *   ?projekt=<id>&frage=daten           Daten
 *   ?projekt=<id>&frage=nachweis        Zusage
 *   ?seite=lab&projekt=<id>             Testing-Lab-Raum
 *   ?seite=bibliothek                   Szenario-Bibliothek
 *
 * Alte Adressen bleiben gueltig: frage=lage|engpass|varianten und ansicht=neu fuehren auf
 * Durchrechnen, `?workspace=airport|munich|flexlab` auf die passenden neuen Orte. Die alten
 * Werkzeuge leben als "Detailwerkzeug" (werkstatt) weiter.
 */
import { SAMPLE_PROJECT } from "./sample";
import { caseBySlug } from "./scenarios";

/** Die drei Schritte eines Projekts, in der Reihenfolge der Navigation. */
export const STEPS = [
  { id: "daten", label: "Daten", question: "Was liegt schon vor?" },
  { id: "rechnen", label: "Durchrechnen", question: "Wo wird es eng, und was hilft?" },
  { id: "nachweis", label: "Zusage", question: "Was können wir versprechen?" },
] as const;
export type Step = (typeof STEPS)[number]["id"];
/** Schritte, die auf der Projektseite (ProjectPage) liegen; Durchrechnen hat eine eigene Seite. */
export type ProjectStep = Exclude<Step, "rechnen">;

/** Detailwerkzeuge der Bestandswerkzeuge. */
export type Werkstatt =
  | "system"
  | "betrieb"
  | "robustheit"
  | "pilot"
  | "nachweise"
  | "flexlab"
  | "simulation";
/** Detailwerkzeuge, die im Projekt neben Daten und Zusage liegen. */
export type ProjectWerkstatt = "system" | "betrieb" | "robustheit" | "nachweise";
/** Detailwerkzeuge des Testing-Lab-Raums; sie oeffnen nie in der Kundensicht. */
export type LabWerkstatt = "pilot" | "flexlab";

const MUNICH_STEPS = ["system", "betrieb", "robustheit", "pilot", "nachweise"] as const;
const isLabWerkstatt = (v: string | null): v is LabWerkstatt => v === "pilot" || v === "flexlab";
const isProjectWerkstatt = (v: string | null): v is ProjectWerkstatt =>
  v === "system" || v === "betrieb" || v === "robustheit" || v === "nachweise";

/** Auf welcher Projektseite liegt welches Detailwerkzeug? */
export const WERKSTATT_HOME: Record<ProjectWerkstatt, ProjectStep> = {
  system: "daten",
  betrieb: "nachweis",
  robustheit: "nachweis",
  nachweise: "nachweis",
};

export type Route =
  | { page: "start" }
  | { page: "bibliothek"; werkstatt?: "simulation" }
  /** Testing-Lab-Backbone: Pruefauftraege, Messungen, Modellabgleich eines Projekts. */
  | { page: "lab"; projekt: string; werkstatt?: LabWerkstatt }
  /** Durchrechnen: Regler, Tageskurve, Vergleich. */
  | {
      page: "arbeitsplatz";
      projekt: string;
      /** Krisenfall (Slug aus scenarios.ts), beim Oeffnen vorgewaehlt. */
      krise?: string;
      /** Adresse ohne weitere Angaben: ohne Flugplan zuerst zu Daten. */
      auto?: true;
    }
  | { page: "projekt"; projekt: string; frage: ProjectStep; werkstatt?: ProjectWerkstatt };

/** Adresse eines Schritts; Durchrechnen ist eine eigene Seite, die anderen liegen im Projekt. */
export function stepRoute(projekt: string, step: Step): Route {
  return step === "rechnen"
    ? { page: "arbeitsplatz", projekt }
    : { page: "projekt", projekt, frage: step };
}

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const werkstatt = p.get("werkstatt");
  if (p.get("seite") === "bibliothek")
    return werkstatt === "simulation" ? { page: "bibliothek", werkstatt } : { page: "bibliothek" };
  const projekt = p.get("projekt");
  if (p.get("seite") === "lab")
    return {
      page: "lab",
      projekt: projekt ?? SAMPLE_PROJECT.id,
      ...(isLabWerkstatt(werkstatt) ? { werkstatt } : {}),
    };
  if (!projekt) return { page: "start" };
  const frage = p.get("frage");
  // Frueher Schritt "Abgleich" bzw. Lab-Werkstatt im Projekt: jetzt Testing-Lab.
  if (frage === "abgleich" || isLabWerkstatt(werkstatt))
    return { page: "lab", projekt, ...(isLabWerkstatt(werkstatt) ? { werkstatt } : {}) };
  // Die Abfertigungssimulation lebt in der Bibliothek.
  if (werkstatt === "simulation") return { page: "bibliothek", werkstatt };
  if (isProjectWerkstatt(werkstatt))
    return { page: "projekt", projekt, frage: WERKSTATT_HOME[werkstatt], werkstatt };
  if (frage === "daten" || frage === "nachweis") return { page: "projekt", projekt, frage };
  const krise = p.get("krise");
  return {
    page: "arbeitsplatz",
    projekt,
    ...(caseBySlug(krise) ? { krise: krise! } : {}),
    // Nur die nackte Adresse prueft beim Oeffnen, ob schon ein Flugplan da ist.
    ...(frage === null && p.get("ansicht") === null ? { auto: true as const } : {}),
  };
}

export function toSearch(route: Route): string {
  const p = new URLSearchParams();
  if (route.page === "bibliothek") {
    p.set("seite", "bibliothek");
    if (route.werkstatt) p.set("werkstatt", route.werkstatt);
  } else if (route.page === "arbeitsplatz") {
    p.set("projekt", route.projekt);
    if (route.krise) p.set("krise", route.krise);
  } else if (route.page === "lab") {
    p.set("seite", "lab");
    p.set("projekt", route.projekt);
    if (route.werkstatt) {
      p.set("werkstatt", route.werkstatt);
      if (route.werkstatt === "pilot") p.set("schritt", "pilot");
    }
  } else if (route.page === "projekt") {
    p.set("projekt", route.projekt);
    p.set("frage", route.frage);
    if (route.werkstatt) {
      p.set("werkstatt", route.werkstatt);
      // Der Schritt-Navigator des Bestandswerkzeugs liest `schritt`.
      if ((MUNICH_STEPS as readonly string[]).includes(route.werkstatt))
        p.set("schritt", route.werkstatt);
    }
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Neue Adresse fuer eine alte, sonst null. Wird beim Einstieg einmal angewandt (nie bei jedem
 * Routenwechsel: das eingebettete Muenchen-Werkzeug fuehrt eigene `schritt`-Parameter).
 */
export function legacyRedirect(search: string): string | null {
  const p = new URLSearchParams(search);
  const ws = p.get("workspace");
  if (ws === null) {
    // Projektadressen der frueheren Seiten Tag, Engpass, Loesungen und der Probeansicht.
    const projekt = p.get("projekt");
    const frage = p.get("frage");
    const old =
      p.get("ansicht") !== null ||
      (frage !== null && !["daten", "nachweis", "abgleich"].includes(frage));
    if (!projekt || p.get("seite") !== null || !old) return null;
    const next = toSearch(parseRoute(search));
    return next === search ? null : next;
  }
  const projekt = p.get("projekt") ?? SAMPLE_PROJECT.id;
  if (ws === "munich") {
    const step = p.get("schritt");
    if (step === "pilot") return toSearch({ page: "lab", projekt, werkstatt: "pilot" });
    const werkstatt = isProjectWerkstatt(step) ? step : "system";
    return toSearch({
      page: "projekt",
      projekt,
      frage: WERKSTATT_HOME[werkstatt],
      werkstatt,
    });
  }
  if (ws === "flexlab") return toSearch({ page: "lab", projekt, werkstatt: "flexlab" });
  // airport und unbekannte Werte: frueher immer die Abfertigungssimulation.
  return toSearch({ page: "bibliothek", werkstatt: "simulation" });
}

export const href = (basePath: string, route: Route) => `${basePath}${toSearch(route)}`;
