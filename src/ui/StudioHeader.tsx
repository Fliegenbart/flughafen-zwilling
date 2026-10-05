import type { ReactNode } from "react";
import { EvidenceBadge, type EvidenceLevel } from "./EvidenceBadge";

type HeaderProps = {
  title: string;
  /** Eyebrow: wo im Produkt (kurz, Versalien per CSS). */
  location: string;
  headingId?: string;
  /** Ein Satz: wozu das Werkzeug dient. */
  lead?: ReactNode;
  /** Technikbegriffe (Seed, Welt-Hash, Engine) – landen im Aufklapper "Details/Nachweis". */
  context?: ReactNode;
  /** Kurzer Grenzen-Hinweis, bleibt sichtbar. */
  warning: ReactNode;
  evidence?: EvidenceLevel;
  evidenceLabel?: string;
  actions?: ReactNode;
};

/**
 * Werkzeugkopf im Stil der Fragen-Ansichten: Eyebrow, kurze Ueberschrift,
 * ein Satz wozu, Evidenzstufe. Technik steht hinter "Details/Nachweis".
 */
export function StudioHeader({
  title,
  location,
  headingId,
  lead,
  context,
  warning,
  evidence = "empirical_open",
  evidenceLabel = "Methodenprototyp",
  actions,
}: HeaderProps) {
  return (
    <header className="studio-page-header">
      <div className="studio-page-heading">
        <p className="studio-eyebrow">{location}</p>
        <h1 id={headingId}>{title}</h1>
        {lead ? <p className="studio-lead">{lead}</p> : null}
      </div>
      {actions ? <div className="studio-header-actions">{actions}</div> : null}
      <div className="studio-context">
        <div className="studio-header-evidence">
          <EvidenceBadge level={evidence} label={evidenceLabel} />
          <p className="studio-warning">{warning}</p>
        </div>
        {context ? (
          <details className="studio-proof">
            <summary>Details/Nachweis</summary>
            <div>{context}</div>
          </details>
        ) : null}
      </div>
    </header>
  );
}

const steps = [
  { id: "flightplan", label: "Flugplan", href: "#coupled-flightplan" },
  { id: "fleet", label: "Flotte", href: "#coupled-fleet" },
  { id: "energy", label: "Energie", href: "#coupled-energy" },
  { id: "vergleich", label: "Vergleich", href: "#coupled-compare" },
] as const;

export function StudioWorkflowNav({ current }: { current: (typeof steps)[number]["id"] }) {
  return (
    <nav className="studio-workflow" aria-label="Betriebswirkung: Teilschritte">
      {steps.map((step, index) => (
        <a
          key={step.id}
          href={step.href}
          aria-label={`${index + 1}. ${step.label}`}
          aria-current={current === step.id ? "step" : undefined}
        >
          <span aria-hidden="true">{index + 1}</span>
          {step.label}
        </a>
      ))}
    </nav>
  );
}
