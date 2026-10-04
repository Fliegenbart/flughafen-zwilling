import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { request, url } from "./api";
import { number } from "./config";
import { flightDate } from "./flightplanTypes";
import type { FlightPlanSnapshot } from "./flightplanTypes";
import type { RunStatus } from "./types";
import type {
  CoupledComparison,
  CoupledConfig,
  CoupledEvidence,
  CoupledRecord,
} from "./coupledTypes";
import { buildCoupledHtml, coupledPair, FLEET_LABELS, modelTime } from "./coupledReport";
import CoupledControls from "./CoupledControls";
import { Delta, CoupledChart } from "./CoupledViews";
import CoupledCompare from "./CoupledCompare";
import SystemExplorer from "./SystemExplorer";
import RobustnessPanel from "./RobustnessPanel";
import CostWorksheet from "../pilot/CostWorksheet";
import { StudioHeader, StudioWorkflowNav } from "../ui/StudioHeader";
import "./CoupledPanel.css";

const CACHE = `airport-coupled-v1:${url("")}`;
function cached(): CoupledComparison | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE) ?? "null") as CoupledComparison | null;
    return value?.engine_version === "airport_coupled_v1" &&
      /^[a-f0-9]{64}$/.test(value.world_hash) &&
      value.runs.length === 2 &&
      value.runs.every((r) => /^[a-f0-9]{32}$/.test(r.run_id))
      ? value
      : null;
  } catch {
    return null;
  }
}
export default function CoupledPanel({
  plan,
  loadingPlan = false,
  pollMs = 1000,
  flightPlanPanel,
}: {
  plan: FlightPlanSnapshot | null;
  loadingPlan?: boolean;
  pollMs?: number;
  flightPlanPanel?: ReactNode;
}) {
  const [config, setConfig] = useState<CoupledConfig | null>(null);
  const [seed, setSeed] = useState(42);
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CoupledComparison | null>(cached);
  const [statuses, setStatuses] = useState<RunStatus[]>([]);
  const [records, setRecords] = useState<CoupledRecord[]>([]);
  const [evidence, setEvidence] = useState<CoupledEvidence[]>([]);
  const [reportsHashed, setReportsHashed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<"uncontrolled" | "mission_priority">(
    "mission_priority",
  );
  const startAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request<{ defaults: CoupledConfig }>("/munich/coupled-reference", { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setConfig(r.defaults);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setReferenceError(e.message);
      });
    return () => {
      controller.abort();
      startAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!comparison) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = [];
        for (const run of comparison!.runs)
          next.push(await request<RunStatus>(`/runs/${run.run_id}`, { signal: controller.signal }));
        if (controller.signal.aborted) return;
        setStatuses(next);
        const failed = next.find((r) => r.state === "failed");
        if (failed)
          throw new Error(
            `Run ${failed.run_id} fehlgeschlagen: ${failed.error ?? "siehe Run-Nachweis"}`,
          );
        if (next.every((r) => r.state === "completed")) {
          const loaded: CoupledRecord[] = [],
            data: CoupledEvidence[] = [];
          for (const run of next) {
            loaded.push(
              await request<CoupledRecord>(`/runs/${run.run_id}/record`, {
                signal: controller.signal,
              }),
            );
            data.push(
              await request<CoupledEvidence>(
                `/runs/${run.run_id}/artifacts/coupled-evidence.json`,
                { signal: controller.signal },
                30000,
              ),
            );
          }
          coupledPair(loaded, comparison!.world_hash);
          const auditScopes: string[] = [];
          for (const run of next) {
            const safety = await request<{
              audit: {
                fingerprint_match: boolean;
                artifact_hashes_match: boolean;
                report_consistent_match: boolean;
                result_audit_scope: string;
              };
            }>(`/runs/${run.run_id}/safety`, { signal: controller.signal });
            if (
              !safety.audit.fingerprint_match ||
              !safety.audit.artifact_hashes_match ||
              !safety.audit.report_consistent_match ||
              !["data_and_reports_v2", "data_and_report_consistency_v1"].includes(
                safety.audit.result_audit_scope,
              )
            )
              throw new Error(
                `Integritätsprüfung fehlgeschlagen für Run ${run.run_id}. Keine Vergleichsfreigabe.`,
              );
            auditScopes.push(safety.audit.result_audit_scope);
          }
          if (
            data.some(
              (d, i) =>
                d.world_hash !== comparison!.world_hash ||
                d.policy !== loaded[i]!.model_pack_snapshot.parameter_set.policy ||
                d.source_plan_sha256 !==
                  loaded[i]!.model_pack_snapshot.calibration_meta.flight_plan_snapshot
                    .content_sha256,
            )
          )
            throw new Error("Artefakt gehört nicht zur eingefrorenen Vergleichswelt.");
          if (controller.signal.aborted) return;
          setRecords(loaded);
          setEvidence(data);
          setReportsHashed(auditScopes.every((scope) => scope === "data_and_reports_v2"));
          setError("");
        } else timer = setTimeout(poll, pollMs);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Vergleich nicht verfügbar");
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [comparison, pollMs, retry]);
  const busy = starting || Boolean(comparison && !records.length && !error);
  const numbersComplete = Boolean(
    config &&
    Number.isFinite(seed) &&
    Object.values(config.power).every(Number.isFinite) &&
    config.fleets.every((f) =>
      Object.entries(f).every(([key, value]) => key === "kind" || Number.isFinite(value)),
    ) &&
    Number.isFinite(config.warmup_min) &&
    Number.isFinite(config.drain_min) &&
    config.stress_events.every(
      (e) =>
        Number.isFinite(e.start_min) &&
        Number.isFinite(e.end_min) &&
        Number.isFinite(e.offline_chargers) &&
        (e.grid_import_limit_kw === null || Number.isFinite(e.grid_import_limit_kw)),
    ),
  );
  const sharedAccepted = !plan?.possible_shared_flight_groups || ackFor === plan.snapshot_id;
  async function start() {
    if (!plan || !config || !sharedAccepted || !numbersComplete) return;
    const controller = new AbortController();
    startAbort.current = controller;
    setStarting(true);
    setError("");
    setComparison(null);
    setRecords([]);
    setEvidence([]);
    setReportsHashed(false);
    setStatuses([]);
    try {
      const result = await request<CoupledComparison>(
        "/munich/coupled-comparisons",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            flight_plan_snapshot_id: plan.snapshot_id,
            seed,
            config: {
              ...config,
              shared_group_policy: plan.possible_shared_flight_groups
                ? "independent_entries_assumption"
                : "reject_unresolved",
            },
          }),
        },
        30000,
      );
      if (
        result.engine_version !== "airport_coupled_v1" ||
        result.flight_plan_snapshot_id !== plan.snapshot_id ||
        result.runs.length !== 2
      )
        throw new Error("Unpassender Kopplungsvergleich vom Backend.");
      if (controller.signal.aborted) return;
      setComparison(result);
      setStatuses(result.runs);
      try {
        localStorage.setItem(CACHE, JSON.stringify(result));
      } catch {
        /* Runs remain durable in backend storage. */
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Start fehlgeschlagen");
    } finally {
      if (!controller.signal.aborted) setStarting(false);
    }
  }
  const pair = useMemo(
    () => (records.length && comparison ? coupledPair(records, comparison.world_hash) : null),
    [records, comparison],
  );
  const shown = evidence.find((e) => e.policy === selectedPolicy);
  const filtered = (shown?.missions ?? [])
    .filter(
      (m) =>
        (!lateOnly || !m.deadline_met) &&
        `${m.flight_number} ${m.vehicle_id ?? ""} ${FLEET_LABELS[m.kind]}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .slice(0, 100);
  const chart = useMemo(() => {
    const base = evidence.find((e) => e.policy === "uncontrolled"),
      priority = evidence.find((e) => e.policy === "mission_priority");
    const baseMap = new Map(base?.series.map((r) => [r.minute, r]));
    return (priority?.series ?? [])
      .filter(
        (r) =>
          priority && ((r.minute - priority.start_min) % 5 === 0 || r.minute === priority.end_min),
      )
      .map((r) => ({
        ...r,
        baseline_grid: baseMap.get(r.minute)?.grid_import_kw,
        baseline_soc: baseMap.get(r.minute)?.fleet_soc_avg_pct,
        baseline_queue: baseMap.get(r.minute)?.mission_queue,
      }));
  }, [evidence]);
  function exportHtml() {
    if (!comparison) return;
    const objectUrl = URL.createObjectURL(
      new Blob([buildCoupledHtml(records, comparison.world_hash)], {
        type: "text/html;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `airport-coupled-${comparison.comparison_id}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
  return (
    <section className="muc-panel muc-coupled" aria-labelledby="coupled-title">
      <StudioHeader
        title="Flugplan, Flotte & Energie"
        headingId="coupled-title"
        location="München / Systemtest"
        context={
          <>
            <span>Flughafen München</span> ·{" "}
            {plan ? flightDate(plan.service_date) : "Kein Flugplantag"} · Seed {seed} · Manueller
            Flugplan
          </>
        }
        warning="Nicht kalibriert. Keine FMG-Betriebsdaten. Modellierte Aufgabenbereitschaft, keine reale Flug-OTP."
        actions={
          <>
            <button
              type="button"
              aria-label="Gekoppelten HTML-Bericht"
              onClick={exportHtml}
              disabled={!pair || Boolean(error)}
            >
              Bericht
            </button>
            <button
              type="button"
              id="coupled-start"
              className="studio-primary"
              aria-label="Gekoppelten Vergleich starten"
              disabled={
                !plan || !config || !sharedAccepted || !numbersComplete || busy || loadingPlan
              }
              onClick={() => void start()}
            >
              {starting ? "Vergleich wird angelegt…" : "Vergleich starten"}
            </button>
          </>
        }
      />
      <StudioWorkflowNav current={pair && !error ? "vergleich" : plan ? "energy" : "flightplan"} />
      <details className="studio-coupled-context">
        <summary>Methodik &amp; Modellgrenzen</summary>
        <p>
          Teste, wie Flugplan-Nachfrage, Fahrzeuge und Ladeleistung zusammenwirken. Ein gemeinsamer
          Modelltag, zwei Laderegeln. Keine automatische Anlagensteuerung.
        </p>
        <div className="coupled-chain" aria-label="Modellkopplung">
          <span>
            01
            <br />
            <strong>Planzeiten</strong>
          </span>
          <span>
            02
            <br />
            <strong>Serviceaufträge</strong>
          </span>
          <span>
            03
            <br />
            <strong>Flotte &amp; SOC</strong>
          </span>
          <span>
            04
            <br />
            <strong>Netz &amp; Laden</strong>
          </span>
          <span>
            05
            <br />
            <strong>Aufgabenbereitschaft</strong>
          </span>
        </div>
        <p className="coupled-boundary">
          <strong>Veröffentlichter Plan, angenommener Betrieb.</strong> Fahrzeugzahlen, Verbrauch,
          Fristen, Lastprofile und elektrische Topologie sind nicht kalibriert. Das Ergebnis ist
          keine reale Flug-OTP/TOBT und kein Sicherheits- oder Investitionsnachweis.
        </p>
      </details>
      {config && (
        <SystemExplorer
          config={config}
          setConfig={setConfig}
          plan={plan}
          records={pair}
          startControlId="coupled-start"
        />
      )}
      <div className="studio-coupled-layout">
        <section className="studio-test-config" aria-label="Testkonfiguration">
          <h2>Testkonfiguration</h2>
          <div id="coupled-flightplan">{flightPlanPanel}</div>
          <p>Laderegeln: Ungesteuert / Fristenpriorität</p>
          <p className="muc-small">Annahmen, keine Messwerte.</p>
          {Boolean(plan?.possible_shared_flight_groups) && (
            <label className="coupled-ack">
              <input
                type="checkbox"
                checked={ackFor === plan!.snapshot_id}
                onChange={(e) => setAckFor(e.target.checked ? plan!.snapshot_id : null)}
              />
              Mehrfachgruppen als unabhängige Nachfrage annehmen (
              {plan!.possible_shared_flight_groups} ungeklärt). Keine bestätigten physischen
              Flugbewegungen.
            </label>
          )}
          {config && (
            <CoupledControls config={config} setConfig={setConfig} seed={seed} setSeed={setSeed} />
          )}
          <p className="muc-small">Keine reale Anlagensteuerung.</p>
        </section>
        <section
          id="coupled-compare"
          aria-label="Gekoppelter Regelvergleich"
          className="studio-coupled-results"
        >
          <h2>Vergleich</h2>
          {!pair && !error && !busy && (
            <p className="studio-empty">
              Flugplantag und Annahmen prüfen, dann Vergleich starten. Noch keine Modell-KPIs.
            </p>
          )}
          {referenceError && (
            <p role="alert" className="muc-error">
              Kopplung nicht verfügbar: {referenceError}
            </p>
          )}
          {error && (
            <div role="alert" className="muc-error">
              {error}
              {comparison && (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setRetry((v) => v + 1);
                  }}
                >
                  Nachweise erneut laden
                </button>
              )}
            </div>
          )}
          {statuses.length > 0 && (
            <div className="coupled-status" aria-live="polite">
              {statuses.map((s, i) => (
                <span key={s.run_id}>
                  {i === 0 ? "Ungesteuert" : "Fristenpriorität"}:{" "}
                  {
                    {
                      queued: "Warteschlange",
                      running: "Berechnung",
                      completed: "Abgeschlossen",
                      failed: "Fehlgeschlagen",
                    }[s.state]
                  }{" "}
                  ({s.progress} %) <code>{s.run_id.slice(0, 8)}</code>
                </span>
              ))}
            </div>
          )}
          {pair && !error && (
            <div className="coupled-evidence">
              <p className="muc-ok">
                {reportsHashed
                  ? "Eingaben, Telemetrie, Datenartefakte und JSON/PDF: aktuelle SHA256-Prüfung konsistent."
                  : "Ältere Runs: Datenartefakte gehasht."}{" "}
                KPIs, Modellkriterien und Execution-Metadaten stimmen mit dem gespeicherten Bericht
                überein. Kein externer Echtheitsnachweis.
              </p>
              <p className="coupled-frozen">
                Eingefrorener Vergleich:{" "}
                {flightDate(
                  pair[0].model_pack_snapshot.calibration_meta.flight_plan_snapshot.service_date,
                )}{" "}
                · {number(pair[0].summary!.coupled_kpis.model_horizon_hours, 1)} Modellstunden
                inklusive Vor-/Nachlauf. Aktuelle Formularänderungen ändern diese Nachweise nicht.
              </p>
              <CoupledCompare baseline={pair[0]} priority={pair[1]} reportsHashed={reportsHashed} />
              <div className="coupled-deltas">
                <Delta
                  label="Energie-Warteminuten"
                  base={pair[0].summary!.coupled_kpis.energy_wait_total_min}
                  value={pair[1].summary!.coupled_kpis.energy_wait_total_min}
                  unit="min"
                />
                <Delta
                  label="Parkhausenergie fehlt"
                  base={pair[0].summary!.energy_kpis.charging_unmet_kwh}
                  value={pair[1].summary!.energy_kpis.charging_unmet_kwh}
                  unit="kWh"
                />
              </div>
              <p>
                Keine Siegergarantie: Fristenpriorität ist eine Ladeheuristik, kein optimaler
                Fahrplan. Auch Nullvorteile und Nachteile bleiben sichtbar. Fahrzeugdisposition ist
                in beiden Läufen gleich.
              </p>
              {chart.length > 0 && (
                <div className="coupled-charts">
                  <CoupledChart rows={chart} origin={shown!.day_start_utc} mode="power" />
                  <CoupledChart rows={chart} origin={shown!.day_start_utc} mode="soc" />
                  <CoupledChart rows={chart} origin={shown!.day_start_utc} mode="queue" />
                </div>
              )}
              <h3>Auftrag bis Flugplaneintrag verfolgen</h3>
              <div className="coupled-filters">
                <label>
                  Nachweise der Laderegel
                  <select
                    value={selectedPolicy}
                    onChange={(e) => setSelectedPolicy(e.target.value as typeof selectedPolicy)}
                  >
                    <option value="uncontrolled">Ungesteuert</option>
                    <option value="mission_priority">Fristenpriorität</option>
                  </select>
                </label>
                <label>
                  Modellaufgaben suchen
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Flugnummer, Fahrzeug, Klasse"
                  />
                </label>
                <label className="coupled-ack">
                  <input
                    type="checkbox"
                    checked={lateOnly}
                    onChange={(e) => setLateOnly(e.target.checked)}
                  />
                  Nur Fristverletzungen / nicht erledigt
                </label>
              </div>
              <div
                className="muc-table-scroll"
                role="region"
                aria-label="Modellaufträge, scrollbare Tabelle"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Plan-Eintrag / Klasse</th>
                      <th>Fahrzeug</th>
                      <th>Modellfrist</th>
                      <th>Erledigt</th>
                      <th>Warteursache</th>
                      <th>Frist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m) => (
                      <tr key={m.mission_id}>
                        <td>
                          <strong>{m.flight_number}</strong>
                          <br />
                          {FLEET_LABELS[m.kind]} · PDF S. {m.source_pages.join(", ")}
                        </td>
                        <td>
                          <code>{m.vehicle_id ?? "Nicht zugewiesen"}</code>
                        </td>
                        <td>{modelTime(shown!.day_start_utc, m.deadline_min)}</td>
                        <td>{modelTime(shown!.day_start_utc, m.actual_complete_min)}</td>
                        <td>
                          {
                            {
                              none: "Keine",
                              energy: "Energie",
                              resource: "Fahrzeuge",
                              energy_and_resource: "Energie + Fahrzeuge",
                            }[m.wait_cause]
                          }
                          <br />
                          {m.energy_wait_min} / {m.resource_wait_min} min
                        </td>
                        <td className={m.deadline_met ? "muc-ok" : "muc-warn"}>
                          {m.deadline_met
                            ? "Erfüllt"
                            : `${m.delay_is_lower_bound ? "≥ " : ""}${m.delay_min} min verletzt`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <p>Keine passenden Modellaufgaben.</p>}
              <p>
                Maximal 100 Treffer angezeigt; vollständige Aufgaben und SOC-Verlauf im Export.
                Minuten sind Auftrag-Wartezeit, nicht Flughafen-Gesamtverspätung.
              </p>
              {shown && (
                <div className="muc-downloads">
                  {(
                    [
                      ["vehicles.csv", "Fahrzeug-SOC CSV"],
                      ["departures.csv", "Abflug-Aufgaben CSV"],
                      ["parking.csv", "Parkhaus CSV"],
                      ["coupled-evidence.json", "Gesamtnachweis JSON"],
                    ] as const
                  ).map(([file, label]) => (
                    <a
                      key={file}
                      href={url(
                        `/runs/${pair.find((r) => r.model_pack_snapshot.parameter_set.policy === selectedPolicy)!.status.run_id}/artifacts/${file}`,
                      )}
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
              <details>
                <summary>Welt-Hash, Annahmen und Grenzen</summary>
                <code className="muc-run-id">{comparison!.world_hash}</code>
                <ul>
                  {pair[0].model_pack_snapshot.calibration_meta.coupled_world.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <pre>
                  {JSON.stringify(
                    pair[0].model_pack_snapshot.calibration_meta.coupled_world.config,
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
        </section>
      </div>
      {pair && <CostWorksheet baseline={pair[0]} recommended={pair[1]} />}
      <RobustnessPanel snapshot={plan} config={config ?? undefined} />
    </section>
  );
}
