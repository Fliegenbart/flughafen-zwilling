import { useId } from "react";

/**
 * Evidenzstatus: ueberall gleich benannt, gleich gefaerbt, mit Erklaerung.
 * Fuenf Stufen, aufsteigend. Gruen ist allein "empirisch bestanden" vorbehalten
 * (Holdout-PASS mit vorab gesperrten Kriterien); alles Ungepruefte bleibt ungruen.
 */
export type EvidenceLevel =
  | "assumption"
  | "synthetic"
  | "model_checked"
  | "empirical_open"
  | "empirical_passed";

export const EVIDENCE_LEVELS: Record<EvidenceLevel, { label: string; hint: string }> = {
  assumption: {
    label: "Annahme",
    hint: "Ein eingesetzter Wert, noch ohne Beleg. Weder gemessen noch am Modell abgestimmt.",
  },
  synthetic: {
    label: "ausgedacht",
    hint: "Erfundene oder vom Modell erzeugte Werte. Sie zeigen, wie es funktioniert, nicht wie es ist.",
  },
  model_checked: {
    label: "rechnerisch geprüft",
    hint: "Das Modell rechnet in sich stimmig: Energie geht nicht verloren, Vergleiche laufen unter gleichen Bedingungen. Mit der Wirklichkeit verglichen ist es noch nicht.",
  },
  empirical_open: {
    label: "noch nicht gemessen",
    hint: "Eine echte Messung, die das bestätigt, steht noch aus. Dafür braucht es vorher festgelegte Grenzen und eine eigene Prüfmessung.",
  },
  empirical_passed: {
    label: "durch Messung bestätigt",
    hint: "Eine Prüfmessung hat die vorher festgelegten Grenzen eingehalten. Das gilt für genau diesen Vergleich, nicht für elektrische Sicherheit oder den Betrieb.",
  },
};

/** Rang 0..4 fuer die Evidenzleiter (Annahme unten, bestanden oben). */
export const EVIDENCE_ORDER: EvidenceLevel[] = [
  "assumption",
  "synthetic",
  "model_checked",
  "empirical_open",
  "empirical_passed",
];

type Props = {
  level: EvidenceLevel;
  /** Optional abweichender Kurztext; der Status selbst bleibt im Tooltip und Screenreader-Text. */
  label?: string;
  detail?: string;
};

/** Kleine Leiter aus fuenf Stufen; die erreichte Stufe ist gefuellt. */
function Ladder({ level }: { level: EvidenceLevel }) {
  const rank = EVIDENCE_ORDER.indexOf(level);
  return (
    <span className="ds-evidence__ladder" aria-hidden="true">
      {EVIDENCE_ORDER.map((l, i) => (
        <i key={l} data-on={i <= rank ? "" : undefined} />
      ))}
    </span>
  );
}

export function EvidenceBadge({ level, label, detail }: Props) {
  const id = useId();
  const meta = EVIDENCE_LEVELS[level];
  const text = label ?? meta.label;
  return (
    <span className="ds-evidence" data-evidence={level}>
      <span
        className="ds-evidence__chip"
        tabIndex={0}
        aria-describedby={id}
        aria-label={label ? `${text} (Wie sicher: ${meta.label})` : `Wie sicher: ${meta.label}`}
      >
        <span className="ds-evidence__dot" aria-hidden="true" />
        {text}
        <Ladder level={level} />
      </span>
      <span role="tooltip" id={id} className="ds-evidence__tip">
        <strong>{meta.label}.</strong> {meta.hint}
        {detail ? ` ${detail}` : ""}
      </span>
    </span>
  );
}

export function EvidenceLegend() {
  return (
    <ul className="ds-evidence-legend" aria-label="Legende Evidenzstatus">
      {(Object.keys(EVIDENCE_LEVELS) as EvidenceLevel[]).map((level) => (
        <li key={level}>
          <EvidenceBadge level={level} />
        </li>
      ))}
    </ul>
  );
}
