import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FIELDS, DEFAULTS, PRESETS, number, time } from "./config";
import { request, telemetry, url } from "./api";
import { assertComparable, buildCompareHtml } from "./report";
import { chartTheme } from "../ui/chartTheme";
import type {
  Assumptions,
  ChartRow,
  Comparison,
  EnergyRecord,
  Reference,
  RunStatus,
} from "./types";
import "./MunichPilot.css";
import FlightPlanPanel from "./FlightPlanPanel";
import CoupledPanel from "./CoupledPanel";
import PilotStudio from "../pilot/PilotStudio";
import { flightDate } from "./flightplanTypes";
import type { FlightPlanSnapshot } from "./flightplanTypes";

const CACHE_KEY = `airport-munich-comparison:${url("")}`;
function previous(): Comparison | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null") as Comparison | null;
    return value &&
      value.runs.length === 2 &&
      value.runs.every((r) => /^[\w-]{3,64}$/.test(r.run_id))
      ? value
      : null;
  } catch {
    return null;
  }
}
const statusLabel = (status: RunStatus) =>
  ({
    queued: "Warteschlange",
    running: "Berechnung",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
  })[status.state];

function EvidenceCard({ record, label }: { record: EnergyRecord; label: string }) {
  const k = record.summary!.energy_kpis;
  const run = record.status.run_id;
  return (
    <article className={`muc-result ${label === "Buspriorität" ? "muc-result--priority" : ""}`}>
      <header>
        <h3>{label}</h3>
        <span className="muc-tag">SIL abgeschlossen</span>
      </header>
      <div className="muc-result__main">
        <strong>
          {k.bus_ready_count}
          <small> / {k.bus_session_count}</small>
        </strong>
        <span>Bus-Ladefristen erfüllt</span>
      </div>
      <dl className="muc-result__metrics">
        <div>
          <dt>Parkhaus-Ladefristen</dt>
          <dd>
            {k.parking_ready_count} / {k.parking_session_count}
          </dd>
        </div>
        <div>
          <dt>Netzspitze</dt>
          <dd>{number(k.grid_peak_kw)} kW</dd>
        </div>
        <div>
          <dt>Fehlende Ladeenergie</dt>
          <dd>{number(k.charging_unmet_kwh, 1)} kWh</dd>
        </div>
        <div>
          <dt>Grundlast unversorgt</dt>
          <dd>{number(k.background_unserved_kwh, 1)} kWh</dd>
        </div>
        <div>
          <dt>BHKW nicht absetzbar</dt>
          <dd>{number(k.chp_unabsorbed_kwh, 1)} kWh</dd>
        </div>
      </dl>
      <p className={record.status.pass_fail ? "muc-ok" : "muc-warn"}>
        Modellkriterien {record.status.pass_fail ? "erfüllt" : "nicht erfüllt"}. Kein
        Sicherheitsnachweis.
      </p>
      <div className="muc-downloads">
        <a href={url(`/runs/${run}/artifacts/record.json`)} target="_blank" rel="noreferrer">
          Run-Nachweis
        </a>
        <a href={url(`/runs/${run}/artifacts/report.pdf`)} target="_blank" rel="noreferrer">
          PDF
        </a>
        <a href={url(`/runs/${run}/artifacts/charging.csv`)}>Ladeaufträge CSV</a>
        <a href={url(`/runs/${run}/telemetry.csv`)}>Telemetrie CSV</a>
      </div>
      <code className="muc-run-id">{run}</code>
    </article>
  );
}

