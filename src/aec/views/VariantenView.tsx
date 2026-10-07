import { useEffect, useState } from "react";
import { bestVariant, dec1, int, powerText, variantsAnswer } from "../analysis";
import { createVariant, deleteVariant, runVariants } from "../api";
import { sampleVariants } from "../sample";
import { caseBySlug, SCENARIO_CASES } from "../scenarios";
import { AnswerHead, Details, Section, SourceTag } from "../parts";
import type { ViewProps } from "../ProjectPage";
import type { FleetKind, Variant, VariantBoard, VariantChanges } from "../types";
import { WerkstattLinks } from "../Werkstatt";
import { EvidenceBadge } from "../../ui/EvidenceBadge";
import Link from "../Link";

const FLEET_LABEL: Record<FleetKind, string> = {
  bus: "Busse",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Pushback-Schlepper",
  gpu: "Bodenstromgeräte",
};

/** Vorschlaege relativ zur Projekt-Basis; nur gueltige Aenderungen werden angeboten. */
function suggestions(board: VariantBoard): { name: string; changes: VariantChanges }[] {
  const base = board.base;
  if (!base) return [];
  const list: { name: string; changes: VariantChanges }[] = [
    { name: "5 Schlepper mehr", changes: { extra_vehicles: { pushback_tug: 5 } } },
    { name: "Batteriespeicher 2 MWh", changes: { storage_kwh: 2000, storage_kw: 1000 } },
    {
      name: "1 MW mehr Anschluss",
      changes: { grid_import_limit_kw: base.gridLimitKw + 1000 },
    },
  ];
  if (base.policy !== "mission_priority")
    list.push({
      name: "Wer zuerst los muss, lädt zuerst",
      changes: { charging_policy: "mission_priority" },
    });
  const taken = new Set(board.definitions.map((d) => d.name.toLowerCase()));
  return list.filter((s) => !taken.has(s.name.toLowerCase()));
}

function describe(changes: VariantChanges): string {
  const parts: string[] = [];
  if (changes.grid_import_limit_kw !== undefined)
    parts.push(`Netzanschluss ${powerText(changes.grid_import_limit_kw)}`);
  if (changes.storage_kwh)
    parts.push(
      `Batteriespeicher ${dec1(changes.storage_kwh / 1000)} MWh mit ${powerText(changes.storage_kw ?? changes.storage_kwh / 2)}`,
    );
  for (const [k, n] of Object.entries(changes.extra_vehicles ?? {}))
    parts.push(`${n} ${FLEET_LABEL[k as FleetKind] ?? k} mehr`);
  for (const [k, n] of Object.entries(changes.chargers_offline ?? {}))
    parts.push(`${n} Ladepunkte für ${FLEET_LABEL[k as FleetKind] ?? k} ausgefallen`);
  if (changes.charging_policy)
    parts.push(
      changes.charging_policy === "mission_priority"
        ? "Wer zuerst los muss, lädt zuerst"
        : "Jedes Fahrzeug lädt, sobald es steckt",
    );
  if (changes.pv_factor !== undefined) parts.push(`Photovoltaik × ${dec1(changes.pv_factor)}`);
  return parts.join(" · ");
}

type Lever = "anschluss" | "speicher" | "fahrzeuge" | "laderegel" | "ausfall" | "pv";

