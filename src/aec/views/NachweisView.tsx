import { useEffect, useState } from "react";
import {
  EVIDENCE_LEVELS,
  EVIDENCE_ORDER,
  EvidenceBadge,
  type EvidenceLevel,
} from "../../ui/EvidenceBadge";
import { CURRENT_COUPLED_ENGINE } from "../../munich/coupledTypes";
import { getOverview, type Overview } from "../api";
import { REPORT_STYLES } from "../../ui/reportStyles";
import { bottleneckAnswer, powerText, variantsAnswer } from "../analysis";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
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
      title: "Annahmen",
      text: `Flottengröße, Ladeleistungen, Grundlastprofil, Anschlussgrenze ${powerText(project.gridLimitKw)}.`,
    },
    {
      level: "synthetic",
      title: "Synthetisch",
      text: "Krisenszenarien aus der Szenario-Bibliothek, Beispieldaten.",
    },
    {
      level: "model_checked",
      title: "Modellintern",
      text: "Energiebilanzen, Fristen, faire Vergleiche, Reproduzierbarkeit.",
    },
    passed
      ? {
          level: "empirical_passed",
          title: "Empirisch",
          text: "Holdout-Messdaten erfüllen die vorab gesperrten Kriterien.",
        }
      : {
          level: "empirical_open",
          title: "Empirisch",
          text: "Abgleich mit Holdout-Messdaten des Flughafens und Lab-Komponenten steht aus.",
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
  return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Nachweis ${esc(props.project.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${REPORT_STYLES}</style><body><main>
<small>Airport Energy Check · Nachweis für Angebot und Lab${props.situation.source === "beispiel" ? " · <b>Beispieldaten</b>" : ""}</small>
<h1>${esc(props.project.name)}</h1>
<p><b>Engpass:</b> ${esc(bottleneckAnswer(props.situation))}</p>
<p><b>Varianten:</b> ${esc(props.board.answer?.headline ?? variantsAnswer(props.variants))}${props.board.source === "beispiel" ? " (Beispieldaten)" : ""}</p>
<table>${rows}</table>
<h2>Anhang: Technik</h2><ul>${tech || "<li>Keine verknüpften Läufe.</li>"}</ul>
<p>Engine: ${CURRENT_COUPLED_ENGINE}. Kriterien gesperrt: ${overview?.locked ? `ja, SHA256 ${esc(overview.sha256 ?? "")}` : "nein"}.</p>
<p>Methodenprototyp, unkalibriert. Keine Anlagensteuerung, keine Hardwarewrites.</p></main></body></html>`;
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
        question="Nachweis · Was können wir zusagen?"
        answer={
          passed
            ? "Die Methode ist geprüft, und der Holdout-Abgleich hat die vereinbarten Kriterien erfüllt."
            : "Die Methode ist geprüft. Die Zahlen sind es erst nach dem Datenpilot."
        }
        lead="Jede Aussage trägt ihre Evidenzstufe. Grün gibt es erst, wenn unabhängige Messdaten die vorab gesperrten Kriterien erfüllen."
        evidence={top}
        source={overview?.source ?? "beispiel"}
        kpis={(["assumption", "synthetic", "model_checked", top] as EvidenceLevel[]).map((l) => ({
          value: String(summary[l] ?? 0),
          label: EVIDENCE_LEVELS[l].label,
          evidence: l,
        }))}
      />

      <Section title="Was wir heute zusagen können" kicker="Evidenzleiter" id="nachweis-ladder">
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
            Bericht herunterladen
          </button>
          <span className="aec-fine">HTML zum Drucken als PDF. Technik steht im Anhang.</span>
        </div>
      </Section>

      <Details summary="Technik: Hashes, Engine-Version, Prüfprotokoll">
        <ul className="aec-facts aec-facts--mono">
          <li>
            <span>Engine</span>
            {CURRENT_COUPLED_ENGINE}
          </li>
          <li>
            <span>Kriterien</span>
            {overview?.locked ? `gesperrt · SHA256 ${overview.sha256}` : "noch nicht gesperrt"}
          </li>
          {(overview?.elements ?? []).map((e) => (
            <li key={`${e.kind}-${e.refId}`}>
              <span>{e.title}</span>
              {e.status} · {e.refId}
            </li>
          ))}
          {!overview?.elements.length ? (
            <li>
              <span>Läufe</span>Keine verknüpften Läufe (
              {situation.source === "beispiel" ? "Beispielprojekt" : "Projekt"})
            </li>
          ) : null}
        </ul>
        <WerkstattLinks items={["nachweise", "pilot"]} base={route} />
      </Details>
    </>
  );
}
