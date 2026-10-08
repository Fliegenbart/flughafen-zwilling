import { lazy, Suspense } from "react";
import type { Werkstatt as W } from "./routes";
import Link from "./Link";
import type { Route } from "./routes";

const AirportSimulation = lazy(() => import("../App"));
const FlexLabApp = lazy(() => import("../lab/Workbench"));
const MunichApp = lazy(() => import("../munich/MunichPilot"));

const WERKSTATT_LABEL: Record<W, { title: string; hint: string }> = {
  system: {
    title: "Anlagenplan und Flugplan",
    hint: "Netz, Photovoltaik, Blockheizkraftwerk, Speicher und Ladepunkte; Flugplan einlesen",
  },
  betrieb: {
    title: "Zusammenspiel im Betrieb",
    hint: "Vom Flugplan über Aufträge und Fahrzeuge bis zum Laden; Laderegeln vergleichen",
  },
  robustheit: {
    title: "Belastungsproben",
    hint: "Vier Störungen, zwei Laderegeln, derselbe Flugplan",
  },
  pilot: {
    title: "Modell gegen Messung",
    hint: "Grenzen vorab festlegen, Prüfmessung einlesen, Ergebnis als Paket",
  },
  nachweise: {
    title: "Prüfprotokoll",
    hint: "Jede Berechnung mit Fingerabdruck, Modellversion und Export",
  },
  flexlab: { title: "Lab-Werkbank (FlexLab)", hint: "Messdaten echter Komponenten, nur lesend" },
  simulation: {
    title: "Abfertigung im Detail",
    hint: "Die acht Krisenfälle Schritt für Schritt, Stellschrauben suchen",
  },
};

/**
 * Bestandswerkzeuge in voller Funktion. Sie behalten ihre eigenen Tokens
 * (`.studio-workspace`) und folgen dem gewaehlten Farbschema.
 */
export function WerkstattFrame({
  werkstatt,
  theme,
  close,
}: {
  werkstatt: W;
  theme?: "light" | "dark";
  close: Route;
}) {
  const meta = WERKSTATT_LABEL[werkstatt];
  const tool =
    werkstatt === "flexlab" ? (
      <FlexLabApp />
    ) : werkstatt === "simulation" ? (
      <AirportSimulation />
    ) : (
      <MunichApp />
    );
  return (
    <section className="aec-werkstatt" aria-labelledby="aec-werkstatt-title" id="werkstatt">
      <div className="aec-werkstatt__bar">
        <div>
          <span className="aec-eyebrow">Detailwerkzeug</span>
          <h2 id="aec-werkstatt-title">{meta.title}</h2>
          <p>{meta.hint}.</p>
        </div>
        <Link to={close} className="aec-button aec-button--ghost">
          Schließen
        </Link>
      </div>
      <div
        className={
          werkstatt === "flexlab"
            ? "aec-werkstatt__tool aec-werkstatt__tool--lab"
            : "studio-workspace aec-werkstatt__tool"
        }
        data-studio={
          werkstatt === "flexlab" ? undefined : werkstatt === "simulation" ? "airport" : "munich"
        }
        data-theme={theme}
      >
        <Suspense
          fallback={
            <p className="aec-loading" role="status">
              {meta.title} wird geladen…
            </p>
          }
        >
          {tool}
        </Suspense>
      </div>
    </section>
  );
}

export function WerkstattLinks({ items, base }: { items: W[]; base: Route }) {
  return (
    <ul className="aec-tools">
      {items.map((w) => (
        <li key={w}>
          <Link to={{ ...base, werkstatt: w } as Route} className="aec-tool">
            <span className="aec-tool__title">{WERKSTATT_LABEL[w].title}</span>
            <span className="aec-tool__hint">{WERKSTATT_LABEL[w].hint}</span>
            <span className="aec-tool__go" aria-hidden="true">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
