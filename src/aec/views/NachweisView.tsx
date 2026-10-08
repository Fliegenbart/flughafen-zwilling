import { useEffect, useState } from "react";
import {
  EVIDENCE_LEVELS,
  EVIDENCE_ORDER,
  EvidenceBadge,
  type EvidenceLevel,
} from "../../ui/EvidenceBadge";
import { CURRENT_COUPLED_ENGINE } from "../../shared/engine";
import { getOverview, type Overview } from "../api/overview";
import { REPORT_STYLES } from "../../ui/reportStyles";
import KeptSolutions from "../arbeitsplatz/festhalten/KeptSolutions";
import { currentBoard } from "../arbeitsplatz/festhalten/results";
import { powerText } from "../model/format";
import { bottleneckAnswer } from "../model/situation";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import Pruefstatus from "./Pruefstatus";
import { WerkstattLinks } from "../Werkstatt";

type Claim = { level: EvidenceLevel; title: string; text: string };
type Known = Pick<ViewProps, "project" | "situation" | "board">;

/** Der Anschluss, den die Seite wirklich kennt: erst der der Rechnung, dann der des Lagebilds. */
function knownGridLimitKw({ project, situation, board }: Known): number | null {
  // Beispielwerte (etwa 3500 kW im Lagebild) gehoeren nicht zu einem eigenen Projekt.
  if (board.source === "api" && board.base && board.base.gridLimitKw > 0)
    return board.base.gridLimitKw;
  if (situation.source === "api" && situation.gridLimitKw > 0) return situation.gridLimitKw;
  return project.gridLimitKw;
}

function claimsFor(props: Known, overview: Overview | null): Claim[] {
  const passed = (overview?.summary.empirical_passed ?? 0) > 0;
  const gridLimitKw = knownGridLimitKw(props);
  return [
    {
      level: "assumption",
      title: "Was wir angenommen haben",
      text: `Wie viele Fahrzeuge es gibt, wie schnell sie laden, wie viel Strom der Rest des Flughafens braucht und ${
        gridLimitKw == null
          ? "wie viel der Anschluss hergibt"
          : `dass der Anschluss ${powerText(gridLimitKw)} hergibt`
      }.`,
    },
    {
      level: "synthetic",
      title: "Was ausgedacht ist",
      text: "Die Krisenfälle aus der Bibliothek und alle Beispielwerte.",
    },
    {
      level: "model_checked",
      title: "Was wir rechnerisch geprüft haben",
      text: "Wir prüfen bei jeder Rechnung, ob keine Energie verloren geht, ob der übrige Strombedarf des Flughafens gedeckt ist, ob alle Lösungen denselben Flugplan nutzen und ob sich die Rechnung wiederholen lässt. Eine Lösung, die das nicht besteht, gilt als ausgedacht.",
    },
    passed
      ? {
          level: "empirical_passed",
          title: "Was eine Messung bestätigt hat",
          text: "Eine Prüfmessung am Flughafen hat die vorher festgelegten Grenzen eingehalten.",
        }
      : {
          level: "empirical_open",
          title: "Was noch gemessen werden muss",
          text: "Ob das Modell die Wirklichkeit trifft. Dafür fehlen Messungen am Flughafen und im Testing-Lab.",
        },
  ];
}

