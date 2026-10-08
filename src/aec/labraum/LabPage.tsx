import { useEffect, useState } from "react";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import { advanceExchange, listExchange } from "../api/exchange";
import { getProject, listProjects } from "../api/projects";
import { storedRole, storeRole, type Role } from "../api/role";
import { exchangeAnswer, nextStatus, STATUS_LABEL, whoseTurn } from "../model/exchange";
import Link from "../Link";
import { loadDataInputs } from "../api/data";
import { EMPTY_INPUTS, type DataInputs } from "../model/dataStatus";
import { AnswerHead, Details, Section } from "../parts";
import { useNav } from "../context";
import type { Route } from "../routes";
import type { ExchangeItem, Project } from "../types";
import { WerkstattFrame, WerkstattLinks } from "../Werkstatt";
import { canAct, isMeasured, isQuestion, modelAnswer } from "./modelStatus";
import ThreadItem from "./Thread";

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
