/**
 * Adressen des Airport Energy Check. Alles haengt an `?projekt=` und `&frage=`.
 * Alte Arbeitsbereiche (`?workspace=airport|munich|flexlab`) werden auf die
 * passenden neuen Orte umgeleitet; die alten Werkzeuge leben als "Werkstatt" weiter.
 */
import { SAMPLE_PROJECT } from "./sample";
import { caseBySlug } from "./scenarios";

export const QUESTIONS = [
  { id: "lage", label: "Flughafentag", question: "Wie viel Strom braucht der Flughafentag?" },
  { id: "engpass", label: "Engpass", question: "Wann reicht der Anschluss nicht?" },
  {
    id: "varianten",
    label: "Varianten",
    question: "Wie unterscheiden sich die Varianten in der Simulation?",
  },
  { id: "nachweis", label: "Nachweise & Prüfplan", question: "Was ist belegt?" },
] as const;
export type Question = (typeof QUESTIONS)[number]["id"];

/**
 * Schritt "Daten" vor A: was ist echt, was Annahme, was fehlt. Eigenes Schild "0",
 * damit die Buchstaben A–E der fuenf Fragen unveraendert bleiben.
 */
export const DATA_STEP = {
  id: "daten",
  label: "Daten",
  question: "Was liegt schon vor?",
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
/** Werkstaetten des Pruefbereichs; sie oeffnen nie in der Kundensicht. */
export type LabWerkstatt = "pilot" | "flexlab";
const isLabWerkstatt = (v: string | null): v is LabWerkstatt => v === "pilot" || v === "flexlab";

/** Reglerstellung der Kundenseite in der Adresse, damit Links und Lesezeichen sie behalten. */
export type Einstellung = Partial<{
  electric_share_pct: number;
  grid_import_limit_kw: number;
  storage_kwh: number;
  pv_kwp: number;
  parking_sessions: number;
}>;
const EINSTELLUNG: [keyof Einstellung, string][] = [
  ["electric_share_pct", "anteil"],
  ["grid_import_limit_kw", "anschluss"],
  ["storage_kwh", "speicher"],
  ["pv_kwp", "pv"],
  ["parking_sessions", "parkhaus"],
];

function readEinstellung(p: URLSearchParams): Einstellung | undefined {
  const out: Einstellung = {};
  for (const [key, param] of EINSTELLUNG) {
    const raw = p.get(param);
    const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function writeEinstellung(p: URLSearchParams, e: Einstellung | undefined) {
  for (const [key, param] of EINSTELLUNG) if (e?.[key] !== undefined) p.set(param, String(e[key]));
}

export type Route =
  /** flughafen: echter Flughafen (IATA), ohne Angabe der Beispielflughafen. */
  | { page: "start"; einstellung?: Einstellung; flughafen?: string }
  /** Fuer Fachleute: dieselbe Rechnung wie auf der Startseite, ausfuehrlich begruendet. */
  | { page: "fachleute"; einstellung?: Einstellung; flughafen?: string }
  /** Altwerkzeuge (Vergleich mit Messdaten-Uebergabe, eigene Projekte); nirgends verlinkt. */
  | { page: "labor" }
  | { page: "bibliothek"; werkstatt?: "simulation" }
  /** Pruefbereich: Pruefauftraege, Messdaten und Modellabgleich eines Projekts. */
  | { page: "lab"; projekt: string; werkstatt?: LabWerkstatt; run?: string }
  /** Arbeitsbildschirm fuer den Kundentermin (Probe, ?ansicht=neu). */
  | { page: "arbeitsplatz"; projekt: string }
  | {
      page: "projekt";
      projekt: string;
      frage: Step;
      werkstatt?: Exclude<Werkstatt, LabWerkstatt>;
      /** Krisenfall (Slug) als vorgewaehlter Stresstest in C. */
      krise?: string;
      /** Ohne `frage` in der Adresse: Startschritt nach Datenstand (Daten oder Lage). */
      auto?: true;
    };

const isStep = (v: string | null): v is Step => STEPS.some((q) => q.id === v);
const isWerkstatt = (v: string | null): v is Exclude<Werkstatt, LabWerkstatt> =>
  WERKSTATT.includes(v as Werkstatt) && !isLabWerkstatt(v);

/** Welche Frage beherbergt welches Bestandswerkzeug. */
const WERKSTATT_HOME: Record<Exclude<Werkstatt, LabWerkstatt>, Question> = {
  system: "lage",
  betrieb: "engpass",
  robustheit: "varianten",
  nachweise: "nachweis",
  simulation: "varianten",
};

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const werkstatt = p.get("werkstatt");
  const einstellung = readEinstellung(p);
  const raw = p.get("flughafen")?.toUpperCase() ?? "";
  const flughafen = /^[A-Z]{3}$/.test(raw) ? raw : undefined;
  const extra = { ...(einstellung ? { einstellung } : {}), ...(flughafen ? { flughafen } : {}) };
  if (p.get("seite") === "fachleute") return { page: "fachleute", ...extra };
  if (p.get("seite") === "labor") return { page: "labor" };
  if (p.get("seite") === "bibliothek")
    return werkstatt === "simulation" ? { page: "bibliothek", werkstatt } : { page: "bibliothek" };
  const projekt = p.get("projekt");
  if (p.get("seite") === "lab")
    return {
      page: "lab",
      projekt: projekt ?? SAMPLE_PROJECT.id,
      ...(isLabWerkstatt(werkstatt) ? { werkstatt } : {}),
      ...(p.get("run") ? { run: p.get("run")! } : {}),
    };
  if (projekt && p.get("ansicht") === "neu") return { page: "arbeitsplatz", projekt };
  if (projekt) {
    const frage = p.get("frage");
    // Frueher Schritt D "Abgleich" bzw. Lab-Werkstatt im Projekt: jetzt Pruefbereich.
    if (frage === "abgleich" || isLabWerkstatt(werkstatt))
      return { page: "lab", projekt, ...(isLabWerkstatt(werkstatt) ? { werkstatt } : {}) };
    return {
      page: "projekt",
      projekt,
      frage: isStep(frage) ? frage : "lage",
      ...(isWerkstatt(werkstatt) ? { werkstatt } : {}),
      ...(caseBySlug(p.get("krise")) ? { krise: p.get("krise")! } : {}),
      ...(frage === null && !isWerkstatt(werkstatt) ? { auto: true as const } : {}),
    };
  }
  return { page: "start", ...extra };
}

export function toSearch(route: Route): string {
  const p = new URLSearchParams();
  if (route.page === "start") {
    if (route.flughafen) p.set("flughafen", route.flughafen);
    writeEinstellung(p, route.einstellung);
  } else if (route.page === "fachleute") {
    p.set("seite", "fachleute");
    if (route.flughafen) p.set("flughafen", route.flughafen);
    writeEinstellung(p, route.einstellung);
  } else if (route.page === "labor") {
    p.set("seite", "labor");
  } else if (route.page === "bibliothek") {
    p.set("seite", "bibliothek");
    if (route.werkstatt) p.set("werkstatt", route.werkstatt);
  } else if (route.page === "arbeitsplatz") {
    p.set("projekt", route.projekt);
    p.set("ansicht", "neu");
  } else if (route.page === "lab") {
    p.set("seite", "lab");
    p.set("projekt", route.projekt);
    if (route.run) p.set("run", route.run);
    if (route.werkstatt) {
      p.set("werkstatt", route.werkstatt);
      if (route.werkstatt === "pilot") p.set("schritt", "pilot");
    }
  } else if (route.page === "projekt") {
    p.set("projekt", route.projekt);
    if (!route.auto) p.set("frage", route.frage);
    if (route.krise) p.set("krise", route.krise);
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
