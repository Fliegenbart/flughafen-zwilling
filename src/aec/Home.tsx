import { useEffect, useState, type FormEvent } from "react";
import { createProject, listProjects } from "./api/projects";
import { saveAssets } from "./api/data";
import { distributeFleet, MAX_FLEET } from "./model/dataStatus";
import { FOCUS_KEY } from "./views/DatenView";
import { useNav } from "./context";
import Link from "./Link";
import { SAMPLE_PROJECT } from "./sample";
import type { Project } from "./types";
import "./home-entry.css";

const FLOW = ["Flughafentag", "Engpass", "Varianten", "Prüfplan"];
const QUESTIONS = [
  ["Wo kollidieren Ladefenster?", "Busse, Schlepper und Bodenstromgeräte im Einsatzplan betrachten."],
  ["Was begrenzt den Betrieb?", "Netzanschluss, Photovoltaik und Speicher als ein gekoppeltes System prüfen."],
  ["Welche Variante trägt?", "Maßnahmen gegen gleiche Fahrzeugeinsätze und Zeitfenster vergleichen."],
];

export default function Home() {
  const nav = useNav();
  const [projects, setProjects] = useState<Project[]>([SAMPLE_PROJECT]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [fleet, setFleet] = useState(100);
  const extraProjects = projects.filter((project) => project.id !== SAMPLE_PROJECT.id);

  useEffect(() => {
    let alive = true;
    void listProjects().then((list) => alive && setProjects(list));
    return () => {
      alive = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const airport = String(form.get("airport") ?? "").trim();
    if (!name || !airport) {
      setError("Projektname und Flughafen fehlen.");
      return;
    }

    setError("");
    setCreating(true);
    const project = await createProject({
      name,
      airport,
      decision:
        String(form.get("decision") ?? "").trim() ||
        "Reicht der Netzanschluss für die elektrische Vorfeldflotte?",
      gridLimitKw: Math.max(100, Number(form.get("limit") ?? 3.5) * 1000),
      fleetSize: Math.max(1, Number(form.get("fleet") ?? 100)),
    });

    if (project.source === "api") {
      const number = (key: string) => Number(String(form.get(key) ?? "").replace(",", "."));
      const entries = [
        { key: "grid_import_limit_kw", value: Math.max(100, number("limit") * 1000), unit: "kW" },
        { key: "pv_capacity_kwp", value: number("pv"), unit: "kWp" },
        { key: "battery_capacity_kwh", value: number("storage"), unit: "kWh" },
      ]
        .concat(
          distributeFleet(number("fleet")).flatMap((item) => [
            { key: `fleet.${item.kind}.vehicles`, value: item.vehicles, unit: "Stück" },
            { key: `fleet.${item.kind}.chargers`, value: item.chargers, unit: "Stück" },
          ]),
        )
        .filter((entry) => Number.isFinite(entry.value) && entry.value >= 0)
        .map((entry) => ({ ...entry, source: "", source_date: null }));
      try {
        await saveAssets(project, entries);
      } catch {
        /* Werte lassen sich im Schritt Daten nachtragen. */
      }
    }

    setCreating(false);
    try {
      sessionStorage.setItem(FOCUS_KEY, "flotte");
    } catch {
      /* ohne Fokus-Sprung */
    }
    nav.navigate({ page: "projekt", projekt: project.id, frage: "daten" });
  }

  return (
    <div className="aec-home-entry">
      <section className="aec-entry-hero" aria-labelledby="aec-entry-title">
        <div className="aec-entry-hero__copy">
          <p className="aec-eyebrow aec-eyebrow--night">FLUGHAFEN-SIMULATION</p>
          <h1 id="aec-entry-title">
            Flughafenbetrieb simulieren. <em>Elektrifizierung gezielt testen.</em>
          </h1>
          <p className="aec-entry-hero__lead">
            Wenn Busse, Gepäckschlepper und Bodenstromgeräte elektrisch werden, müssen
            Fahrzeugeinsatz und Laden zusammenpassen. Verändern Sie Netzleistung, PV, Speicher
            oder Fahrzeugzahl und vergleichen Sie die berechneten Auswirkungen.
          </p>
          <div className="aec-entry-actions">
            <Link
              to={{ page: "arbeitsplatz", projekt: SAMPLE_PROJECT.id }}
              className="aec-entry-button aec-entry-button--primary"
            >
              Simulation selbst ausprobieren
            </Link>
            <a className="aec-entry-button aec-entry-button--quiet" href="#project-create">
              Eigene Untersuchung starten
            </a>
          </div>
        </div>

        <figure className="aec-entry-chart" aria-labelledby="aec-entry-chart-title">
          <figcaption>
            <span id="aec-entry-chart-title">Beispiel: gekoppelte Betriebslasten</span>
            <span>Illustration</span>
          </figcaption>
          <div className="aec-entry-chart__plot" aria-hidden="true">
            <span className="aec-entry-chart__grid" />
            <span className="aec-entry-chart__limit" />
            <span className="aec-entry-chart__area" />
            <span className="aec-entry-chart__line" />
            <span className="aec-entry-chart__marker aec-entry-chart__marker--one" />
            <span className="aec-entry-chart__marker aec-entry-chart__marker--two" />
          </div>
          <p>
            Grafik ist illustrativ und nicht berechnet. Die interaktive Simulation startet im
            Beispielprojekt.
          </p>
        </figure>
      </section>

      <section className="aec-entry-value" aria-labelledby="aec-entry-value-title">
        <div className="aec-entry-section-head">
          <span className="aec-eyebrow">Entscheidungsfragen</span>
          <h2 id="aec-entry-value-title">Den Betrieb vor dem Ausbau durchspielen.</h2>
        </div>
        <ol className="aec-entry-questions">
          {QUESTIONS.map(([title, description], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="aec-entry-flow" aria-labelledby="aec-entry-flow-title">
        <div className="aec-entry-section-head">
          <span className="aec-eyebrow">Ablauf</span>
          <h2 id="aec-entry-flow-title">Vom Verkehrstag zur belastbaren nächsten Prüfung.</h2>
        </div>
        <ol>
          {FLOW.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="aec-entry-sample" aria-labelledby="aec-entry-sample-title">
        <div className="aec-entry-section-head">
          <span className="aec-eyebrow">Kuratiertes Beispiel</span>
          <h2 id="aec-entry-sample-title">MUC · Vorfeld Süd · synthetisches Beispiel</h2>
        </div>
        <div className="aec-entry-sample__card">
          <p>
            Ein vorbereiteter Flughafenbetrieb mit Flotte, Anschluss, Photovoltaik und Speicher.
            Zum Erkunden der interaktiven Simulation.
          </p>
          <Link
            to={{ page: "arbeitsplatz", projekt: SAMPLE_PROJECT.id }}
            className="aec-entry-text-link"
          >
            Beispielprojekt öffnen
          </Link>
        </div>
        {extraProjects.length > 0 ? (
          <details className="aec-entry-more">
            <summary>Weitere Projekte</summary>
            <ul>
              {extraProjects.map((project) => (
                <li key={project.id}>
                  <Link to={{ page: "projekt", projekt: project.id, frage: "lage", auto: true }}>
                    <strong>{project.name}</strong>
                    <span>
                      {project.airport}
                      {project.fleetSize ? ` · ${project.fleetSize} Fahrzeuge` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="aec-entry-create" id="project-create" aria-labelledby="aec-new-title">
        <div className="aec-entry-section-head">
          <span className="aec-eyebrow">Eigene Untersuchung</span>
          <h2 id="aec-new-title">Eigene Ausgangslage anlegen.</h2>
        </div>
        <form className="aec-new" onSubmit={submit} noValidate>
          <label>
            Projektname
            <input name="name" required placeholder="z. B. HAM · Vorfeld Nord" autoComplete="off" />
          </label>
          <label>
            Flughafen und Anschlusspunkt
            <input
              name="airport"
              required
              placeholder="z. B. Hamburg, Trafo Vorfeld Nord"
              autoComplete="off"
            />
          </label>
          <div className="aec-new__row">
            <label>
              Netzanschluss (MW)
              <input name="limit" type="number" inputMode="decimal" min="0.1" step="0.1" defaultValue="3.5" />
            </label>
            <label>
              Photovoltaik (kWp)
              <input name="pv" type="number" inputMode="decimal" min="0" step="any" defaultValue="7000" />
            </label>
            <label>
              Batteriespeicher (kWh)
              <input name="storage" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" />
            </label>
            <label>
              Elektrofahrzeuge (Anzahl)
              <input
                name="fleet"
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_FLEET}
                step="1"
                defaultValue="100"
                onChange={(event) => setFleet(Number(event.target.value))}
              />
            </label>
            <p className="aec-fine aec-new__split" aria-live="polite">
              Vorläufig aufgeteilt in {distributeFleet(fleet).map((item) => `${item.vehicles} ${item.label}`).join(", ")};
              das lässt sich im nächsten Schritt ändern.
            </p>
          </div>
          <label>
            Was wollen Sie entscheiden?
            <textarea
              name="decision"
              rows={2}
              placeholder="Reicht der Netzanschluss für die elektrische Vorfeldflotte?"
            />
          </label>
          {error ? <p className="aec-error" role="alert">{error}</p> : null}
          <button type="submit" className="aec-button" disabled={creating}>
            {creating ? "Wird angelegt …" : "Untersuchung anlegen"}
          </button>
          <p className="aec-fine">
            Ohne Quellenangabe zählen die Werte als Annahme. Belege tragen Sie im nächsten Schritt nach.
          </p>
        </form>
      </section>
    </div>
  );
}
