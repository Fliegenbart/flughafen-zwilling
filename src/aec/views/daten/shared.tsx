/** Gemeinsame Bausteine der Daten-Formulare: Karte, Formathinweis, Ergebnis, Fehlertext. */
import { useState, type ReactNode } from "react";
import { EvidenceBadge } from "../../../ui/EvidenceBadge";
import { importError, STATE_LABEL, type DataItem } from "../../model/dataStatus";
import { Details } from "../../parts";
import type { Project } from "../../types";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
const example = (file: string) => `${BASE}beispiele/${file}`;

export const EXAMPLE_REFUSED =
  "Das ist unsere Beispieldatei mit erfundenen Werten. Bitte wählen Sie die echte Datei Ihres Projekts.";

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? importError(e.message) : fallback;
}

export type FormProps = { project: Project; reload: () => Promise<void>; disabled: boolean };

export function StateChip({ state }: { state: DataItem["state"] }) {
  return (
    <span className="aec-dstate" data-state={state}>
      <i aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Format({ children, files }: { children: ReactNode; files: [string, string][] }) {
  return (
    <div className="aec-dformat">
      <p>
        <strong>So muss die Datei aussehen:</strong> {children}
      </p>
      {files.length ? (
        <p className="aec-dformat__files">
          {files.map(([file, label]) => (
            <a key={file} href={example(file)} download className="aec-dlink">
              {label}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function Result({ error, ok }: { error: string; ok: string }) {
  return (
    <>
      <p className="aec-derror" role="alert" hidden={!error}>
        {error}
      </p>
      <p className="aec-dok" role="status">
        {ok}
      </p>
    </>
  );
}

export function DataCard({
  item,
  index,
  children,
}: {
  item: DataItem;
  index: number;
  children: ReactNode;
}) {
  const id = `daten-${item.id}`;
  // Nur der Anfangszustand haengt am Status: nach einem Import bleibt der Abschnitt offen,
  // damit die Erfolgsmeldung sichtbar bleibt.
  const [initiallyOpen] = useState(item.state !== "echt");
  return (
    <li className="aec-dcard" data-state={item.state} aria-labelledby={id} id={`punkt-${item.id}`}>
      <header className="aec-dcard__head">
        <span className="aec-dcard__no" aria-hidden="true">
          {String.fromCharCode(97 + index)}
        </span>
        <h2 id={id}>{item.title}</h2>
        <StateChip state={item.state} />
        <EvidenceBadge level={item.evidence} detail={item.evidenceDetail} />
      </header>
      <dl className="aec-dcard__facts">
        <div>
          <dt>Woher</dt>
          <dd>{item.source ?? "noch keine Quelle"}</dd>
        </div>
        <div>
          <dt>Stand</dt>
          <dd>{item.date ?? "–"}</dd>
        </div>
      </dl>
      <p className="aec-dcard__detail">{item.detail}</p>
      {item.warnings.length ? (
        <ul className="aec-dcard__warn">
          {item.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <Details
        summary={item.state === "echt" ? "Ergänzen oder ersetzen" : "Jetzt eintragen"}
        open={initiallyOpen}
      >
        {children}
      </Details>
    </li>
  );
}