function PowerChart({
  rows,
  config,
  mode = "grid",
}: {
  rows: ChartRow[];
  config: Assumptions;
  mode?: "grid" | "charging" | "storage";
}) {
  const lines =
    mode === "grid"
      ? [
          ["baseline", "Netz / ungesteuert", chartTheme.series.baseline],
          ["priority", "Netz / Buspriorität", chartTheme.series.blue],
          ["pv_kw", "PV, beide Regeln", chartTheme.series.amber],
        ]
      : mode === "charging"
        ? [
            ["bus_kw", "Busdepot / Buspriorität", chartTheme.series.blue],
            ["parking_kw", "Parkhaus / Buspriorität", chartTheme.series.teal],
          ]
        : [["battery_soc_pct", "SOC / Buspriorität", chartTheme.series.amber]];
  return (
    <div
      className="muc-chart"
      role="img"
      aria-label={
        mode === "grid"
          ? "Netz- und PV-Leistung über 24 Modellstunden"
          : mode === "charging"
            ? "Ladeleistung der beiden Bereiche"
            : "Speicherzustand über 24 Modellstunden"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 4, right: 12, top: 12, bottom: 10 }}>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="minute"
            type="number"
            domain={[0, 1440]}
            ticks={[0, 360, 720, 1080, 1440]}
            tickFormatter={time}
            stroke={chartTheme.axis}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke={chartTheme.axis}
            width={58}
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => number(v)}
            unit={mode === "storage" ? "%" : ""}
            domain={mode === "storage" ? [0, 100] : [0, "auto"]}
          />
          <Tooltip
            labelFormatter={(v) => time(Number(v))}
            formatter={(v: number, name: string) => [
              `${number(v, 1)} ${mode === "storage" ? "%" : "kW"}`,
              name,
            ]}
            contentStyle={chartTheme.tooltip}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          {mode === "grid" && (
            <ReferenceLine
              y={config.grid_import_limit_kw}
              stroke={chartTheme.series.amber}
              strokeDasharray="5 4"
              label={{
                value: "Importgrenze",
                fill: chartTheme.series.amber,
                fontSize: 12,
                position: "insideTopRight",
              }}
            />
          )}
          {lines.map(([key, name, color]) => (
            <Line
              key={key}
              dataKey={key}
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MunichPilot() {
  const [pilotOpen, setPilotOpen] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [config, setConfig] = useState<Assumptions>(DEFAULTS);
  const [preset, setPreset] = useState("reference");
  const [seed, setSeed] = useState(42);
  const [comparison, setComparison] = useState<Comparison | null>(previous);
  const [statuses, setStatuses] = useState<RunStatus[]>([]);
  const [records, setRecords] = useState<EnergyRecord[]>([]);
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [error, setError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [starting, setStarting] = useState(false);
  const [settled, setSettled] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sector, setSector] = useState("bus");
  const [onlyMissed, setOnlyMissed] = useState(false);
  const [flightPlan, setFlightPlan] = useState<FlightPlanSnapshot | null>(null);
  const [flightPlanLoading, setFlightPlanLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void request<Reference>("/munich/reference", { signal: controller.signal })
      .then((data) => {
        setReference(data);
        setReferenceError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setReferenceError(e.message);
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!comparison) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setSettled(false);
    setError("");
    async function poll() {
      try {
        const next: RunStatus[] = [];
        for (const run of comparison!.runs)
          next.push(await request<RunStatus>(`/runs/${run.run_id}`, { signal: controller.signal }));
        if (controller.signal.aborted) return;
        setStatuses(next);
        const failed = next.find((run) => run.state === "failed");
        if (failed)
          throw new Error(`Run ${failed.run_id}: ${failed.error ?? "Berechnung fehlgeschlagen"}`);
        if (next.every((run) => run.state === "completed")) {
          const results: EnergyRecord[] = [];
          for (const run of next)
            results.push(
              await request<EnergyRecord>(`/runs/${run.run_id}/record`, {
                signal: controller.signal,
              }),
            );
          assertComparable(results[0]!, results[1]!);
          const frozenPlan = results[0]!.model_pack_snapshot.calibration_meta.flight_plan_snapshot;
          if ((comparison!.flight_plan_snapshot_id ?? null) !== (frozenPlan?.snapshot_id ?? null))
            throw new Error("Flugplan-Kontext gehört nicht zum angeforderten Vergleich.");
          if (
            results[0]!.summary!.energy_world_hash !== comparison!.world_hash ||
            results[0]!.scenario_snapshot.metadata.comparison_id !== comparison!.comparison_id
          ) {
            throw new Error("Nachweise gehören nicht zum angeforderten Vergleich.");
          }
          const baseline = await telemetry(next[0]!.run_id, controller.signal);
          const priority = await telemetry(next[1]!.run_id, controller.signal);
          if (controller.signal.aborted) return;
          const baselineByMinute = new Map(baseline.map((r) => [r.minute, r.grid_import_kw ?? 0]));
          setRows(
            priority.map((r) => ({
              ...r,
              baseline: baselineByMinute.get(r.minute) ?? 0,
              priority: r.grid_import_kw ?? 0,
            })),
          );
          setRecords(results);
          setSettled(true);
        } else
          timer = setTimeout(() => {
            void poll();
          }, 800);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Verbindung unterbrochen");
          setSettled(true);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [comparison, retry]);

  const busy = starting || flightPlanLoading || Boolean(comparison && !settled && !error);
  const base = records[0];
  const priority = records[1];
  const frozen = base?.model_pack_snapshot.calibration_meta.munich_assumptions;
  const viewConfig = frozen ?? config;
  const viewDossier =
    base?.model_pack_snapshot.calibration_meta.reference_dossier ?? reference?.dossier;
  const busDelta =
    base?.summary && priority?.summary
      ? priority.summary.energy_kpis.bus_ready_count - base.summary.energy_kpis.bus_ready_count
      : 0;
  const evidence = useMemo(() => {
    if (!base?.summary || !priority?.summary) return [];
    const originals = new Map(base.summary.energy_sessions.map((session) => [session.id, session]));
    return priority.summary.energy_sessions
      .filter(
        (s) =>
          s.sector === sector &&
          (!onlyMissed || !s.deadline_met || !originals.get(s.id)?.deadline_met),
      )
      .map((session) => ({ ...session, baseline: originals.get(session.id) }));
  }, [base, priority, sector, onlyMissed]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const result = await request<Comparison>("/munich/comparisons", {
        method: "POST",
        body: JSON.stringify({
          seed,
          assumptions: config,
          ...(flightPlan ? { flight_plan_snapshot_id: flightPlan.snapshot_id } : {}),
        }),
      });
      setRecords([]);
      setRows([]);
      setStatuses(result.runs);
      setSettled(false);
      setComparison(result);
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(result));
      } catch {
        /* Backend records remain durable even without browser storage. */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start fehlgeschlagen");
    } finally {
      setStarting(false);
    }
  }

  function downloadReport() {
    if (!base || !priority) return;
    const blob = new Blob([buildCompareHtml(base, priority)], { type: "text/html;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `muenchen-vergleich-${comparison?.comparison_id}.html`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function field(key: keyof Assumptions) {
    const definition = FIELDS.find((f) => f.key === key)!;
    return (
      <label className="muc-field" key={key}>
        {definition.label}
        <span className="muc-field__input">
          <input
            type="number"
            value={config[key]}
            min={definition.min}
            max={definition.max}
            step={definition.step}
            disabled={busy}
            required
            onChange={(event) => {
              setPreset("custom");
              setConfig({ ...config, [key]: Number(event.target.value) });
            }}
          />
          <small>{definition.unit}</small>
        </span>
      </label>
    );
  }

  const flightPlanPanel: ReactNode = (
    <FlightPlanPanel
      selected={flightPlan}
      onSelect={setFlightPlan}
      onBusyChange={setFlightPlanLoading}
      disabled={busy}
    />
  );

  return (
    <main className="muc-pilot">
      <details
        className="pilot-workflow-entry"
        onToggle={(event) => setPilotOpen(event.currentTarget.open)}
      >
        <summary>
          Pilotprojekt &amp; Messdaten{" "}
          <span>Entscheidungsfrage · Modellabgleich · TestingLab-Paket</span>
        </summary>
        {pilotOpen && <PilotStudio />}
      </details>
      <CoupledPanel
        plan={flightPlan}
        loadingPlan={flightPlanLoading}
        flightPlanPanel={flightPlanPanel}
      />
      <section aria-label="Energie-v1 / statisch">
        <h2 className="muc-static-heading">Energie-v1 / statisch</h2>
        <aside className="muc-boundary">
          <strong>Referenzpilot, kein Betriebsnachweis.</strong> Keine reale Anlagensteuerung,
          CO₂-/Kostenoptimierung oder Netzfreigabe. Die Original-Airport-Fälle und FlexLab bleiben
          separate Arbeitsbereiche.
        </aside>
        <div className="muc-layout">
          <aside className="muc-command">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <div className="muc-section-title">
                <h2 id="muc-energy-v1">Energie-v1 festlegen</h2>
                <span>Statische Ladefristen</span>
              </div>
              <label className="muc-field">
                Synthetischer Testfall
                <select
                  value={preset}
                  disabled={busy}
                  onChange={(e) => {
                    const item = PRESETS.find((p) => p.id === e.target.value);
                    if (item) {
                      setPreset(item.id);
                      setConfig({ ...(reference?.defaults ?? DEFAULTS), ...item.values });
                    }
                  }}
                >
                  {PRESETS.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="custom" disabled>
                    Eigene Annahmen
                  </option>
                </select>
              </label>
              <p className="muc-small">
                {PRESETS.find((p) => p.id === preset)?.note ??
                  "Eigene hypothetische Werte. Keine gemessenen Anlagenparameter."}
              </p>
              <div className="muc-assumption-label">Alle folgenden Werte sind Annahmen</div>
              {FIELDS.filter((f) => !f.advanced).map((f) => field(f.key))}
              <details className="muc-details">
                <summary>Ladeaufträge &amp; Wirkungsgrade</summary>
                {FIELDS.filter((f) => f.advanced).map((f) => field(f.key))}
              </details>
              <label className="muc-field">
                Reproduzierbarer Seed
                <input
                  type="number"
                  min={0}
                  max={2147483647}
                  step={1}
                  value={seed}
                  disabled={busy}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </label>
              <button className="muc-primary" disabled={busy || !reference}>
                {flightPlanLoading
                  ? "Flugplan abwarten…"
                  : busy
                    ? "Vergleich läuft…"
                    : "Regeln vergleichen"}
              </button>
              <p className="muc-small">
                Zwei eingefrorene Runs, identische Eingaben. Backend berechnet seriell und setzt
                nach Neustart sauber neu an.
              </p>
            </form>
            {referenceError && (
              <div role="alert" className="muc-error">
                API nicht erreichbar: {referenceError}
                <button onClick={() => setRetry((v) => v + 1)}>Verbindung erneut prüfen</button>
              </div>
            )}
            {error && (
              <div role="alert" className="muc-error">
                {error}
                {comparison && (
                  <button onClick={() => setRetry((v) => v + 1)}>Nachweise erneut laden</button>
                )}
              </div>
            )}
            {statuses.length > 0 && (
              <div className="muc-status" role="status">
                {statuses.map((s, i) => (
                  <div key={s.run_id}>
                    <span>
                      {i === 0 ? "Ungesteuert" : "Buspriorität"}: {statusLabel(s)}
                    </span>
                    <progress max={100} value={s.progress} />
                    <code>{s.run_id}</code>
                  </div>
                ))}
              </div>
            )}
          </aside>
          <div className="muc-content">
            {base && (
              <aside className="muc-frozen-notice">
                <strong>Ergebnisse des gespeicherten Versuchs / Seed {base.request.seed}.</strong>
                Die Eingaben links gelten erst für den nächsten Vergleich, nicht für die angezeigten
                Ergebnisse.
                {base.model_pack_snapshot.calibration_meta.flight_plan_snapshot && (
                  <p>
                    Eingefrorener Flugplan-Kontext:{" "}
                    {flightDate(
                      base.model_pack_snapshot.calibration_meta.flight_plan_snapshot.service_date,
                    )}
                    . Noch keine Kopplung an Fahrzeugaufträge.
                  </p>
                )}
              </aside>
            )}
            <section className="muc-network">
              <div className="muc-section-title">
                <h2>Versorgung &amp; Ladebereiche</h2>
                <span>Schema / kein FMG-Netzplan</span>
              </div>
              <div className="muc-sources">
                <div className="muc-node">
                  <span>Netzanschluss</span>
                  <strong>{number(viewConfig.grid_import_limit_kw / 1000, 2)} MW</strong>
                  <small>Importgrenze, angenommen</small>
                </div>
                <div className="muc-node muc-node--solar">
                  <span>Campus-PV / Stand 2025</span>
                  <strong>7 MWp</strong>
                  <small>inkl. 3 MWp P43/P44, belegt</small>
                </div>
                <div className="muc-node">
                  <span>BHKW / exogener Fahrplan</span>
                  <strong>{number(viewConfig.chp_output_kw / 1000, 2)} MW</strong>
                  <small>konstant, angenommen</small>
                </div>
              </div>
              <div className="muc-busbar">
                <span>Vereinfachte Wirkleistungsbilanz</span>
                <small>20-kV-Referenz historisch (2014) / keine reale Topologie</small>
              </div>
              <div className="muc-loads">
                <div className="muc-node">
                  <span>Campus-Grundlast</span>
                  <strong>{number(viewConfig.background_load_kw / 1000, 1)} MW</strong>
                  <small>synthetisches Tagesprofil</small>
                </div>
                <div className="muc-node muc-node--charging">
                  <span>P43/P44 / Parkhaus</span>
                  <strong>275 Ladepunkte</strong>
                  <small>P44: öffentlich belegt, 2025</small>
                  <small>
                    {viewConfig.parking_sessions} Aufträge;{" "}
                    {number(viewConfig.parking_transformer_kva)} kVA angenommen
                  </small>
                </div>
                <div className="muc-node muc-node--charging">
                  <span>Busdepot</span>
                  <strong>50 Ladepunkte</strong>
                  <small>öffentlich belegt, 2025</small>
                  <small>
                    {viewConfig.bus_sessions} Aufträge; {number(viewConfig.bus_transformer_kva)} kVA
                    angenommen
                  </small>
                </div>
              </div>
              <div className="muc-storage">
                <span>Hypothetischer Speicher</span>
                <strong>
                  {viewConfig.battery_capacity_kwh
                    ? `${number(viewConfig.battery_capacity_kwh)} kWh / ${number(viewConfig.battery_power_kw)} kW`
                    : "Nicht aktiviert"}
                </strong>
                <small>Kein behaupteter FMG-Bestand. Kein elektrischer Schwarzstart.</small>
              </div>
            </section>

            <section className="muc-compare">
              <div className="muc-section-title">
                <h2>Regeln vergleichen</h2>
                <span>Identische Welt / kein globales Optimum</span>
              </div>
              {base?.summary && priority?.summary ? (
                <>
                  <div className={`muc-delta ${busDelta < 0 ? "muc-warn" : ""}`}>
                    <strong>
                      {busDelta === 0
                        ? "Kein Vorteil bei Bus-Ladefristen"
                        : `${busDelta > 0 ? "+" : ""}${busDelta} Bus-Ladefristen`}
                    </strong>
                    <span>
                      Buspriorität gegenüber ungesteuertem Laden. Parkhaus und Grundlast mitprüfen.
                    </span>
                  </div>
                  <div className="muc-result-grid">
                    <EvidenceCard record={base} label="Ungesteuert" />
                    <EvidenceCard record={priority} label="Buspriorität" />
                  </div>
                  <div className="muc-report-action">
                    <button onClick={downloadReport}>Vergleichsreport herunterladen</button>
                    <span>HTML mit Annahmen, Quellen, Deltas und Run-IDs</span>
                  </div>
                  <details className="muc-details">
                    <summary>Eingefrorene Versuchseingaben &amp; Audit</summary>
                    <p className="muc-small">
                      Angezeigt wird der abgeschlossene Versuch, nicht die aktuell bearbeiteten
                      Werte links. Seed: {base.request.seed}.
                    </p>
                    <dl className="muc-frozen">
                      {FIELDS.map((f) => (
                        <div key={f.key}>
                          <dt>{f.label}</dt>
                          <dd>
                            {number(frozen![f.key], 2)} {f.unit}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="muc-small">Gemeinsamer Welt-Hash</p>
                    <code className="muc-hash">{base.summary.energy_world_hash}</code>
                    {[base, priority].map((r) => (
                      <p key={r.status.run_id} className="muc-small">
                        Audit {r.status.run_id}
                        <code className="muc-hash">{r.summary!.audit_fingerprint_sha256}</code>
                      </p>
                    ))}
                  </details>
                </>
              ) : (
                <div className="muc-empty">
                  <strong>Was bleibt einsatzbereit, wenn Leistung knapp wird?</strong>
                  <p>
                    Vergleiche sofortiges Laden mit „Busse zuerst, dann früheste Frist“. Beide
                    Regeln erhalten dieselben Aufträge und dieselben Grenzen.
                  </p>
                  <p>
                    Wähle „Anschluss-Engpass“ für einen synthetischen Stresstest. Der Referenztag
                    kann ohne Vorteil enden.
                  </p>
                </div>
              )}
            </section>

            {base?.summary && priority?.summary && (
              <>
                <section className="muc-panel">
                  <div className="muc-section-title">
                    <h2>Netzbezug &amp; Solarprofil</h2>
                    <span>kW / Modellzeit</span>
                  </div>
                  <PowerChart rows={rows} config={viewConfig} />
                  <p className="muc-small">
                    PV / Buspriorität: {number(priority.summary.energy_kpis.pv_generated_kwh)} kWh
                    erzeugt, {number(priority.summary.energy_kpis.pv_used_kwh)} kWh genutzt inkl.
                    Speicherladung; {number(priority.summary.energy_kpis.pv_curtailed_kwh)} kWh
                    abgeregelt.
                  </p>
                  <p className="muc-small">
                    Eine niedrigere Netzspitze allein ist kein besserer Test: fehlende Energie und
                    Ladefristen müssen mitbewertet werden. PV-Profil ist keine Wetterprognose.
                  </p>
                </section>
                <div className="muc-two-panels">
                  <section className="muc-panel">
                    <h2>Ladeleistung / Buspriorität</h2>
                    <PowerChart rows={rows} config={viewConfig} mode="charging" />
                  </section>
                  <section className="muc-panel">
                    <h2>
                      {viewConfig.battery_capacity_kwh
                        ? "Speicher / Buspriorität"
                        : "PV-Energiebilanz / Buspriorität"}
                    </h2>
                    {viewConfig.battery_capacity_kwh ? (
                      <PowerChart rows={rows} config={viewConfig} mode="storage" />
                    ) : (
                      <dl className="muc-energy-list">
                        <div>
                          <dt>Erzeugt</dt>
                          <dd>{number(priority.summary.energy_kpis.pv_generated_kwh)} kWh</dd>
                        </div>
                        <div>
                          <dt>Genutzt inkl. Speicherladung</dt>
                          <dd>{number(priority.summary.energy_kpis.pv_used_kwh)} kWh</dd>
                        </div>
                        <div>
                          <dt>Exportiert</dt>
                          <dd>{number(priority.summary.energy_kpis.pv_export_kwh)} kWh</dd>
                        </div>
                        <div>
                          <dt>Abgeregelt</dt>
                          <dd>{number(priority.summary.energy_kpis.pv_curtailed_kwh)} kWh</dd>
                        </div>
                      </dl>
                    )}
                    <p className="muc-small">
                      BHKW bilanzmäßig zuerst; PV für Restlast/Speicher. Keine Grünstromquote;
                      Herkunft der Speicher-Anfangsenergie unbekannt.
                    </p>
                  </section>
                </div>
                <section className="muc-panel">
                  <div className="muc-section-title">
                    <h2>Ladefristen im Einzelnachweis</h2>
                    <span>Synthetische Aufträge, keine Flug-OTP</span>
                  </div>
                  <div className="muc-table-controls">
                    <label>
                      Bereich
                      <select value={sector} onChange={(e) => setSector(e.target.value)}>
                        <option value="bus">Busdepot</option>
                        <option value="parking">Parkhaus</option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={onlyMissed}
                        onChange={(e) => setOnlyMissed(e.target.checked)}
                      />{" "}
                      Nur verletzte Fristen
                    </label>
                    <span>{evidence.length} Aufträge</span>
                  </div>
                  <div className="muc-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Auftrag</th>
                          <th>Ladefenster</th>
                          <th>Bedarf</th>
                          <th>Ungesteuert</th>
                          <th>Buspriorität</th>
                          <th>Fehlend / Priorität</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evidence.slice(0, 50).map((s) => (
                          <tr key={s.id}>
                            <td>
                              <code>{s.id}</code>
                            </td>
                            <td>
                              {time(s.arrival_min)}–{time(s.deadline_min)}
                            </td>
                            <td>{number(s.required_energy_kwh)} kWh</td>
                            <td className={s.baseline?.deadline_met ? "muc-ok" : "muc-warn"}>
                              {s.baseline?.deadline_met ? "erfüllt" : "verletzt"}
                            </td>
                            <td className={s.deadline_met ? "muc-ok" : "muc-warn"}>
                              {s.deadline_met ? "erfüllt" : "verletzt"}
                            </td>
                            <td>{number(s.unmet_kwh, 1)} kWh</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muc-small">
                    Max. 50 Zeilen angezeigt. Alle Aufträge und Batterie-Energiestände im CSV.
                    Bus-Frist bedeutet geladen, nicht abgeschlossene reale Busmission.
                  </p>
                </section>
              </>
            )}

            <section className="muc-panel muc-method">
              <div className="muc-section-title">
                <h2>Was ist belegt, was fehlt?</h2>
                <span>Quellenstand / Pilotgrenze</span>
              </div>
              <p>
                <strong>München besitzt bereits einen Energiezwilling.</strong> Dieser Pilot ersetzt
                ihn nicht. Der mögliche Mehrwert ist ein abgestimmter Komponenten-/Systemtest im
                TestingLab, nicht „der erste Flughafen-Zwilling“.
              </p>
              <div className="muc-method-grid">
                <div>
                  <h3>Öffentlich belegt</h3>
                  <ul>
                    <li>275 Ladepunkte P44; 50 im Busdepot (2025)</li>
                    <li>7 MWp Campus-PV, davon 3 MWp P43/P44 (2025)</li>
                    <li>20-kV-Referenz in historischen TAB (2014)</li>
                  </ul>
                  <p className="muc-small">
                    Ziele und angekündigte Projekte sind nicht installierter Bestand. Aktuelle
                    Anschlussbedingungen mit FMG bestätigen.
                  </p>
                </div>
                <div>
                  <h3>Für echte Aussagen fehlen</h3>
                  <ul>
                    <li>Netz-/Trafogrenzen und reale Messprofile</li>
                    <li>Lade-Sessions, Busumlauf und SOC</li>
                    <li>BHKW-Wärme-/Kältefahrplan, Speichergröße</li>
                    <li>Abdeckung des bestehenden Zwillings</li>
                  </ul>
                </div>
              </div>
              <details className="muc-details">
                <summary>Modellregeln &amp; Grenzen</summary>
                <p>
                  5-Minuten-Energiebilanz statt AC-Netzrechnung. Ladeabgänge: kVA × angenommener
                  Leistungsfaktor; keine Spannungen, Leitungen, Verluste im Netz oder Schutztechnik.
                  BHKW bleibt exogen. Nicht absetzbare BHKW-Erzeugung und nicht versorgte Grundlast
                  verletzen die Modellkriterien.
                </p>
                <p>
                  Unkontrolliert bedeutet sofortige Ladeanforderung mit proportionaler Begrenzung,
                  nicht verbotene Netzüberlastung. Buspriorität verteilt zuerst an Busse, dann nach
                  frühester Frist. Der Speicher lädt nur bei Erzeugungsüberschuss und entlädt zur
                  Deckung oberhalb der Importgrenze. Lade- und Speicherverluste sind enthalten.
                </p>
                <p>
                  Kein elektrischer Schwarzstart, keine Wärmeoptimierung, keine empirische
                  Validierung, keine Partnerschaft. Für echte Daten: zuerst Versuchsvorschrift,
                  Grenzen und Vergleichsregel mit FMG abstimmen.
                </p>
              </details>
              {viewDossier && (
                <details className="muc-details">
                  <summary>Primärquellen / recherchiert {viewDossier.researched_at}</summary>
                  <ul className="muc-source-links">
                    {viewDossier.sources.map((s) => (
                      <li key={s.id}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                        <small>{s.content_period}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
