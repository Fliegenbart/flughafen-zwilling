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
  { id: "abgleich", label: "Abgleich", question: "Stimmt das?" },
  { id: "nachweis", label: "Nachweis", question: "Was können wir zusagen?" },
] as const;
export type Question = (typeof QUESTIONS)[number]["id"];

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

export type Route =
  | { page: "start" }
  | { page: "bibliothek"; werkstatt?: "simulation" }
  | { page: "projekt"; projekt: string; frage: Question; werkstatt?: Werkstatt };

const isQuestion = (v: string | null): v is Question => QUESTIONS.some((q) => q.id === v);
const isWerkstatt = (v: string | null): v is Werkstatt => WERKSTATT.includes(v as Werkstatt);

/** Welche Frage beherbergt welches Bestandswerkzeug. */
export const WERKSTATT_HOME: Record<Werkstatt, Question> = {
  system: "lage",
  betrieb: "engpass",
  robustheit: "varianten",
  pilot: "abgleich",
  flexlab: "abgleich",
  nachweise: "nachweis",
  simulation: "varianten",
};

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const werkstatt = p.get("werkstatt");
  if (p.get("seite") === "bibliothek")
    return werkstatt === "simulation" ? { page: "bibliothek", werkstatt } : { page: "bibliothek" };
  const projekt = p.get("projekt");
  if (projekt) {
    const frage = p.get("frage");
    return {
      page: "projekt",
      projekt,
      frage: isQuestion(frage) ? frage : "lage",
      ...(isWerkstatt(werkstatt) ? { werkstatt } : {}),
    };
  }
  return { page: "start" };
}

export function toSearch(route: Route): string {
  const p = new URLSearchParams();
  if (route.page === "bibliothek") {
    p.set("seite", "bibliothek");
    if (route.werkstatt) p.set("werkstatt", route.werkstatt);
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

/** Neue Adresse fuer eine alte `?workspace=`-URL, sonst null. */
export function legacyRedirect(search: string): string | null {
  const p = new URLSearchParams(search);
  const ws = p.get("workspace");
  if (ws === null) return null;
  const projekt = p.get("projekt") ?? SAMPLE_PROJECT.id;
  if (ws === "munich") {
    const step = p.get("schritt");
    const werkstatt: Werkstatt = (MUNICH_STEPS as readonly string[]).includes(step ?? "")
      ? (step as Werkstatt)
      : "system";
    return toSearch({ page: "projekt", projekt, frage: WERKSTATT_HOME[werkstatt], werkstatt });
  }
  if (ws === "flexlab")
    return toSearch({ page: "projekt", projekt, frage: "abgleich", werkstatt: "flexlab" });
  // airport und unbekannte Werte: frueher immer die Abfertigungssimulation.
  return toSearch({ page: "bibliothek", werkstatt: "simulation" });
}

export const href = (basePath: string, route: Route) => `${basePath}${toSearch(route)}`;
