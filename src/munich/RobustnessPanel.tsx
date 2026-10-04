import { useEffect, useMemo, useState } from "react";
import { request, url } from "./api";
import { number } from "./config";
import type { CoupledConfig } from "./coupledTypes";
import type { FlightPlanSnapshot } from "./flightplanTypes";
import "./RobustnessPanel.css";

type MetricSummary = {
  departure_readiness_pct: number | null;
  grid_peak_kw: number | null;
  charging_unmet_kwh: number | null;
  background_unserved_kwh: number | null;
};
type SuiteRun = {
  policy: "uncontrolled" | "mission_priority";
  run_id: string;
  status: {
    state: "queued" | "running" | "completed" | "failed";
    progress: number;
    error?: string | null;
  };
  integrity_verified: boolean;
  completed_summary: MetricSummary | null;
  delta_to_baseline: MetricSummary | null;
};
type SuiteScenario = {
  key: string;
  label: string;
  varied_parameters: Record<string, unknown>;
  demand_invariant: boolean;
  mission_signature: string;
  runs: SuiteRun[];
};
type RobustnessSuite = {
  suite_id: string;
  engine_version: string;
  seed: number;
  flight_plan_snapshot_id: string;
  source_plan_sha256: string;
  scenarios: SuiteScenario[];
  statistical_confidence: "not_provided_deterministic_stress_screen_only";
};

const stateLabel = {
  queued: "Warteschlange",
  running: "Berechnung",
  completed: "Abgeschlossen",
  failed: "Fehlgeschlagen",
} as const;

function metric(value: number | null, unit: string, digits = 1) {
  return value === null ? "n/a" : `${number(value, digits)} ${unit}`;
}

