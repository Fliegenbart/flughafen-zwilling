import { useEffect, useState, type FormEvent } from "react";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import { listExchange, proposeTest } from "../api/exchange";
import { whoseTurn } from "../model/exchange";
import { Section } from "../parts";
import type { ExchangeItem, Project } from "../types";

/** Was der Kunde von einem Pruefpunkt sieht: Zustand in einem Wort, kein Lab-Inneres. */
function customerState(item: ExchangeItem): "geprüft" | "in Prüfung" | "abgelehnt" {
  if (item.status === "abgelehnt") return "abgelehnt";
  return whoseTurn(item) === null ? "geprüft" : "in Prüfung";
}

function pruefAnswer(items: ExchangeItem[]): string {
  if (!items.length) return "Beim Testing-Lab liegt nichts zur Prüfung.";
  const running = items.filter((i) => customerState(i) === "in Prüfung").length;
  const checked = items.filter((i) => customerState(i) === "geprüft").length;
  if (!running)
    return `Das Testing-Lab hat alles geprüft, ${checked === 1 ? "einen Punkt" : `${checked} Punkte`}.`;
  return `Das Testing-Lab prüft gerade ${running === 1 ? "einen Punkt" : `${running} Punkte`}${checked ? `, ${checked === 1 ? "einen" : checked} hat es abgeschlossen` : ""}.`;
}

/**
 * Pruefstatus fuer Flughafen und E.ON Drive. Das Testing-Lab selbst (Messungen,
 * Modellabgleich, Freigaben) liegt im eigenen Raum `?seite=lab`.
 */
export default function Pruefstatus({ project }: { project: Project }) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
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
    if (!question) return setError("Was soll das Lab klären?");
    setError("");
    try {
      const item = await proposeTest(project, question, component);
      setItems((prev) => [item, ...(prev ?? [])]);
      setMsg("Anfrage gesendet. Das Ergebnis erscheint hier.");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anfrage fehlgeschlagen");
    }
  }

  const list = items ?? [];
  return (
    <Section title="Was das Testing-Lab gerade prüft" kicker="Prüfstand" id="pruefstatus">
      <p className="aec-pruef__answer">{items ? pruefAnswer(list) : "Wird geladen …"}</p>
      {list.length ? (
        <ul className="aec-pruef">
          {list.map((item) => {
            const state = customerState(item);
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
      <form className="aec-ask" onSubmit={ask} aria-labelledby="ask-title">
        <h3 id="ask-title">Etwas prüfen lassen</h3>
        <label>
          Was soll das Lab klären?
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
        <p className="aec-fine">Das Lab plant den Versuch und meldet das Ergebnis hier.</p>
      </form>
    </Section>
  );
}