function reportHtml(props: ViewProps, claims: Claim[], overview: Overview | null) {
  // Nur ein Satz, der noch zu den festgehaltenen Lösungen passt.
  const answer = currentBoard(props.board).answer;
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = claims
    .map((c) => `<tr><td>${esc(EVIDENCE_LEVELS[c.level].label)}</td><td>${esc(c.text)}</td></tr>`)
    .join("");
  const tech = (overview?.elements ?? [])
    .map((e) => `<li>${esc(e.title)} · ${esc(e.status)} · <code>${esc(e.refId)}</code></li>`)
    .join("");
  return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Zusage ${esc(props.project.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${REPORT_STYLES}</style><body><main>
<small>Airport Energy Check · Zusammenfassung${props.situation.source === "beispiel" ? " · <b>Beispielwerte</b>" : ""}</small>
<h1>${esc(props.project.name)}</h1>
<p><b>Wann es knapp wird:</b> ${esc(bottleneckAnswer(props.situation))}</p>
${answer ? `<p><b>Was hilft:</b> ${esc(answer.headline)}${props.board.source === "beispiel" ? " (Beispielwerte)" : ""}</p>` : ""}
<table>${rows}</table>
<h2>Anhang für Fachleute</h2><ul>${tech || "<li>Noch keine gespeicherten Berechnungen.</li>"}</ul>
<p>Modellversion: ${CURRENT_COUPLED_ENGINE}. Prüfgrenzen vorab festgelegt: ${overview?.locked ? `ja, SHA256 ${esc(overview.sha256 ?? "")}` : "nein"}.</p>
<p>Prototyp von electrified labs. Das Modell ist nicht an Messungen kalibriert und steuert keine Anlagen.</p></main></body></html>`;
}

export default function NachweisView(props: ViewProps) {
  const { project, situation, route } = props;
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    void getOverview(project).then((o) => alive && setOverview(o));
    return () => {
      alive = false;
    };
  }, [project]);
  const claims = claimsFor(props, overview);
  const passed = claims.some((c) => c.level === "empirical_passed");
  const summary = overview?.summary ?? {};
  const top = passed ? "empirical_passed" : "empirical_open";

  function download() {
    const blob = new Blob([reportHtml(props, claims, overview)], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nachweis-${project.id}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Zusage · Was können wir versprechen?"
        answer={
          passed
            ? "Die Rechnung ist in sich stimmig, und eine Messung vom Flughafen hat sie bestätigt."
            : "Die Rechnung ist in sich stimmig, verbindlich zusagen lassen sich die Zahlen erst nach einer Messung."
        }
        lead="Grün wird eine Aussage erst, wenn eine Messung die vorher vereinbarten Grenzen einhält."
        evidence={top}
        source={overview?.source ?? "beispiel"}
        kpis={(["assumption", "synthetic", "model_checked", top] as EvidenceLevel[]).map((l) => ({
          value: String(summary[l] ?? 0),
          label: EVIDENCE_LEVELS[l].label,
          evidence: l,
        }))}
      />

      <Section
        title="Was heute feststeht und was nicht"
        kicker="Von Annahme bis Messung"
        id="nachweis-ladder"
      >
        <ol className="aec-ladder">
          {[...claims].reverse().map((c) => (
            <li
              key={c.level}
              data-level={c.level}
              style={{ "--rank": EVIDENCE_ORDER.indexOf(c.level) } as React.CSSProperties}
            >
              <span className="aec-ladder__step" aria-hidden="true" />
              <div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </div>
              <EvidenceBadge level={c.level} />
            </li>
          ))}
        </ol>
        <div className="aec-actions">
          <button type="button" className="aec-button" onClick={download}>
            Zusammenfassung herunterladen
          </button>
          <span className="aec-fine">
            Zum Weitergeben oder Drucken als PDF, mit technischem Anhang.
          </span>
        </div>
      </Section>

      <Section
        title="Was Sie im Durchrechnen festgehalten haben"
        kicker="Festgehaltene Lösungen"
        id="nachweis-loesungen"
      >
        <KeptSolutions board={props.board} projekt={project.id} source={project.source} />
      </Section>

      <Pruefstatus project={project} />

      <Details summary="Prüfprotokoll und Detailwerkzeuge (für Fachleute)">
        <ul className="aec-facts aec-facts--mono">
          <li>
            <span>Modellversion</span>
            {CURRENT_COUPLED_ENGINE}
          </li>
          <li>
            <span>Prüfgrenzen</span>
            {overview?.locked
              ? `vorab festgelegt · SHA256 ${overview.sha256}`
              : "noch nicht festgelegt"}
          </li>
          {(overview?.elements ?? []).map((e) => (
            <li key={`${e.kind}-${e.refId}`}>
              <span>{e.title}</span>
              {e.status} · {e.refId}
            </li>
          ))}
          {!overview?.elements.length ? (
            <li>
              <span>Berechnungen</span>Noch keine gespeichert (
              {situation.source === "beispiel" ? "Beispielprojekt" : "Projekt"})
            </li>
          ) : null}
        </ul>
        <WerkstattLinks items={["nachweise", "robustheit", "betrieb"]} base={route} />
      </Details>
    </>
  );
}
