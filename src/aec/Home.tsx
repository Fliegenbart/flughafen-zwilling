import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createProject, listProjects } from "./api/projects";
import { saveAssets } from "./api/data";
import { distributeFleet, MAX_FLEET } from "./model/dataStatus";
import { FOCUS_KEY } from "./views/DatenView";
import { clock, powerText } from "./model/format";
import { limitWindows } from "./model/situation";
import { useNav } from "./context";
import DayLandscape from "./DayLandscape";
import Link from "./Link";
import { SourceTag } from "./parts";
import { QUESTIONS } from "./routes";
import { SAMPLE_PROJECT, sampleSituation } from "./sample";
import { SCENARIO_CASES } from "./scenarios";
import ScenarioViz from "./ScenarioViz";
import type { Project } from "./types";

export default function Home() {
  const nav = useNav();
  const situation = useMemo(() => sampleSituation(), []);
  const window0 = limitWindows(situation)[0];
  const [projects, setProjects] = useState<Project[]>([SAMPLE_PROJECT]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [fleet, setFleet] = useState(100);

  useEffect(() => {
    let alive = true;
    void listProjects().then((list) => alive && setProjects(list));
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const airport = String(f.get("airport") ?? "").trim();
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
        String(f.get("decision") ?? "").trim() ||
        "Reicht der Netzanschluss für die elektrische Vorfeldflotte?",
      gridLimitKw: Math.max(100, Number(f.get("limit") ?? 3.5) * 1000),
      fleetSize: Math.max(1, Number(f.get("fleet") ?? 100)),
    });
    if (project.source === "api") {
      // Anlegewerte als Projektwerte (ohne Quelle = Annahme); sie wirken auf alle Läufe.
      const num = (k: string) => Number(String(f.get(k) ?? "").replace(",", "."));
      const entries = [
        { key: "grid_import_limit_kw", value: Math.max(100, num("limit") * 1000), unit: "kW" },
        { key: "pv_capacity_kwp", value: num("pv"), unit: "kWp" },
        { key: "battery_capacity_kwh", value: num("storage"), unit: "kWh" },
      ]
        .concat(
          distributeFleet(num("fleet")).flatMap((f) => [
            { key: `fleet.${f.kind}.vehicles`, value: f.vehicles, unit: "Stück" },
            { key: `fleet.${f.kind}.chargers`, value: f.chargers, unit: "Stück" },
          ]),
        )
        .filter((e) => Number.isFinite(e.value) && e.value >= 0)
        .map((e) => ({ ...e, source: "", source_date: null }));
      try {
        await saveAssets(project, entries);
      } catch {
        /* Werte lassen sich im Schritt Daten nachtragen */
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
    <div className="aec-home">
      <section className="aec-hero" aria-labelledby="aec-hero-title">
        <div className="aec-hero__copy">
          <p
            className="aec-eyebrow aec-eyebrow--night aec-enter"
            style={{ "--d": 0 } as React.CSSProperties}
          >
            Airport Energy Check
          </p>
          <h1
            id="aec-hero-title"
            className="aec-hero__title aec-enter"
            style={{ "--d": 1 } as React.CSSProperties}
          >
            Reicht der Anschluss für das <em>elektrische Vorfeld</em>?
          </h1>
          <p className="aec-hero__lead aec-enter" style={{ "--d": 2 } as React.CSSProperties}>
            Schlepper, Busse und Bodenstromgeräte laden oft gleichzeitig, kurz vor der nächsten
            Abflugwelle. Wir rechnen Ihren Verkehrstag durch und zeigen, ob der Netzanschluss das
            trägt und was hilft, wenn nicht.
          </p>
        </div>
        <div className="aec-hero__viz aec-enter" style={{ "--d": 3 } as React.CSSProperties}>
          <div className="aec-hero__vizhead">
            <span>
              {SAMPLE_PROJECT.name} · {SAMPLE_PROJECT.dayLabel}
            </span>
            <SourceTag source="beispiel" />
          </div>
          <DayLandscape
            situation={situation}
            autoplay
            size="hero"
            label="Strombedarf am Beispieltag, Uhrzeit wählen"
          />
          <ul className="aec-legend" aria-label="Was die Grafik zeigt">
            <li>
              <i className="aec-legend__land" aria-hidden="true" />
              Strombedarf (Laden und übriger Verbrauch)
            </li>
            <li>
              <i className="aec-legend__stop" aria-hidden="true" />
              Netzanschluss {powerText(situation.gridLimitKw)}
            </li>
            <li>
              <i className="aec-legend__dep" aria-hidden="true" />
              Abflugwellen
            </li>
            <li>
              <i className="aec-legend__signal" aria-hidden="true" />
              Zu knapp {window0 ? `${clock(window0.start)}–${clock(window0.end)} Uhr` : ""}
            </li>
          </ul>
        </div>
      </section>

      <section className="aec-band" aria-labelledby="aec-how">
        <div className="aec-band__head">
          <span className="aec-eyebrow">Ablauf</span>
          <h2 id="aec-how">In vier Schritten zur Zusage an den Flughafen.</h2>
        </div>
        <ol className="aec-route">
          {QUESTIONS.map((q, i) => (
            <li key={q.id} style={{ "--i": i } as React.CSSProperties}>
              <span className="aec-route__no">{String.fromCharCode(65 + i)}</span>
              <strong>{q.label}</strong>
              <span>{q.question}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="aec-band" aria-labelledby="aec-projects">
        <div className="aec-band__head">
          <span className="aec-eyebrow">Projekte</span>
          <h2 id="aec-projects">Ein Projekt steht für einen Anschluss und die Flotte dahinter.</h2>
        </div>
        <div className="aec-projects">
          <ul className="aec-projects__list">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={{ page: "projekt", projekt: p.id, frage: "lage", auto: true }}
                  className="aec-project"
                >
                  <span className="aec-project__name">{p.name}</span>
                  <span className="aec-project__meta">
                    {p.airport}
                    {p.gridLimitKw ? ` · Anschluss ${powerText(p.gridLimitKw)}` : ""}
                    {p.fleetSize ? ` · ${p.fleetSize} Fahrzeuge` : ""}
                  </span>
                  {p.decision ? <span className="aec-project__q">„{p.decision}“</span> : null}
                  <span className="aec-project__foot">
                    <SourceTag source={p.source} />
                    <span className="aec-project__go">Öffnen →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <form className="aec-new" onSubmit={submit} aria-labelledby="aec-new-title" noValidate>
            <h3 id="aec-new-title">Neues Projekt</h3>
            <label>
              Projektname
              <input
                name="name"
                required
                placeholder="z. B. HAM · Vorfeld Nord"
                autoComplete="off"
              />
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
                <input
                  name="limit"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.1"
                  defaultValue="3.5"
                />
              </label>
              <label>
                Photovoltaik (kWp)
                <input
                  name="pv"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  defaultValue="7000"
                />
              </label>
              <label>
                Batteriespeicher (kWh)
                <input
                  name="storage"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  defaultValue="0"
                />
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
                  onChange={(e) => setFleet(Number(e.target.value))}
                />
              </label>
              <p className="aec-fine aec-new__split" aria-live="polite">
                Vorläufig aufgeteilt in{" "}
                {distributeFleet(fleet)
                  .map((f) => `${f.vehicles} ${f.label}`)
                  .join(", ")}
                ; das lässt sich im nächsten Schritt ändern.
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
            {error ? (
              <p className="aec-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="aec-button" disabled={creating}>
              {creating ? "Wird angelegt …" : "Projekt anlegen"}
            </button>
            <p className="aec-fine">
              Ohne Quellenangabe zählen die Werte als Annahme. Belege tragen Sie im nächsten Schritt
              nach.
            </p>
          </form>
        </div>
      </section>

      <section className="aec-band aec-band--library" aria-labelledby="aec-lib">
        <div className="aec-band__head">
          <span className="aec-eyebrow">Szenario-Bibliothek</span>
          <h2 id="aec-lib">Acht Krisenfälle, an denen sich jede Lösung messen lassen muss.</h2>
        </div>
        <ul className="aec-libteaser">
          {SCENARIO_CASES.slice(0, 4).map((c) => (
            <li key={c.slug}>
              <ScenarioViz slug={c.slug} />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
        <Link to={{ page: "bibliothek" }} className="aec-button aec-button--ghost">
          Alle acht Fälle ansehen
        </Link>
      </section>
    </div>
  );
}
