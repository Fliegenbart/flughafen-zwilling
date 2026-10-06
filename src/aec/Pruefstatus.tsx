import { useEffect, useState, type FormEvent } from "react";
import { EvidenceBadge } from "../ui/EvidenceBadge";
import { listExchange, proposeTest } from "./api";
import { whoseTurn } from "./analysis";
import { Section } from "./parts";
import type { ExchangeItem, Project } from "./types";

/** Was der Kunde von einem Pruefpunkt sieht: Zustand in einem Wort, kein Lab-Inneres. */
export function customerState(item: ExchangeItem): "geprüft" | "in Prüfung" | "abgelehnt" {
  if (item.status === "abgelehnt") return "abgelehnt";
  return whoseTurn(item) === null ? "geprüft" : "in Prüfung";
}

export function pruefAnswer(items: ExchangeItem[]): string {
  if (!items.length) return "Noch nichts beim Testing-Lab in Prüfung.";
  const running = items.filter((i) => customerState(i) === "in Prüfung").length;
  const checked = items.filter((i) => customerState(i) === "geprüft").length;
  if (!running)
    return `${checked === 1 ? "Ein Punkt" : `${checked} Punkte`} vom Testing-Lab geprüft.`;
  return `${running === 1 ? "Ein Punkt" : `${running} Punkte`} beim Testing-Lab in Prüfung, ${checked} geprüft.`;
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
    if (!question) return setError("Bitte beschreiben, was geprüft werden soll.");
    setError("");
    try {
      const item = await proposeTest(project, question, component);
      setItems((prev) => [item, ...(prev ?? [])]);
      setMsg("Prüfung angefragt. Das Testing-Lab meldet sich mit dem Ergebnis.");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anfrage fehlgeschlagen");
    }
  }

  const list = items ?? [];
  return (
    <Section title="Prüfstatus beim Testing-Lab" kicker="Was ist geprüft?" id="pruefstatus">
      <p className="aec-pruef__answer">{items ? pruefAnswer(list) : "Prüfstatus wird geladen…"}</p>
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
        <h3 id="ask-title">Prüfung beim Testing-Lab anfragen</h3>
        <label>
          Was soll geprüft werden?
          <input
            name="question"
            placeholder="Hält der Ladepark die Abflugwelle 06–08 Uhr?"
            autoComplete="off"
          />
        </label>
        <label>
          Komponente
          <input name="component" placeholder="Bus-Ladepunkt 150 kW" autoComplete="off" />
        </label>
        <button type="submit" className="aec-button">
          Prüfung anfragen
        </button>
        <p className="aec-fine">
          Übergangslösung, bis das System Prüfaufträge selbst anlegt. Versuchsentwurf, Freigabe
          durch das Lab.
        </p>
      </form>
    </Section>
  );
}
