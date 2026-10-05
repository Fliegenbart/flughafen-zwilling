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
import { loadDataInputs } from "../dataApi";
import { EMPTY_INPUTS, type DataInputs } from "../dataStatus";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import type { ExchangeItem, Party } from "../types";
import { WerkstattLinks } from "../Werkstatt";

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

/** Drei Teilfragen zu „Stimmt das?“: was wird geprüft, was gemessen, hält das Modell. */
const isQuestion = (i: ExchangeItem) => i.kind === "testanfrage" || i.kind === "szenario";
const isMeasured = (i: ExchangeItem) => i.kind === "ergebnis" || i.kind === "auswertung";

/**
 * Modellabgleich ehrlich benennen: nur PASS auf Holdout-Messdaten mit vorab
 * gesperrten Kriterien zaehlt. Alles andere bleibt offen.
 */
export function modelAnswer(inp: DataInputs): { answer: string; detail: string } {
  const holdout = inp.imports.filter((i) => i.role === "holdout" && i.valid);
  if (inp.holdoutPass)
    return {
      answer: "Im Holdout bestanden.",
      detail:
        "Modell gegen zurückgehaltene Messdaten mit vorab gesperrten Kriterien geprüft. Gilt nur für den gemessenen Zeitraum.",
    };
  if (!inp.available)
    return {
      answer: "Noch nicht geprüft.",
      detail:
        "Beispielprojekt: Es gibt keine Messreihe, gegen die das Modell laufen könnte. Bis dahin bleibt es ein unkalibrierter Methodenprototyp.",
    };
  if (!holdout.length)
    return {
      answer: "Noch nicht geprüft: keine Holdout-Messreihe.",
      detail:
        "Unter „Daten“ eine Messreihe als Holdout importieren. Sie wird nicht zur Kalibrierung genutzt, nur zum Prüfen.",
    };
  if (!inp.tolerances?.locked)
    return {
      answer: "Noch nicht geprüft: Kriterien nicht gesperrt.",
      detail: `${holdout.length === 1 ? "Eine Holdout-Messreihe liegt" : `${holdout.length} Holdout-Messreihen liegen`} vor. Erst die Toleranzen festlegen und sperren, dann bewerten.`,
    };
  return {
    answer: "Noch nicht bestanden.",
    detail:
      "Messdaten und gesperrte Kriterien liegen vor, eine bestandene Holdout-Bewertung aber nicht. Im Messdaten-Abgleich bewerten.",
  };
}

export default function AbgleichView({ project, route }: ViewProps) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [inputs, setInputs] = useState<DataInputs>(EMPTY_INPUTS);
  const [role, setRole] = useState<Role>(storedRole);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    void listExchange(project).then((list) => alive && setItems(list));
    void loadDataInputs(project)
      .then((inp) => alive && setInputs(inp))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [project]);

  const list = items ?? [];
  const open = list.filter((i) => whoseTurn(i) !== null);
  const atLab = open.filter((i) => whoseTurn(i) === "lab").length;
  const atAirport = open.filter((i) => whoseTurn(i) === "flughafen").length;
  const done = list.filter((i) => i.status === "erledigt").length;
  const questions = list.filter(isQuestion);
  const measured = list.filter(isMeasured);
  const model = modelAnswer(inputs);

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

  const thread = (entries: ExchangeItem[], empty: string) =>
    entries.length ? (
      <ol className="aec-thread">
        {entries.map((item) => (
          <ThreadItem
            key={item.id}
            item={item}
            canAdvance={(turn) => canAct(role, turn)}
            advance={advance}
          />
        ))}
      </ol>
    ) : (
      <p className="aec-muted">{empty}</p>
    );

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Abgleich · Stimmt das?"
        answer={items ? exchangeAnswer(list) : "Austausch wird geladen…"}
        lead="Drei Fragen in dieser Reihenfolge: Was prüfen wir? Was wurde gemessen? Stimmt das Modell mit der Messung überein? Jeder Punkt zeigt, wer am Zug ist."
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
          { value: inputs.holdoutPass ? "ja" : "offen", label: "Modell gegen Messung" },
        ]}
      />

      <div role="status" aria-live="polite" className="aec-notice">
        {msg}
      </div>
      {error ? (
        <p className="aec-error" role="alert">
          {error}
        </p>
      ) : null}

      <Section title="Was prüfen wir?" kicker="1 · Prüffragen und Szenarien" id="abgleich-fragen">
        {thread(questions, "Noch keine Prüffrage. Unten die erste Testanfrage stellen.")}
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

      <Section
        title="Was wurde gemessen?"
        kicker="2 · Lab-Ergebnisse und Auswertungen"
        id="abgleich-messung"
      >
        {thread(measured, "Noch keine Messung zurückgemeldet.")}
        <Details summary="Werkstatt: Messdaten realer Komponenten">
          <WerkstattLinks items={["flexlab"]} base={route} />
        </Details>
      </Section>

      <Section title="Stimmt das Modell?" kicker="3 · Modell gegen Messung" id="abgleich-modell">
        <div className="aec-verdict" data-pass={inputs.holdoutPass ? "" : undefined}>
          <p className="aec-verdict__answer">{model.answer}</p>
          <p>{model.detail}</p>
          <EvidenceBadge level={inputs.holdoutPass ? "empirical_passed" : "empirical_open"} />
        </div>
        <p>
          <Link
            to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}
            className="aec-button aec-button--ghost"
          >
            Messreihe unter „Daten“ importieren
          </Link>
        </p>
        <Details summary="Werkstatt: Kriterien sperren und Holdout bewerten">
          <WerkstattLinks items={["pilot"]} base={route} />
        </Details>
      </Section>

      <Details summary="Vorführung: Ansicht wechseln">
        <div className="aec-role" role="radiogroup" aria-label="Ich spreche als">
          <span>Ich spreche als</span>
          {(
            [
              ["airport", "Flughafen"],
              ["lab", "Testing-Lab"],
              ["admin", "beide"],
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
        <p className="aec-fine">
          Nur für die Vorführung: zeigt, welche Schritte Flughafen und Lab jeweils sehen. Kein
          Zugriffsschutz.
        </p>
      </Details>
    </>
  );
}

function ThreadItem({
  item,
  canAdvance,
  advance,
}: {
  item: ExchangeItem;
  canAdvance: (turn: Party) => boolean;
  advance: (item: ExchangeItem) => Promise<void>;
}) {
  const turn = whoseTurn(item);
  const to = nextStatus(item.status);
  return (
    <li data-from={item.from} data-turn={turn ?? "none"}>
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
          {turn && to && canAdvance(turn) ? (
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
}
