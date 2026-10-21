import { useEffect, useState, type FormEvent } from "react";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import { listExchange, proposeTest } from "../api/exchange";
import { Section } from "../parts";
import type { ExchangeItem, ExchangeStatus, Project } from "../types";

const PRUEFSTATE_LABEL: Record<ExchangeStatus, string> = {
  vorgeschlagen: "angefragt",
  angenommen: "angenommen",
  geplant: "Messung geplant",
  erledigt: "Messdaten ausgewertet",
  abgelehnt: "abgelehnt",
  uebergeben: "übergeben",
};

/** Sichtbarer Status folgt dem gespeicherten Arbeitsstand, nicht der internen Rolle. */
export function pruefState(item: ExchangeItem): string {
  return PRUEFSTATE_LABEL[item.status];
}

function pruefAnswer(items: ExchangeItem[]): string {
  if (!items.length) return "Noch kein Messdaten-Abgleich beauftragt.";
  const count = (status: ExchangeStatus) => items.filter((item) => item.status === status).length;
  const summary = (status: ExchangeStatus, label: string) => {
    const n = count(status);
    return n ? `${n} ${n === 1 ? "Anfrage" : "Anfragen"} ${label}` : null;
  };
  const states = [
    summary("vorgeschlagen", "angefragt"),
    summary("angenommen", "angenommen"),
    summary("geplant", "mit Messung geplant"),
    summary("erledigt", "mit Messdaten ausgewertet"),
    summary("abgelehnt", "abgelehnt"),
    summary("uebergeben", "übergeben"),
  ].filter((state): state is string => state !== null);
  return `Im Messdaten-Abgleich: ${states.join(", ")}.`;
}

/** Status fuer den Vergleich der Simulation mit dokumentierten Messdaten. */
export default function Pruefstatus({ project }: { project: Project }) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const isExample = project.source === "beispiel";

  useEffect(() => {
    if (project.source === "beispiel") return;
    let alive = true;
    void listExchange(project)
      .then((list) => alive && setItems(list))
      .catch((err: unknown) => {
        if (alive)
          setError(
            err instanceof Error ? err.message : "Messdaten-Abgleich konnte nicht geladen werden.",
          );
      });
    return () => {
      alive = false;
    };
  }, [project]);

  async function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isExample) {
      setError("Für das Beispielprojekt kann kein Messdaten-Abgleich beauftragt werden.");
      return;
    }
    const form = e.currentTarget;
    const f = new FormData(form);
    const question = String(f.get("question") ?? "").trim();
    const component = String(f.get("component") ?? "").trim();
    if (!question) return setError("Welche Frage soll geprüft werden?");
    setError("");
    try {
      const item = await proposeTest(project, question, component);
      setItems((prev) => [item, ...(prev ?? [])]);
      setMsg("Anfrage gesendet. Sie erscheint im Messdaten-Abgleich.");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anfrage fehlgeschlagen");
    }
  }

  const list = items ?? [];
  return (
    <Section title="Messdaten-Abgleich" kicker="Messdaten" id="pruefstatus">
      <p className="aec-pruef__answer">
        {isExample
          ? "Für das Beispielprojekt ist kein Messdaten-Abgleich beauftragt."
          : items
            ? pruefAnswer(list)
            : "Wird geladen …"}
      </p>
      {!isExample && list.length ? (
        <ul className="aec-pruef">
          {list.map((item) => {
            const state = pruefState(item);
            return (
              <li key={item.id} data-state={state}>
                <span className="aec-pruef__state">{state}</span>
                <span className="aec-pruef__title">{item.title}</span>
                <EvidenceBadge level={item.evidence} />
              </li>
            );
          })}
        </ul>
      ) : null}
      <div role="status" aria-live="polite" className="aec-notice">
        {msg}
      </div>
      {error ? (
        <p className="aec-error" role="alert">
          {error}
        </p>
      ) : null}
      {isExample ? (
        <p className="aec-fine">
          Ein Abgleich benötigt dokumentierte Messdaten mit Messort, Zeitraum und Herkunft.
        </p>
      ) : (
        <form className="aec-ask" onSubmit={ask} aria-labelledby="ask-title">
          <h3 id="ask-title">Messdaten-Abgleich anfragen</h3>
          <label>
            Welche Simulationsfrage soll mit Messdaten verglichen werden?
            <input
              name="question"
              placeholder="Hält der Ladepark die Abflugwelle 06–08 Uhr?"
              autoComplete="off"
            />
          </label>
          <label>
            Welche Messgrenze oder Komponente betrifft sie?
            <input name="component" placeholder="Abgang Ladepark" autoComplete="off" />
          </label>
          <button type="submit" className="aec-button">
            Messdaten-Abgleich anfragen
          </button>
          <p className="aec-fine">
            Der Vergleich wird erst mit Messdaten, dokumentierter Messgrenze und festgelegten
            Kriterien durchgeführt.
          </p>
        </form>
      )}
    </Section>
  );
}
