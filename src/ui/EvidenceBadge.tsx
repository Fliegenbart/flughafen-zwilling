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
    hint: "Gesetzter Eingabewert oder Modellannahme. Nicht gemessen und nicht kalibriert.",
  },
  synthetic: {
    label: "synthetisch",
    hint: "Erfundene oder aus dem Modell erzeugte Daten. Nur zur Funktionsdemonstration.",
  },
  model_checked: {
    label: "modellintern geprüft",
    hint: "Konsistenz- oder Integritätsprüfung innerhalb des Modells (Bilanzen, Hashes, gleiche Welt). Kein Abgleich mit der Realität.",
  },
  empirical_open: {
    label: "empirisch offen",
    hint: "Noch nicht mit unabhängigen Messdaten nachgewiesen. Benötigt vorab gesperrte Kriterien und Holdout-Daten.",
  },
  empirical_passed: {
    label: "empirisch bestanden",
    hint: "Holdout-Messdaten erfüllen die vorab gesperrten Kriterien. Gilt nur für diesen quantitativen Vergleich, nicht für elektrische Sicherheit oder Betrieb.",
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
        aria-label={label ? `${text} (Evidenz: ${meta.label})` : `Evidenz: ${meta.label}`}
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
