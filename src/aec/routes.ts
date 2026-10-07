/**
 * Adressen des Airport Energy Check. Alles haengt an `?projekt=` und `&frage=`.
 * Alte Arbeitsbereiche (`?workspace=airport|munich|flexlab`) werden auf die
 * passenden neuen Orte umgeleitet; die alten Werkzeuge leben als "Werkstatt" weiter.
 */
import { SAMPLE_PROJECT } from "./sample";

export const QUESTIONS = [
  { id: "lage", label: "Lage", question: "Wie sieht der Tag aus?" },
  { id: "engpass", label: "Engpass", question: "Wo wird es eng?" },
  { id: "varianten", label: "Varianten", question: "Was hilft?" },
  { id: "nachweis", label: "Nachweis", question: "Was können wir zusagen?" },
] as const;
export type Question = (typeof QUESTIONS)[number]["id"];

/**
 * Schritt "Daten" vor A: was ist echt, was Annahme, was fehlt. Eigenes Schild "0",
 * damit die Buchstaben A–E der fuenf Fragen unveraendert bleiben.
 */
export const DATA_STEP = {
  id: "daten",
  label: "Daten",
  question: "Was wissen wir schon?",
} as const;
export type Step = Question | "daten";
export const STEPS = [DATA_STEP, ...QUESTIONS] as const;

/** Werkstatt = vollstaendige Bestandswerkzeuge. */
export type Werkstatt =
  | "system"
  | "betrieb"
  | "robustheit"
  | "pilot"
  | "nachweise"
  | "flexlab"
  | "simulation";
const MUNICH_STEPS = ["system", "betrieb", "robustheit", "pilot", "nachweise"] as const;
const WERKSTATT: Werkstatt[] = [...MUNICH_STEPS, "flexlab", "simulation"];
/** Werkstaetten des Testing-Lab-Backbones; sie oeffnen nie in der Kundensicht. */
export type LabWerkstatt = "pilot" | "flexlab";
const isLabWerkstatt = (v: string | null): v is LabWerkstatt => v === "pilot" || v === "flexlab";

export type Route =
  | { page: "start" }
  | { page: "bibliothek"; werkstatt?: "simulation" }
  /** Testing-Lab-Backbone: Pruefauftraege, Messungen, Modellabgleich eines Projekts. */
  | { page: "lab"; projekt: string; werkstatt?: LabWerkstatt }
  | {
      page: "projekt";
      projekt: string;
      frage: Step;
      werkstatt?: Exclude<Werkstatt, LabWerkstatt>;
      /** Ohne `frage` in der Adresse: Startschritt nach Datenstand (Daten oder Lage). */
      auto?: true;
    };

const isStep = (v: string | null): v is Step => STEPS.some((q) => q.id === v);
const isWerkstatt = (v: string | null): v is Exclude<Werkstatt, LabWerkstatt> =>
  WERKSTATT.includes(v as Werkstatt) && !isLabWerkstatt(v);

/** Welche Frage beherbergt welches Bestandswerkzeug. */
export const WERKSTATT_HOME: Record<Exclude<Werkstatt, LabWerkstatt>, Question> = {
  system: "lage",
  betrieb: "engpass",
  robustheit: "varianten",
  nachweise: "nachweis",
  simulation: "varianten",
};

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
  if (projekt) {
    const frage = p.get("frage");
    // Frueher Schritt D "Abgleich" bzw. Lab-Werkstatt im Projekt: jetzt Testing-Lab.
    if (frage === "abgleich" || isLabWerkstatt(werkstatt))
      return { page: "lab", projekt, ...(isLabWerkstatt(werkstatt) ? { werkstatt } : {}) };
    return {
      page: "projekt",
      projekt,
      frage: isStep(frage) ? frage : "lage",
      ...(isWerkstatt(werkstatt) ? { werkstatt } : {}),
      ...(frage === null && !isWerkstatt(werkstatt) ? { auto: true as const } : {}),
    };
  }
  return { page: "start" };
}

export function toSearch(route: Route): string {
  const p = new URLSearchParams();
  if (route.page === "bibliothek") {
    p.set("seite", "bibliothek");
    if (route.werkstatt) p.set("werkstatt", route.werkstatt);
  } else if (route.page === "lab") {
    p.set("seite", "lab");
    p.set("projekt", route.projekt);
    if (route.werkstatt) {
      p.set("werkstatt", route.werkstatt);
      if (route.werkstatt === "pilot") p.set("schritt", "pilot");
    }
  } else if (route.page === "projekt") {
    p.set("projekt", route.projekt);
    if (!route.auto) p.set("frage", route.frage);
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

/** Neue Adresse fuer eine alte `?workspace=`-URL, sonst null. */
export function legacyRedirect(search: string): string | null {
  const p = new URLSearchParams(search);
  const ws = p.get("workspace");
  if (ws === null) return null;
  const projekt = p.get("projekt") ?? SAMPLE_PROJECT.id;
  if (ws === "munich") {
    const step = p.get("schritt");
    if (step === "pilot") return toSearch({ page: "lab", projekt, werkstatt: "pilot" });
    const werkstatt = (MUNICH_STEPS as readonly string[]).includes(step ?? "")
      ? (step as Exclude<Werkstatt, LabWerkstatt>)
      : "system";
    return toSearch({ page: "projekt", projekt, frage: WERKSTATT_HOME[werkstatt], werkstatt });
  }
  if (ws === "flexlab") return toSearch({ page: "lab", projekt, werkstatt: "flexlab" });
  // airport und unbekannte Werte: frueher immer die Abfertigungssimulation.
  return toSearch({ page: "bibliothek", werkstatt: "simulation" });
}

export const href = (basePath: string, route: Route) => `${basePath}${toSearch(route)}`;