function delta(value: number | null, unit: string, digits = 1) {
  if (value === null) return "n/a";
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${normalized > 0 ? "+" : ""}${number(normalized, digits)} ${unit}`;
}

function variation(parameters: Record<string, unknown>) {
  const items = Object.entries(parameters);
  return items.length
    ? items.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("; ")
    : "Keine Abweichung";
}

export default function RobustnessPanel({
  snapshot,
  config: providedConfig,
  pollMs = 1000,
}: {
  snapshot: FlightPlanSnapshot | null;
  config?: CoupledConfig;
  pollMs?: number;
}) {
  const config = providedConfig ?? null;
  const [seed, setSeed] = useState(42);
  const [suite, setSuite] = useState<RobustnessSuite | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const active = useMemo(
    () =>
      suite?.scenarios.some((scenario) =>
        scenario.runs.some(
          (run) => run.status.state === "queued" || run.status.state === "running",
        ),
      ) ?? false,
    [suite],
  );
  useEffect(() => {
    if (!suite || !active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void request<RobustnessSuite>(`/munich/robustness-suites/${suite.suite_id}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!controller.signal.aborted) setSuite(response);
        })
        .catch((reason: Error) => {
          if (!controller.signal.aborted) setError(reason.message);
        });
    }, pollMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, pollMs, suite]);

  async function start() {
    if (!snapshot || !config || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) return;
    setStarting(true);
    setError("");
    try {
      const response = await request<RobustnessSuite>(
        "/munich/robustness-suites",
        {
          method: "POST",
          body: JSON.stringify({ flight_plan_snapshot_id: snapshot.snapshot_id, seed, config }),
        },
        30000,
      );
      if (
        response.flight_plan_snapshot_id !== snapshot.snapshot_id ||
        response.engine_version !== "airport_coupled_v1"
      )
        throw new Error("Unpassende Robustness-Suite vom Backend.");
      setSuite(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Start fehlgeschlagen");
    } finally {
      setStarting(false);
    }
  }

  const disabled =
    starting ||
    active ||
    !snapshot ||
    !config ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 2147483647;
  return (
    <section className="muc-robustness" aria-labelledby="robustness-heading">
      <header className="muc-robustness__header">
        <div>
          <p className="muc-robustness__eyebrow">SIL / deterministisch</p>
          <h2 id="robustness-heading">Begrenzter Robustness-Screen</h2>
        </div>
        <span className="muc-robustness__tag">Keine statistische Konfidenz</span>
      </header>
      <p>
        Vier feste Konfigurationen, jeweils ungesteuert und fristenpriorisiert. Dies ist ein
        deterministischer Stress-Screen, kein Belastbarkeits-, Kosten- oder ROI-Nachweis.
      </p>
      <div className="muc-robustness__inputs">
        <label>
          Seed
          <input
            aria-label="Robustness Seed"
            type="number"
            min="0"
            max="2147483647"
            step="1"
            value={seed}
            disabled={starting || active}
            onChange={(event) => setSeed(Number(event.target.value))}
          />
        </label>
        <dl>
          <div>
            <dt>Netzimport</dt>
            <dd>{config ? `${number(config.power.grid_import_limit_kw)} kW` : "wird geladen"}</dd>
          </div>
          <div>
            <dt>PV-Profilfaktor</dt>
            <dd>{config ? number(config.power.pv_peak_factor, 3) : "wird geladen"}</dd>
          </div>
          <div>
            <dt>Flugplan</dt>
            <dd>{snapshot ? snapshot.snapshot_id.slice(0, 12) : "auswählen"}</dd>
          </div>
        </dl>
      </div>
      <p className="muc-robustness__note">
        Die eingegebene Coupled-Konfiguration bleibt Basis; nur die unten ausgewiesenen Parameter
        variieren. Keine stillen Überschreibungen.
      </p>
      <button
        className="muc-primary"
        type="button"
        disabled={disabled}
        onClick={() => void start()}
      >
        {starting ? "Suite wird erstellt…" : active ? "Suite läuft…" : "Robustness-Suite starten"}
      </button>
      {!snapshot && (
        <p className="muc-small">
          Zuerst einen gespeicherten Flugplan auswählen; es wird kein Live-Feed verwendet.
        </p>
      )}
      {error && (
        <div className="muc-error" role="alert">
          {error}
        </div>
      )}
      {suite && (
        <div className="muc-robustness__results">
          <p className="muc-small">
            Suite <code>{suite.suite_id}</code> / Plan{" "}
            <code>{suite.source_plan_sha256.slice(0, 12)}</code>
          </p>
          <p className="muc-robustness__links">
            <a
              href={url(`/munich/robustness-suites/${suite.suite_id}`)}
              target="_blank"
              rel="noreferrer"
            >
              Suite-Status (GET)
            </a>
            <a href={url(`/munich/robustness-suites/${suite.suite_id}/artifact.json`)} download>
              Suite JSON
            </a>
          </p>
          <div className="muc-robustness__table-scroll">
            <table aria-label="Robustness-Suite Ergebnisse">
              <thead>
                <tr>
                  <th>Variante / genaue Änderung</th>
                  <th>Regel / Zustand</th>
                  <th>Abflugbereitschaft</th>
                  <th>Netzspitze</th>
                  <th>Ungedeckte Ladung</th>
                  <th>Grundlast unversorgt</th>
                </tr>
              </thead>
              <tbody>
                {suite.scenarios.flatMap((scenario) =>
                  scenario.runs.map((run) => (
                    <tr key={run.run_id}>
                      <td>
                        <strong>{scenario.label}</strong>
                        <code>{variation(scenario.varied_parameters)}</code>
                        <small>
                          {scenario.demand_invariant
                            ? "Missionssignatur unverändert"
                            : "Nachfragevergleich nicht gültig"}
                        </small>
                      </td>
                      <td>
                        {run.policy === "uncontrolled" ? "Ungesteuert" : "Fristenpriorität"}
                        <small>{stateLabel[run.status.state]}</small>
                        <small>
                          {run.status.state === "completed"
                            ? run.integrity_verified
                              ? "Integrität bestätigt"
                              : "Integrität ungültig"
                            : "Integritätsprüfung ausstehend"}
                        </small>
                        <a
                          href={url(`/runs/${run.run_id}/artifacts/record.json`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Run-Nachweis
                        </a>
                        <a
                          href={url(`/runs/${run.run_id}/artifacts/coupled-evidence.json`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Evidenz
                        </a>
                      </td>
                      <td>
                        {metric(run.completed_summary?.departure_readiness_pct ?? null, "%")}
                        <small>
                          {run.delta_to_baseline
                            ? `Δ ${delta(run.delta_to_baseline.departure_readiness_pct, "pp")}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {metric(run.completed_summary?.grid_peak_kw ?? null, "kW", 0)}
                        <small>
                          {run.delta_to_baseline
                            ? `Δ ${delta(run.delta_to_baseline.grid_peak_kw, "kW", 0)}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {metric(run.completed_summary?.charging_unmet_kwh ?? null, "kWh")}
                        <small>
                          {run.delta_to_baseline
                            ? `Δ ${delta(run.delta_to_baseline.charging_unmet_kwh, "kWh")}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {metric(run.completed_summary?.background_unserved_kwh ?? null, "kWh")}
                        <small>
                          {run.delta_to_baseline
                            ? `Δ ${delta(run.delta_to_baseline.background_unserved_kwh, "kWh")}`
                            : ""}
                        </small>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="muc-small">
            Baseline-Deltas erscheinen ausschließlich für abgeschlossene, kompatible Runs derselben
            Policy, desselben Seeds, Flugplans und derselben Missionssignatur.
          </p>
        </div>
      )}
    </section>
  );
}
