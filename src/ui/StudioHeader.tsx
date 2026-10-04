import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  location: string;
  headingId?: string;
  context?: ReactNode;
  warning: ReactNode;
  actions?: ReactNode;
};

export function StudioHeader({ title, location, headingId, context, warning, actions }: HeaderProps) {
  return (
    <header className="studio-page-header">
      <div className="studio-page-heading">
        <p>{location}</p>
        <h1 id={headingId}>{title}</h1>
      </div>
      <div className="studio-header-actions">{actions}</div>
      <div className="studio-context">
        <div>{context}</div>
        <p className="studio-warning">{warning}</p>
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
    <nav className="studio-workflow" aria-label="München Pilotbereiche">
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