function FreeForm({
  onAdd,
  busy,
}: {
  onAdd: (name: string, c: VariantChanges) => void;
  busy: boolean;
}) {
  const [lever, setLever] = useState<Lever>("fahrzeuge");
  const [name, setName] = useState("");
  const [value, setValue] = useState("3");
  const [value2, setValue2] = useState("");
  const [kind, setKind] = useState<FleetKind>("pushback_tug");
  const [policy, setPolicy] = useState<"mission_priority" | "uncontrolled">("mission_priority");

  const build = (): VariantChanges | null => {
    const n = Number(value.replace(",", "."));
    if (lever === "laderegel") return { charging_policy: policy };
    if (!Number.isFinite(n)) return null;
    if (lever === "anschluss") return { grid_import_limit_kw: n };
    if (lever === "pv") return { pv_factor: n };
    if (lever === "fahrzeuge") return { extra_vehicles: { [kind]: Math.round(n) } };
    if (lever === "ausfall") return { chargers_offline: { [kind]: Math.round(n) } };
    const kw = Number(value2.replace(",", "."));
    return value2.trim() && Number.isFinite(kw)
      ? { storage_kwh: n, storage_kw: kw }
      : { storage_kwh: n };
  };
  const label: Record<Lever, string> = {
    anschluss: "Netzanschluss (kW)",
    speicher: "Batteriespeicher (kWh)",
    fahrzeuge: "Mehr Fahrzeuge",
    laderegel: "Laderegel",
    ausfall: "Ladepunkte fallen aus",
    pv: "Photovoltaik (× heute)",
  };

  return (
    <form
      className="aec-varform"
      onSubmit={(e) => {
        e.preventDefault();
        const changes = build();
        if (!changes) return;
        onAdd(name.trim() || describe(changes), changes);
        setName("");
      }}
    >
      <label>
        <span>Was ändern Sie?</span>
        <select
          value={lever}
          onChange={(e) => {
            const l = e.target.value as Lever;
            setLever(l);
            setValue(
              {
                anschluss: "4500",
                speicher: "2000",
                fahrzeuge: "3",
                laderegel: "",
                ausfall: "1",
                pv: "1,5",
              }[l],
            );
            setValue2("");
          }}
        >
          {(Object.keys(label) as Lever[]).map((l) => (
            <option key={l} value={l}>
              {label[l]}
            </option>
          ))}
        </select>
      </label>
      {lever === "fahrzeuge" || lever === "ausfall" ? (
        <label>
          <span>Fahrzeugart</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FleetKind)}>
            {(Object.keys(FLEET_LABEL) as FleetKind[]).map((k) => (
              <option key={k} value={k}>
                {FLEET_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {lever === "laderegel" ? (
        <label>
          <span>Regel</span>
          <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
            <option value="mission_priority">Wer zuerst los muss, lädt zuerst</option>
            <option value="uncontrolled">Jedes Fahrzeug lädt, sobald es steckt</option>
          </select>
        </label>
      ) : (
        <label>
          <span>{lever === "fahrzeuge" || lever === "ausfall" ? "Anzahl" : label[lever]}</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
      )}
      {lever === "speicher" ? (
        <label>
          <span>Leistung in kW (freiwillig)</span>
          <input
            inputMode="decimal"
            value={value2}
            placeholder="sonst halbe Kapazität"
            onChange={(e) => setValue2(e.target.value)}
          />
        </label>
      ) : null}
      <label className="aec-varform__name">
        <span>Eigener Name (freiwillig)</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="aec-button aec-button--ghost" disabled={busy}>
        Hinzufügen
      </button>
    </form>
  );
}

/** Stresstest-Auswahl: keiner, Netzimport −20 % oder ein Krisenfall der Bibliothek (Slug). */
type StressChoice = "none" | "grid" | string;

function Editor({
  board,
  project,
  reload,
  krise,
}: Pick<ViewProps, "project"> & {
  board: VariantBoard;
  reload: () => Promise<VariantBoard>;
  krise?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stress, setStress] = useState<StressChoice>(caseBySlug(krise) ? krise! : "none");
  const crisis = caseBySlug(stress);
  const running = board.run?.status === "queued" || board.run?.status === "running";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!board.base)
    return (
      <p className="aec-muted" role="note">
        Um Lösungen für Ihr Projekt zu rechnen, braucht es einen Flugplan. Hinterlegen Sie ihn unter
        „Daten“. Bis dahin sehen Sie hier Beispielwerte.
      </p>
    );

  const sugg = suggestions(board);
  const full = board.definitions.length >= 8;
  return (
    <div className="aec-vareditor">
      <p className="aec-muted">
        Heute: {board.base.fleet.total ?? "?"} Fahrzeuge, Netzanschluss{" "}
        {powerText(board.base.gridLimitKw)}
        {board.base.storageKwh
          ? `, Batteriespeicher ${dec1(board.base.storageKwh / 1000)} MWh`
          : ", kein Batteriespeicher"}
        .{" "}
        {board.base.policy === "mission_priority"
          ? "Wer zuerst los muss, lädt zuerst."
          : "Jedes Fahrzeug lädt, sobald es steckt."}
        {board.base.source === "coupled_run" ? "" : " Vorerst sind das Standardwerte."} Jede Lösung
        ändert eine Sache daran.
      </p>
      {sugg.length && !full ? (
        <div className="aec-chips" role="group" aria-label="Vorschläge zum Ausprobieren">
          {sugg.map((s) => (
            <button
              key={s.name}
              type="button"
              className="aec-chip"
              disabled={busy}
              onClick={() => void act(() => createVariant(project, s.name, s.changes))}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!full ? (
        <Details summary="Eigene Lösung zusammenstellen">
          <FreeForm busy={busy} onAdd={(n, c) => void act(() => createVariant(project, n, c))} />
        </Details>
      ) : null}
      {board.definitions.length ? (
        <ul className="aec-vardefs">
          {board.definitions.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b>
              <span>{describe(d.changes)}</span>
              <button
                type="button"
                className="aec-linkbtn"
                disabled={busy || running}
                aria-label={`${d.name} entfernen`}
                onClick={() => void act(() => deleteVariant(project, d.id))}
              >
                entfernen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aec-muted">Noch nichts ausgewählt.</p>
      )}
      <div className="aec-varrun">
        <button
          type="button"
          className="aec-button"
          disabled={busy || running || !board.definitions.length}
          onClick={() =>
            void act(() =>
              runVariants(project, stress !== "none", false, crisis?.scenarioId ?? null),
            )
          }
        >
          {running ? "Wird gerechnet …" : board.run ? "Neu rechnen" : "Lösungen durchrechnen"}
        </button>
        <label className="aec-stresspick">
          Zusätzlich unter Stress rechnen
          <select value={stress} onChange={(e) => setStress(e.target.value)}>
            <option value="none">nein</option>
            <option value="grid">Anschluss den ganzen Tag 20 % schwächer</option>
            <optgroup label="Ein Krisenfall aus der Bibliothek">
              {SCENARIO_CASES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {board.run ? (
          <div
            className="aec-progress"
            role="progressbar"
            aria-label="Fortschritt der Berechnung"
            aria-valuemin={0}
            aria-valuemax={board.run.total}
            aria-valuenow={board.run.done}
          >
            <em>
              {board.run.done} von {board.run.total} fertig
              {board.run.status === "partial" ? " · nicht alle haben geklappt" : ""}
            </em>
            <i className="aec-progress__track" aria-hidden="true">
              <span
                style={{ width: `${(board.run.done / Math.max(1, board.run.total)) * 100}%` }}
              />
            </i>
          </div>
        ) : null}
      </div>
      {crisis ? (
        <p className="aec-fine" role="note">
          <b>So rechnen wir „{crisis.name}“ (Annahme):</b> {crisis.energyStress} Der Flugplan bleibt
          derselbe, gerechnet werden der heutige Stand und jede Lösung zusätzlich unter dieser
          Störung.
        </p>
      ) : null}
      {board.run?.crisis && board.run.crisis.id !== crisis?.scenarioId ? (
        <p className="aec-fine">
          Zuletzt gerechnet unter „{board.run.crisis.name}“: {board.run.crisis.assumption}
        </p>
      ) : null}
      {board.run?.stale && !running ? (
        <p className="aec-muted">
          Sie haben die Auswahl geändert. Rechnen Sie neu, damit die Ergebnisse passen.
        </p>
      ) : null}
      {error ? (
        <p className="aec-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Runway({
  variants,
  base,
  bestId,
}: {
  variants: Variant[];
  base: Variant;
  bestId: string | null;
}) {
  const min = Math.min(...variants.map((v) => v.onTimePct));
  const lo = Math.max(0, Math.min(60, Math.floor((min - 5) / 10) * 10));
  const pos = (pct: number) => `${Math.max(0, Math.min(100, ((pct - lo) / (100 - lo)) * 100))}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(lo + ((100 - lo) * i) / 4));
  const perDot = Math.max(
    10,
    Math.ceil(Math.max(...variants.map((v) => v.minutesAtLimit)) / 120) * 10,
  );
  return (
    <>
      <div className="aec-runway" role="list">
        <div className="aec-runway__scale" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: pos(t) }}>
              {t} %
            </span>
          ))}
        </div>
        {variants.map((v, i) => (
          <div
            key={v.id}
            className="aec-runway__row"
            role="listitem"
            data-best={v.id === bestId ? "" : undefined}
            style={{ "--i": i } as React.CSSProperties}
            aria-label={`${v.name}: ${dec1(v.onTimePct)} Prozent pünktlich, ${v.minutesAtLimit} Minuten Anschluss voll ausgelastet, höchster Bedarf ${powerText(v.peakKw)}`}
          >
            <span className="aec-runway__name">{v.name}</span>
            <span className="aec-runway__track" aria-hidden="true">
              <span className="aec-runway__base" style={{ left: pos(base.onTimePct) }} />
              <span className="aec-runway__fill" style={{ width: pos(v.onTimePct) }} />
              <span className="aec-runway__val" style={{ left: pos(v.onTimePct) }}>
                {dec1(v.onTimePct)} %
              </span>
            </span>
            <span
              className="aec-runway__limit"
              aria-hidden="true"
              title={`${v.minutesAtLimit} Minuten Anschluss voll ausgelastet`}
            >
              {Array.from(
                { length: Math.min(12, Math.ceil(v.minutesAtLimit / perDot)) },
                (_, j) => (
                  <i key={j} />
                ),
              )}
              <em>{int(v.minutesAtLimit)} min</em>
            </span>
          </div>
        ))}
      </div>
      <p className="aec-muted aec-runway__legend">
        <i className="aec-legend__basis" aria-hidden="true" /> heutiger Stand ·{" "}
        <i className="aec-legend__stopdots" aria-hidden="true" /> ein Punkt steht für {perDot}{" "}
        Minuten voll ausgelasteten Anschluss
      </p>
    </>
  );
}

const BOTTLENECK: Record<string, string> = {
  none: "nichts",
  energy: "Strom",
  resource: "Fahrzeuge",
  energy_and_resource: "Strom und Fahrzeuge",
};

export default function VariantenView({ project, board, reloadBoard, route }: ViewProps) {
  const running = board.run?.status === "queued" || board.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reloadBoard(), 1500);
    return () => clearInterval(timer);
  }, [running, reloadBoard]);

  const api = board.source === "api";
  // Beispieldaten nur ohne gerechnete Projektvarianten, dann ueberall markiert.
  const computed = api && board.variants.length > 0;
  const variants = computed ? board.variants : api ? sampleVariants() : board.variants;
  const sample = !computed;
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  const showResults = Boolean(base) && !running;
  const bestId = computed ? (board.answer?.bestId ?? null) : (bestVariant(variants)?.id ?? null);
  const best = variants.find((v) => v.id === bestId) ?? base;

  // Antwortsatz: aus der API (Backend entscheidet inkl. Epsilon), sonst Beispiel.
  let answer: string;
  let lead: string;
  if (computed && board.answer && !running) {
    answer = board.answer.headline;
    lead = board.answer.details.join(" ");
  } else if (api && running) {
    answer = "Die Lösungen werden gerade gerechnet.";
    lead = `${board.run!.done} von ${board.run!.total} Berechnungen fertig.`;
  } else if (api) {
    answer = board.definitions.length
      ? "Ausgewählt, aber noch nicht gerechnet."
      : "Noch ist keine Lösung ausgewählt.";
    lead = "Vorschläge antippen oder eine eigene Lösung zusammenstellen, dann durchrechnen.";
  } else {
    const full = variantsAnswer(variants);
    const cut = full.indexOf(". ") >= 0 ? full.indexOf(". ") + 1 : full.length;
    answer = full.slice(0, cut);
    lead = full.slice(cut).trim();
  }
  if (computed)
    lead = `${lead} Alle Lösungen wurden am selben Tag mit denselben Annahmen gerechnet.`;
  lead = lead.trim();

  const delta = best && base ? best.onTimePct - base.onTimePct : 0;
  const kpis =
    showResults && best && base && !(api && sample)
      ? [
          {
            value: dec1(best.onTimePct),
            unit: "%",
            label:
              best.id === base.id
                ? "der Abflüge pünktlich, heute"
                : `der Abflüge pünktlich mit „${best.name}“`,
            tone: "signal" as const,
          },
          {
            value: `${delta >= 0 ? "+" : "−"}${dec1(Math.abs(delta))}`,
            label: "Prozentpunkte gegenüber heute",
          },
          { value: int(best.minutesAtLimit), unit: "min", label: "Anschluss voll ausgelastet" },
          computed && best.missingKw != null
            ? {
                value: powerText(best.missingKw).split(" ")[0]!,
                unit: powerText(best.missingKw).split(" ")[1],
                label: "fehlen zum Laden in der Spitze",
              }
            : { value: dec1(best.gridEnergyMwh), unit: "MWh", label: "Strom aus dem Netz am Tag" },
        ]
      : [];

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Lösungen · Was hilft am meisten?"
        answer={answer}
        lead={lead}
        evidence={
          computed || running
            ? (best?.evidence ?? "assumption")
            : sample && !api
              ? "synthetic"
              : "assumption"
        }
        source={api ? "api" : "beispiel"}
        kpis={kpis}
      />

      {api ? (
        <Section title="Lösungen auswählen" kicker="Auswahl" id="var-edit">
          <Editor board={board} project={project} reload={reloadBoard} krise={route.krise} />
        </Section>
      ) : null}

      {showResults && base ? (
        <Section
          title={
            sample
              ? "So sieht das Ergebnis aus (Beispiel)"
              : "Wie viele Abflüge pünktlich fertig werden"
          }
          kicker="Im Vergleich"
          id="var-chart"
        >
          {sample ? (
            <p className="aec-muted aec-sample-note">
              <SourceTag source="beispiel" />
              {api ? " Ihre eigenen Zahlen erscheinen nach dem ersten Durchrechnen." : ""}
            </p>
          ) : null}
          <Runway variants={variants} base={base} bestId={bestId} />
        </Section>
      ) : null}

      {showResults && base && !(api && sample) ? (
        <Section title="Jede Lösung im Detail" kicker="Die Zahlen dahinter" id="var-cards">
          <ul className="aec-variants">
            {variants.map((v) => (
              <li key={v.id} data-best={v.id === bestId ? "" : undefined}>
                <span className="aec-variants__tag">
                  {v.id === bestId
                    ? "hilft am meisten"
                    : v.kind === "basis"
                      ? "heutiger Stand"
                      : "Lösung"}
                </span>
                <h3>{v.name}</h3>
                <dl>
                  <div>
                    <dt>pünktlich fertig</dt>
                    <dd>
                      {dec1(v.onTimePct)} %
                      {v.deltaOnTimePct != null && v.kind !== "basis" ? (
                        <small>
                          {" "}
                          ({v.deltaOnTimePct >= 0 ? "+" : "−"}
                          {dec1(Math.abs(v.deltaOnTimePct))} Prozentpunkte)
                        </small>
                      ) : null}
                    </dd>
                  </div>
                  {v.delayedDepartures != null ? (
                    <div>
                      <dt>nicht rechtzeitig fertig</dt>
                      <dd>
                        {int(v.delayedDepartures)} von {int(v.departuresTotal ?? 0)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Anschluss voll ausgelastet</dt>
                    <dd>{int(v.minutesAtLimit)}</dd>
                  </div>
                  <div>
                    <dt>höchster Strombedarf</dt>
                    <dd>{powerText(v.peakKw)}</dd>
                  </div>
                  {v.missingKw != null ? (
                    <div>
                      <dt>fehlen zum Laden in der Spitze</dt>
                      <dd>{powerText(v.missingKw)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Strom aus dem Netz am Tag</dt>
                    <dd>{dec1(v.gridEnergyMwh)} MWh</dd>
                  </div>
                  {v.bottleneck ? (
                    <div>
                      <dt>Was bremst</dt>
                      <dd>{BOTTLENECK[v.bottleneck] ?? v.bottleneck}</dd>
                    </div>
                  ) : null}
                  {v.fleetTotal ? (
                    <div>
                      <dt>Fahrzeuge</dt>
                      <dd>{int(v.fleetTotal)} Fahrzeuge</dd>
                    </div>
                  ) : null}
                  {v.backgroundUnservedKwh ? (
                    <div>
                      <dt>übriger Verbrauch nicht gedeckt</dt>
                      <dd>{int(v.backgroundUnservedKwh)} kWh</dd>
                    </div>
                  ) : null}
                  {v.stressOnTimePct != null ? (
                    <div>
                      <dt>
                        {board.run?.crisis ? `unter „${board.run.crisis.name}“` : "unter Stress"}
                      </dt>
                      <dd>{dec1(v.stressOnTimePct)} %</dd>
                    </div>
                  ) : null}
                </dl>
                <EvidenceBadge level={v.evidence} />
              </li>
            ))}
          </ul>
          <p className="aec-muted">
            {computed
              ? "„Rechnerisch geprüft“ heißt, die Berechnung ist vollständig, alle Lösungen hatten denselben Tag, keine Energie ging verloren und der übrige Verbrauch war gedeckt. "
              : ""}
            Wie robust eine Lösung ist, zeigen die Krisenfälle in der{" "}
            <Link to={{ page: "bibliothek" }}>Szenario-Bibliothek</Link>. Kosten zeigen wir erst,
            wenn Sie Preise freigeben.
          </p>
        </Section>
      ) : null}

      <Details summary="Belastungsproben und Abfertigung im Detail (für Fachleute)">
        <WerkstattLinks items={["robustheit", "simulation"]} base={route} />
      </Details>
    </>
  );
}
