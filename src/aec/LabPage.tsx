import { useEffect, useState } from "react";
import { EvidenceBadge } from "../ui/EvidenceBadge";
import {
  advanceExchange,
  getProject,
  listExchange,
  listProjects,
  storedRole,
  storeRole,
  type Role,
} from "./api";
import {
  ACTION_LABEL,
  EXCHANGE_FLOW,
  exchangeAnswer,
  nextStatus,
  PARTY_LABEL,
  STATUS_LABEL,
  whoseTurn,
} from "./analysis";
import Link from "./Link";
import { loadDataInputs } from "./dataApi";
import { EMPTY_INPUTS, type DataInputs } from "./dataStatus";
import { AnswerHead, Details, Section } from "./parts";
import { useNav } from "./context";
import type { Route } from "./routes";
import type { ExchangeItem, Party, Project } from "./types";
import { WerkstattFrame, WerkstattLinks } from "./Werkstatt";

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

const canAct = (role: Role, party: Party) =>
  role === "admin" || (role === "airport" ? party === "flughafen" : party === "lab");

/** Drei Teilfragen zu „Stimmt das?“: was wird geprüft, was gemessen, hält das Modell. */
const isQuestion = (i: ExchangeItem) => i.kind === "testanfrage" || i.kind === "szenario";
const isMeasured = (i: ExchangeItem) => i.kind === "ergebnis" || i.kind === "auswertung";

/**
 * Modellabgleich ehrlich benennen: nur PASS auf Holdout-Messdaten mit vorab
 * gesperrten Kriterien zaehlt. Alles andere bleibt offen.
 */
function modelAnswer(inp: DataInputs): { answer: string; detail: string } {
  const holdout = inp.imports.filter((i) => i.role === "holdout" && i.valid);
  if (inp.holdoutPass)
    return {
      answer: "Holdout bestanden.",
      detail:
        "Das Modell hält die vorab gesperrten Toleranzen gegen die zurückgehaltene Messreihe ein, gültig für den gemessenen Zeitraum.",
    };
  if (!inp.available)
    return {
      answer: "Noch nicht geprüft.",
      detail: "Das Beispielprojekt hat keine Messreihe, das Modell bleibt hier unkalibriert.",
    };
  if (!holdout.length)
    return {
      answer: "Noch kein Holdout vorhanden.",
      detail:
        "Eine Messreihe unter „Daten“ als Holdout einlesen. Sie wird nicht zur Kalibrierung verwendet.",
    };
  if (!inp.tolerances?.locked)
    return {
      answer: "Toleranzen noch nicht gesperrt.",
      detail: `${holdout.length === 1 ? "Ein Holdout liegt" : `${holdout.length} Holdouts liegen`} vor. Bewertet wird erst gegen gesperrte Toleranzen.`,
    };
  return {
    answer: "Holdout noch nicht bestanden.",
    detail:
      "Holdout und gesperrte Toleranzen liegen vor, eine bestandene Bewertung fehlt. Bewerten unter „Modell gegen Messung“.",
  };
}

type LabRoute = Extract<Route, { page: "lab" }>;

/**
 * Testing-Lab-Backbone: interner Pruefraum. Eingang der Pruefauftraege eines Projekts,
 * Messungen und Modellabgleich. Kunden sehen davon nur den Pruefstatus (Schritt Nachweis).
 */
export default function LabPage({ route, theme }: { route: LabRoute; theme?: "light" | "dark" }) {
  const nav = useNav();
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [inputs, setInputs] = useState<DataInputs>(EMPTY_INPUTS);
  const [role, setRole] = useState<Role>(storedRole);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    void listProjects().then((list) => alive && setProjects(list));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await getProject(route.projekt);
      if (!alive) return;
      setProject(p);
      void listExchange(p).then((list) => alive && setItems(list));
      void loadDataInputs(p)
        .then((inp) => alive && setInputs(inp))
        .catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [route.projekt]);

  useEffect(() => {
    if (route.werkstatt) document.getElementById("werkstatt")?.scrollIntoView?.({ block: "start" });
  }, [route.werkstatt]);

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
    if (!to || !turn || !project) return;
    setError("");
    try {
      const next = await advanceExchange(project, item, to, turn);
      setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? next : i)));
      setMsg(`„${item.title}“ ist jetzt ${STATUS_LABEL[to]}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das hat nicht geklappt.");
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
    <div className="aec-lab">
      <div className="aec-labbar">
        <div className="aec-labbar__id">
          <span className="aec-labbar__space">Testing-Lab · interner Prüfraum</span>
          <label className="aec-labbar__pick">
            Projekt
            <select
              value={route.projekt}
              onChange={(e) => nav.navigate({ page: "lab", projekt: e.target.value })}
            >
              {projects.some((p) => p.id === route.projekt) ? null : (
                <option value={route.projekt}>{project?.name ?? route.projekt}</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "nachweis" }}
          className="aec-button aec-button--ghost aec-button--small"
        >
          So sieht es der Kunde
        </Link>
      </div>

      <div className="aec-page">
        <AnswerHead
          id="aec-view-title"
          question="Testing-Lab · Was liegt an?"
          answer={items ? exchangeAnswer(list) : "Wird geladen …"}
          lead="Flughafen und E.ON Drive sehen von diesem Raum nur den Prüfstatus an ihren Zahlen."
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
            { value: inputs.holdoutPass ? "ja" : "offen", label: "Modell durch Messung bestätigt" },
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

        <Section title="Offene Anfragen" kicker="1 · Anfragen und Krisenfälle" id="lab-fragen">
          {thread(questions, "Keine offene Anfrage.")}
        </Section>

        <Section title="Ergebnisse aus dem Lab" kicker="2 · Messungen" id="lab-messung">
          {thread(measured, "Noch keine Messung zurückgemeldet.")}
          <Details summary="Messdaten echter Komponenten (FlexLab-Werkbank)">
            <WerkstattLinks items={["flexlab"]} base={route} />
          </Details>
        </Section>

        <Section title="Modell gegen Messung" kicker="3 · Validierung" id="lab-modell">
          <div className="aec-verdict" data-pass={inputs.holdoutPass ? "" : undefined}>
            <p className="aec-verdict__answer">{model.answer}</p>
            <p>{model.detail}</p>
            <EvidenceBadge level={inputs.holdoutPass ? "empirical_passed" : "empirical_open"} />
          </div>
          <Details summary="Toleranzen sperren und Holdout bewerten">
            <WerkstattLinks items={["pilot"]} base={route} />
          </Details>
        </Section>

        {route.werkstatt ? (
          <WerkstattFrame
            werkstatt={route.werkstatt}
            theme={theme}
            close={{ page: "lab", projekt: route.projekt }}
          />
        ) : null}

        <Details summary="Ansicht für Vorführungen wechseln">
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
            Schaltet um, welche Schritte Flughafen und Lab jeweils erledigen dürfen. Kein
            Zugriffsschutz.
          </p>
        </Details>
      </div>
    </div>
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
