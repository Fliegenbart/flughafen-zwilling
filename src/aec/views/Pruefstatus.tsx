import { useEffect, useState, type FormEvent } from "react";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import { listExchange, proposeTest } from "../api/exchange";
import { Section } from "../parts";
import type { ExchangeItem, ExchangeStatus, Project } from "../types";

const PRUEFSTATE_LABEL: Record<ExchangeStatus, string> = {
  vorgeschlagen: "angefragt",
  angenommen: "angenommen",
  geplant: "in Prüfung",
  erledigt: "abgeschlossen",
  abgelehnt: "abgelehnt",
  uebergeben: "übergeben",
};

/** Sichtbarer Status folgt dem gespeicherten Arbeitsstand, nicht der internen Rolle. */
export function pruefState(item: ExchangeItem): string {
  return PRUEFSTATE_LABEL[item.status];
}

function pruefAnswer(items: ExchangeItem[]): string {
  if (!items.length) return "Im Prüfplan liegen noch keine Anfragen.";
  const count = (status: ExchangeStatus) => items.filter((item) => item.status === status).length;
  const summary = (status: ExchangeStatus, label: string) => {
    const n = count(status);
    return n ? `${n} ${n === 1 ? "Anfrage" : "Anfragen"} ${label}` : null;
  };
  const states = [
    summary("vorgeschlagen", "angefragt"),
    summary("angenommen", "angenommen"),
    summary("geplant", "in Prüfung"),
    summary("erledigt", "abgeschlossen"),
    summary("abgelehnt", "abgelehnt"),
    summary("uebergeben", "übergeben"),
  ].filter((state): state is string => state !== null);
  return `Im Prüfplan: ${states.join(", ")}.`;
}

/** Pruefstatus fuer Flughafen-Simulationen; Details liegen im eigenen Pruefbereich. */
export default function Pruefstatus({ project }: { project: Project }) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (project.source === "beispiel") return;
    let alive = true;
    void listExchange(project).then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, [project]);

  async function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const question = String(f.get("question") ?? "").trim();
    const component = String(f.get("component") ?? "").trim();
    if (!question) return setError("Welche Frage soll geprüft werden?");
    setError("");
    try {
      const item = await proposeTest(project, question, component);
      setItems((prev) => [item, ...(prev ?? [])]);
      setMsg("Anfrage gesendet. Sie erscheint im Prüfplan.");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anfrage fehlgeschlagen");
    }
  }

  const list = items ?? [];
  const isExample = project.source === "beispiel";
  return (
    <Section title="Prüfplan" kicker="Prüfung" id="pruefstatus">
      <p className="aec-pruef__answer">
        {isExample ? "Beispiel-Prüfplan · nicht beauftragt." : items ? pruefAnswer(list) : "Wird geladen …"}
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
        <p className="aec-fine">Der Beispiel-Prüfplan ist ein Entwurf und enthält keine beauftragte Prüfung.</p>
      ) : (
        <form className="aec-ask" onSubmit={ask} aria-labelledby="ask-title">
          <h3 id="ask-title">Etwas prüfen lassen</h3>
          <label>
            Welche Frage soll geprüft werden?
            <input
              name="question"
              placeholder="Hält der Ladepark die Abflugwelle 06–08 Uhr?"
              autoComplete="off"
            />
          </label>
          <label>
            Um welches Gerät geht es?
            <input name="component" placeholder="Bus-Ladepunkt 150 kW" autoComplete="off" />
          </label>
          <button type="submit" className="aec-button">
            Anfrage senden
          </button>
          <p className="aec-fine">Messdaten werden hier nur ausgewiesen, wenn sie vorliegen.</p>
        </form>
      )}
    </Section>
  );
}
