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
import { powerText } from "../model/format";
import { bottleneckAnswer } from "../model/situation";
import { variantsAnswer } from "../model/variants";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import Pruefstatus from "./Pruefstatus";
import { WerkstattLinks } from "../Werkstatt";

type Claim = { level: EvidenceLevel; title: string; text: string };

export function claimsFor(
  { project }: Pick<ViewProps, "project">,
  overview: Overview | null,
): Claim[] {
  const passed = (overview?.summary.empirical_passed ?? 0) > 0;
  return [
    {
      level: "assumption",
      title: "Was wir angenommen haben",
      text: `Wie viele Fahrzeuge es gibt, wie schnell sie laden, wie viel Strom der Rest des Flughafens braucht und dass der Anschluss ${powerText(project.gridLimitKw)} hergibt.`,
    },
    {
      level: "synthetic",
      title: "Was illustriert oder simuliert ist",
      text: "Illustrative Beispielwerte, Szenarien und Simulationen. Sie sind keine Messdaten.",
    },
    {
      level: "model_checked",
      title: "Was wir rechnerisch geprüft haben",
      text: "Die Simulation ist nachvollziehbar und Varianten werden unter denselben Annahmen verglichen.",
    },
    passed
      ? {
          level: "empirical_passed",
          title: "Was Messdaten belegen",
          text: "Messdaten aus einem abgegrenzten Prüffall halten die festgelegten Grenzen ein. Sie belegen nicht die gesamte Simulation.",
        }
      : {
          level: "empirical_open",
          title: "Was noch gemessen werden muss",
          text: "Ob die Simulation den abgegrenzten Prüffall abbildet. Dafür fehlen geeignete Messdaten.",
        },
  ];
}

function reportHtml(props: ViewProps, claims: Claim[], overview: Overview | null) {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = claims
    .map((c) => `<tr><td>${esc(EVIDENCE_LEVELS[c.level].label)}</td><td>${esc(c.text)}</td></tr>`)
    .join("");
  const tech = (overview?.elements ?? [])
    .map((e) => `<li>${esc(e.title)} · ${esc(e.status)} · <code>${esc(e.refId)}</code></li>`)
    .join("");
  const resultKind =
    props.board.source === "beispiel"
      ? " (Illustrative Beispielwerte, keine Messdaten)"
      : " (Simulationsergebnis, keine Messung)";
  return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Nachweise &amp; Prüfplan ${esc(props.project.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${REPORT_STYLES}</style><body><main>
<small>Airport Energy Check · Nachweise &amp; Prüfplan${props.situation.source === "beispiel" ? " · <b>Illustrative Beispielwerte, keine Messdaten</b>" : ""}</small>
<h1>${esc(props.project.name)}</h1>
<p><b>Wann es knapp wird:</b> ${esc(bottleneckAnswer(props.situation))}</p>
<p><b>Was hilft:</b> ${esc(props.board.answer?.headline ?? variantsAnswer(props.variants))}${resultKind}</p>
<table>${rows}</table>
<h2>Anhang für Fachleute</h2><ul>${tech || "<li>Noch keine gespeicherten Berechnungen.</li>"}</ul>
<p>Modellversion: ${CURRENT_COUPLED_ENGINE}. Prüfgrenzen vorab festgelegt: ${overview?.locked ? `ja, SHA256 ${esc(overview.sha256 ?? "")}` : "nein"}.</p>
<p>Flughafen-Simulationsprototyp. Das Modell ist nicht an Messdaten kalibriert und steuert keine Anlagen.</p></main></body></html>`;
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
        question="Nachweise & Prüfplan · Was ist belegt?"
        answer={
          passed
            ? "Messdaten liegen für abgegrenzte Prüffälle vor. Die gesamte Simulation ist damit nicht validiert."
            : "Die Simulation ist nachvollziehbar gerechnet; Messdaten für den Abgleich stehen noch aus."
        }
        lead="Beispielwerte und Simulationen sind keine Messdaten. Messdaten gelten nur für den jeweiligen Prüffall."
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

      <Pruefstatus project={project} />

      <Details summary="Prüfprotokoll und Modellversion (für Fachleute)">
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
        <WerkstattLinks items={["nachweise"]} base={route} />
      </Details>
    </>
  );
}
