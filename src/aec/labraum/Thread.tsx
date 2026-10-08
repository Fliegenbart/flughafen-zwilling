/** Ein Punkt im Austausch: wer, was, Statusfluss, wer am Zug ist. */
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import {
  ACTION_LABEL,
  EXCHANGE_FLOW,
  nextStatus,
  PARTY_LABEL,
  STATUS_LABEL,
  whoseTurn,
} from "../model/exchange";
import type { ExchangeItem, Party } from "../types";

const KIND_LABEL: Record<ExchangeItem["kind"], string> = {
  szenario: "Krisenfall",
  testanfrage: "Prüfanfrage",
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

export default function ThreadItem({
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
