import { EvidenceBadge, EvidenceLegend, type EvidenceLevel } from "../ui/EvidenceBadge";

type Claim = { topic: string; level: EvidenceLevel; basis: string };

/** Was dieser Prototyp belegt – und was ausdruecklich nicht. */
const CLAIMS: Claim[] = [
  {
    topic: "Flugplanzeiten",
    level: "assumption",
    basis:
      "Veröffentlichter Plan, manuell importiert. Keine bestätigten physischen Bewegungen, keine Umläufe.",
  },
  {
    topic: "Flotte, Verbrauch, Lade- und Netzgrenzen",
    level: "assumption",
    basis: "Gesetzte Modellwerte, nicht mit FMG- oder E.ON-Daten kalibriert.",
  },
  {
    topic: "Pilot-Beispieldaten",
    level: "synthetic",
    basis: "Erfundene Mess-/Modellpunkte für die Vorführung. Ergeben nie PASS.",
  },
  {
    topic: "Fairer Regelvergleich (gleiche Welt, Seed, Nachfrage)",
    level: "model_checked",
    basis: "Identischer Welt-Hash; nur Laderegel und Ladepunktbelegung variieren.",
  },
  {
    topic: "Flotten- und Speicher-Energiebilanz",
    level: "model_checked",
    basis: "Getrennt aufsummierte Größen gegen SOC-Differenz. Konsistenz, keine Physikvalidierung.",
  },
  {
    topic: "Wirkleistungsbilanz je Minute",
    level: "model_checked",
    basis:
      "Buchführungscheck derselben Gleichung, per Konstruktion ≈ 0. Kein unabhängiger Nachweis.",
  },
  {
    topic: "Artefakt-Integrität (SHA256)",
    level: "model_checked",
    basis:
      "Eingaben, Telemetrie und Berichte gegen das gespeicherte Manifest. Keine externe Signatur.",
  },
  {
    topic: "Robustheit unter Varianten",
    level: "model_checked",
    basis: "Deterministischer Stress-Screen (vier Varianten). Keine Zuverlässigkeitsstatistik.",
  },
  {
    topic: "Übereinstimmung mit Messdaten",
    level: "empirical_open",
    basis:
      "Erfordert vorab gesperrte Abnahmekriterien und einen unabhängigen Holdout-Zeitraum (Schritt 4).",
  },
  {
    topic: "Reale Pünktlichkeit, Sicherheit, Wirtschaftlichkeit",
    level: "empirical_open",
    basis: "Nicht Gegenstand dieses Prototyps. Kein ROI, keine Netz- oder Anlagenfreigabe.",
  },
];

type Props = {
  hasComparison: boolean;
  onReport: () => void;
  artifactLinks: { href: string; label: string }[];
};

export default function EvidenceOverview({ hasComparison, onReport, artifactLinks }: Props) {
  return (
    <div className="evidence-overview">
      <section className="ds-card" aria-labelledby="evidence-matrix-title">
        <h3 id="evidence-matrix-title">Evidenzstatus je Aussage</h3>
        <EvidenceLegend />
        <div className="evidence-overview__table">
          <table className="ds-evidence-table">
            <thead>
              <tr>
                <th scope="col">Aussage</th>
                <th scope="col">Status</th>
                <th scope="col">Grundlage und Grenze</th>
              </tr>
            </thead>
            <tbody>
              {CLAIMS.map((claim) => (
                <tr key={claim.topic}>
                  <th scope="row">{claim.topic}</th>
                  <td>
                    <EvidenceBadge level={claim.level} />
                  </td>
                  <td>{claim.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ds-grid-2">
        <section className="ds-card" aria-labelledby="evidence-exports-title">
          <h3 id="evidence-exports-title">Modellnachweise mitnehmen</h3>
          {hasComparison ? (
            <>
              <p>
                Bericht und Rohdaten des eingefrorenen Regelvergleichs. Hashes prüfen die
                Integrität, nicht die Richtigkeit der Annahmen.
              </p>
              <div className="evidence-overview__actions">
                <button type="button" className="ds-button ds-button--primary" onClick={onReport}>
                  Vergleichsbericht (HTML)
                </button>
                {artifactLinks.map((link) => (
                  <a key={link.href} className="ds-button" href={link.href}>
                    {link.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="studio-empty">
              Noch kein abgeschlossener Regelvergleich. Erst in Schritt 2 starten; ein Nullergebnis
              ist ebenfalls ein gültiger Nachweis.
            </p>
          )}
        </section>
        <section className="ds-card" aria-labelledby="evidence-package-title">
          <h3 id="evidence-package-title">Pilot-Testpaket</h3>
          <p>
            Entscheidungsbericht und Testpaket (Originalquellen, Rollen, gesperrte Kriterien samt
            Hash, Bewertungen, Audit) liegen im Pilotprojekt in Schritt 4. Das Paket ist keine
            Hardware-Versuchserlaubnis.
          </p>
        </section>
      </div>
    </div>
  );
}
