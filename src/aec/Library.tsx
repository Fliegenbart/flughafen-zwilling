import { useEffect, useState } from "react";
import { EvidenceBadge } from "../ui/EvidenceBadge";
import { adoptScenario, listProjects } from "./api";
import Link from "./Link";
import { SAMPLE_PROJECT } from "./sample";
import { SCENARIO_CASES } from "./scenarios";
import ScenarioViz from "./ScenarioViz";
import type { Project } from "./types";
import { useNav } from "./context";
import { WerkstattFrame, WerkstattLinks } from "./Werkstatt";

export default function Library({ theme }: { theme?: "light" | "dark" }) {
  const nav = useNav();
  const [projects, setProjects] = useState<Project[]>([SAMPLE_PROJECT]);
  const [target, setTarget] = useState(SAMPLE_PROJECT.id);
  const [notice, setNotice] = useState<{ text: string; project: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const werkstatt = nav.route.page === "bibliothek" ? nav.route.werkstatt : undefined;

  useEffect(() => {
    let alive = true;
    void listProjects().then((list) => alive && setProjects(list));
    return () => {
      alive = false;
    };
  }, []);

  async function adopt(scenarioId: string, name: string) {
    const project = projects.find((p) => p.id === target) ?? SAMPLE_PROJECT;
    setBusy(scenarioId);
    try {
      const where = await adoptScenario(project, scenarioId, name);
      setNotice({
        text: `„${name}“ ist in ${project.name} übernommen${where === "beispiel" ? " (nur in dieser Sitzung)" : ""}.`,
        project: project.id,
      });
    } catch (e) {
      setNotice({
        text: `Übernahme fehlgeschlagen: ${e instanceof Error ? e.message : "unbekannt"}`,
        project: "",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="aec-page">
      <header className="aec-answer aec-answer--library">
        <div className="aec-answer__meta">
          <span className="aec-eyebrow">Szenario-Bibliothek</span>
          <EvidenceBadge level="synthetic" />
        </div>
        <h1 className="aec-answer__text" data-answer="">
          Acht Krisenfälle, um jede Variante unter Stress zu setzen.
        </h1>
        <p className="aec-answer__lead">
          Jeder Fall stammt aus der Abfertigungssimulation und verschiebt Aufträge, Fahrzeuge und
          Ladefenster. Übernehmen Sie einen Fall in Ihr Projekt; er erscheint dort im Austausch und
          als Stresstest der Varianten.
        </p>
        <label className="aec-target">
          Übernehmen in
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="aec-notice" role="status" aria-live="polite">
        {notice ? (
          <>
            {notice.text}{" "}
            {notice.project ? (
              <Link to={{ page: "projekt", projekt: notice.project, frage: "nachweis" }}>
                Zum Prüfstatus
              </Link>
            ) : null}
          </>
        ) : null}
      </div>

      <ol className="aec-library">
        {SCENARIO_CASES.map((c, i) => (
          <li key={c.slug} className="aec-case" style={{ "--i": i } as React.CSSProperties}>
            <article aria-labelledby={`case-${c.slug}`}>
              <div className="aec-case__viz">
                <ScenarioViz slug={c.slug} />
                <span className="aec-case__no" aria-hidden="true">
                  {String(c.id).padStart(2, "0")}
                </span>
              </div>
              <div className="aec-case__body">
                <h2 id={`case-${c.slug}`}>{c.name}</h2>
                <p className="aec-case__claim">{c.claim}</p>
                <p className="aec-case__energy">{c.energy}</p>
                <p className="aec-case__stress">{c.stress}</p>
              </div>
              <div className="aec-case__foot">
                <EvidenceBadge level="synthetic" />
                <button
                  type="button"
                  className="aec-button aec-button--small"
                  onClick={() => void adopt(c.scenarioId, c.name)}
                  disabled={busy === c.scenarioId}
                  aria-label={`${c.name} in Projekt übernehmen`}
                >
                  In Projekt übernehmen
                </button>
              </div>
            </article>
          </li>
        ))}
      </ol>

      <section className="aec-section" aria-labelledby="lib-werkstatt">
        <div className="aec-section__head">
          <span className="aec-eyebrow">Details</span>
          <h2 id="lib-werkstatt">Fälle im Detail rechnen</h2>
        </div>
        <p className="aec-muted">
          Die Abfertigungssimulation bleibt vollständig nutzbar: Parameter, Läufe, Stellhebel-Suche,
          Berichte.
        </p>
        {werkstatt ? (
          <WerkstattFrame werkstatt="simulation" theme={theme} close={{ page: "bibliothek" }} />
        ) : (
          <WerkstattLinks items={["simulation"]} base={{ page: "bibliothek" }} />
        )}
      </section>
    </div>
  );
}
