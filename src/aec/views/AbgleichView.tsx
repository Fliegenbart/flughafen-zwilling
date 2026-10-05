import { useEffect, useState, type FormEvent } from "react";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import {
  advanceExchange,
  listExchange,
  proposeTest,
  storedRole,
  storeRole,
  type Role,
} from "../api";
import {
  ACTION_LABEL,
  EXCHANGE_FLOW,
  exchangeAnswer,
  nextStatus,
  PARTY_LABEL,
  STATUS_LABEL,
  whoseTurn,
} from "../analysis";
import Link from "../Link";
import { AnswerHead, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import type { ExchangeItem, Party } from "../types";
import { WERKSTATT_LABEL } from "../Werkstatt";

const KIND_LABEL: Record<ExchangeItem["kind"], string> = {
  szenario: "Szenario",
  testanfrage: "Testanfrage",
  ergebnis: "Lab-Ergebnis",
  auswertung: "FlexLab-Auswertung",
};

const when = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}. ${m[4]}` : iso;
};

function Flow({ item }: { item: ExchangeItem }) {
  if (item.status === "uebergeben" || item.status === "abgelehnt")
    return <span className="aec-flow aec-flow--single">{STATUS_LABEL[item.status]}</span>;
  const at = EXCHANGE_FLOW.indexOf(item.status);
  return (
    <ol className="aec-flow" aria-label={`Status: ${STATUS_LABEL[item.status]}`}>
      {EXCHANGE_FLOW.map((s, i) => (
        <li
          key={s}
          data-done={i <= at ? "" : undefined}
          aria-current={i === at ? "step" : undefined}
        >
          <span>{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

const canAct = (role: Role, party: Party) =>
  role === "admin" || (role === "airport" ? party === "flughafen" : party === "lab");

export default function AbgleichView({ project, route }: ViewProps) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [role, setRole] = useState<Role>(storedRole);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    void listExchange(project).then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, [project]);

  const list = items ?? [];
  const open = list.filter((i) => whoseTurn(i) !== null);
  const atLab = open.filter((i) => whoseTurn(i) === "lab").length;
  const atAirport = open.filter((i) => whoseTurn(i) === "flughafen").length;
  const done = list.filter((i) => i.status === "erledigt").length;
  const labResults = list.filter((i) => i.kind === "ergebnis" || i.kind === "auswertung").length;

  async function advance(item: ExchangeItem) {
    const to = nextStatus(item.status);
    const turn = whoseTurn(item);
    if (!to || !turn) return;
    setError("");
    try {
      const next = await advanceExchange(project, item, to, turn);
      setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? next : i)));
      setMsg(`„${item.title}“ ist jetzt ${STATUS_LABEL[to]}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statuswechsel fehlgeschlagen");
    }
  }

  async function propose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const question = String(f.get("question") ?? "").trim();
    const component = String(f.get("component") ?? "").trim();
    if (!question) return setError("Bitte die Prüffrage formulieren.");
    setError("");
    try {
      const item = await proposeTest(project, question, component);
      setItems((prev) => [item, ...(prev ?? [])]);
      setMsg("Testanfrage gestellt. Am Zug: Testing-Lab.");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anfrage fehlgeschlagen");
    }
  }

  const tab =
    route.werkstatt === "pilot" || route.werkstatt === "flexlab" ? route.werkstatt : "austausch";

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Abgleich · Stimmt das?"
        answer={items ? exchangeAnswer(list) : "Austausch wird geladen…"}
        lead="Flughafen und Testing-Lab tauschen Szenarien, Testanfragen und Messergebnisse aus. Jeder Punkt zeigt, wer am Zug ist."
        evidence="empirical_open"
        source={list.some((i) => i.source === "api") ? "api" : "beispiel"}
        kpis={[
          {
            value: String(atLab),
            label: "am Zug: Testing-Lab",
            tone: atLab ? "signal" : undefined,
          },
          {
            value: String(atAirport),
            label: "am Zug: Flughafen",
            tone: atAirport ? "signal" : undefined,
          },
          { value: String(done), label: "erledigt" },
          { value: String(labResults), label: "Lab-Ergebnisse und Auswertungen" },
        ]}
      />

      <nav className="aec-tabs" aria-label="Abgleich: Bereiche">
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "abgleich" }}
          current={tab === "austausch" ? "page" : undefined}
        >
          Austausch
        </Link>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "abgleich", werkstatt: "pilot" }}
          current={tab === "pilot" ? "page" : undefined}
        >
          {WERKSTATT_LABEL.pilot.title}
        </Link>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "abgleich", werkstatt: "flexlab" }}
          current={tab === "flexlab" ? "page" : undefined}
        >
          {WERKSTATT_LABEL.flexlab.title}
        </Link>
      </nav>

      {tab === "austausch" ? (
        <Section title="Gesprächsverlauf" kicker="Flughafen ↔ Testing-Lab" id="abgleich-log">
          <div className="aec-role" role="radiogroup" aria-label="Ich spreche als">
            <span>Ich spreche als</span>
            {(
              [
                ["airport", "Flughafen"],
                ["lab", "Testing-Lab"],
                ["admin", "beide (Vorführung)"],
              ] as const
            ).map(([r, l]) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => {
                  setRole(r);
                  storeRole(r);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite" className="aec-notice">
            {msg}
          </div>
          {error ? (
            <p className="aec-error" role="alert">
              {error}
            </p>
          ) : null}
          <ol className="aec-thread">
            {list.map((item) => {
              const turn = whoseTurn(item);
              const to = nextStatus(item.status);
              return (
                <li key={item.id} data-from={item.from} data-turn={turn ?? "none"}>
                  <article className="aec-msg" aria-labelledby={`x-${item.id}`}>
                    <header>
                      <span className="aec-msg__who">{PARTY_LABEL[item.from]}</span>
                      <span className="aec-msg__kind">{KIND_LABEL[item.kind]}</span>
                      <time dateTime={item.history[0]?.at}>{when(item.history[0]?.at ?? "")}</time>
                    </header>
                    <h3 id={`x-${item.id}`}>{item.title}</h3>
                    {item.summary ? <p>{item.summary}</p> : null}
                    <Flow item={item} />
                    {item.history.length > 1 ? (
                      <ul className="aec-msg__log">
                        {item.history.slice(1).map((h, i) => (
                          <li key={i}>
                            <time dateTime={h.at}>{when(h.at)}</time> {PARTY_LABEL[h.by]}:{" "}
                            {STATUS_LABEL[h.status]}
                            {h.note ? ` – ${h.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <footer>
                      <EvidenceBadge level={item.evidence} />
                      {turn ? (
                        <span className="aec-turn">
                          Am Zug: <b>{PARTY_LABEL[turn]}</b>
                        </span>
                      ) : (
                        <span className="aec-turn aec-turn--done">abgeschlossen</span>
                      )}
                      {turn && to && canAct(role, turn) ? (
                        <button
                          type="button"
                          className="aec-button aec-button--small"
                          onClick={() => void advance(item)}
                        >
                          {ACTION_LABEL[to]}
                        </button>
                      ) : null}
                    </footer>
                  </article>
                </li>
              );
            })}
          </ol>
          {role !== "lab" ? (
            <form className="aec-ask" onSubmit={propose} aria-labelledby="ask-title">
              <h3 id="ask-title">Testanfrage an das Lab</h3>
              <label>
                Prüffrage
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
                Anfrage stellen
              </button>
              <p className="aec-fine">Versuchsentwurf, Freigabe separat. Keine Hardwarewrites.</p>
            </form>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
