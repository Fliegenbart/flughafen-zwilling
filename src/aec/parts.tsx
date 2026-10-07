import type { ReactNode } from "react";
import { EvidenceBadge, type EvidenceLevel } from "../ui/EvidenceBadge";
import type { DataSource } from "./types";

/** Wortmarke: Mittellinie mit Haltebalken, abstrahiert. Kein Fremdlogo. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="aec-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" className="aec-mark__plate" />
      <path d="M6 22 C 12 22, 14 10, 26 10" className="aec-mark__line" />
      <circle cx="9" cy="25.5" r="1.3" className="aec-mark__stop" />
      <circle cx="13" cy="25.5" r="1.3" className="aec-mark__stop" />
      <circle cx="17" cy="25.5" r="1.3" className="aec-mark__stop" />
      <circle cx="26" cy="10" r="2.4" className="aec-mark__dot" />
    </svg>
  );
}

export function SourceTag({ source }: { source: DataSource }) {
  if (source === "api") return null;
  return (
    <span className="aec-sample" title="Erfundene Werte zum Ausprobieren">
      Beispielwerte
    </span>
  );
}

export type Kpi = {
  value: string;
  unit?: string;
  label: string;
  evidence?: EvidenceLevel;
  tone?: "signal" | "stop";
};

/** Antwort zuerst: grosser Satz, dann 3–4 Kennzahlen in Kaeufer-Einheiten. */
export function AnswerHead({
  id,
  question,
  answer,
  lead,
  kpis,
  evidence,
  source,
  context,
}: {
  id: string;
  question: string;
  answer: string;
  lead?: ReactNode;
  kpis: Kpi[];
  evidence: EvidenceLevel;
  source: DataSource;
  context?: ReactNode;
}) {
  return (
    <header className="aec-answer">
      <div className="aec-answer__meta">
        <span className="aec-eyebrow">{question}</span>
        <EvidenceBadge level={evidence} />
        <SourceTag source={source} />
        {context}
      </div>
      <h1 id={id} className="aec-answer__text" data-answer="">
        {answer}
      </h1>
      {lead ? <p className="aec-answer__lead">{lead}</p> : null}
      <dl className="aec-kpis" data-count={kpis.length}>
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="aec-kpi"
            data-tone={k.tone}
            style={{ "--i": i } as React.CSSProperties}
          >
            <dt>{k.label}</dt>
            <dd>
              <span className="aec-kpi__value">{k.value}</span>
              {k.unit ? <span className="aec-kpi__unit">{k.unit}</span> : null}
              {k.evidence ? (
                <span className="aec-kpi__ev">
                  <EvidenceBadge level={k.evidence} />
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export function Details({
  summary,
  children,
  open,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="aec-details" open={open}>
      <summary>
        <span>{summary}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </summary>
      <div className="aec-details__body">{children}</div>
    </details>
  );
}

export function Section({
  title,
  kicker,
  children,
  id,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="aec-section" aria-labelledby={id}>
      <div className="aec-section__head">
        {kicker ? <span className="aec-eyebrow">{kicker}</span> : null}
        <h2 id={id}>{title}</h2>
      </div>
      {children}
    </section>
  );
}
