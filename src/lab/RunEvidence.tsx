import { lazy, Suspense } from "react";
import {
  format,
  Icon,
  Metrics,
  SectionHeading,
  sourceName,
  stateNames,
  verdictNames,
} from "./components";
import { labUrl } from "./api";
import type { Comparison, LabRun, Sample } from "./types";
const PowerChart = lazy(() => import("./PowerChart"));
interface Props {
  record: LabRun | null;
  trace: Sample[];
  preview: Sample[];
  active: boolean;
  baseline: string;
  comparison: Comparison | null;
  compareError: string | null;
  compatible: LabRun[];
  compare: (id: string) => void;
  cancel: () => void;
  newTest: () => void;
}
export default function RunEvidence({
  record,
  trace,
  preview,
  active,
  baseline,
  comparison,
  compareError,
  compatible,
  compare,
  cancel,
  newTest,
}: Props) {
  return (
    <div className="lab-evidence">
      <section className="lab-signal-panel">
        <div className="lab-signal-header">
          <div>
            <p className="lab-eyebrow">
              {record ? sourceName(record).toUpperCase() : "PROFILVORSCHAU / KEINE MESSUNG"}
            </p>
            <h2>{record?.label ?? "Leistungsverlauf"}</h2>
          </div>
          {record && (
            <span
              role="status"
              aria-live="polite"
              className={`lab-badge ${record.analysis?.verdict ?? "neutral"}`}
            >
              {record.analysis ? verdictNames[record.analysis.verdict] : stateNames[record.state]}
            </span>
          )}
        </div>
        <div className="lab-legend">
          <span className="measured">Ist-Leistung</span>
          <span className="command">Soll-Leistung</span>
          <span className="limit">Leistungsgrenze</span>
          <small>
            {record?.request
              ? `${record.request.playback_speed}× Wiedergabe`
              : record
                ? "Importierter Zeitverlauf"
                : "Ist-Werte erst nach Teststart"}
          </small>
        </div>
        <Suspense fallback={<div className="lab-chart-loading">Zeitverlauf wird geladen…</div>}>
          <PowerChart
            trace={record ? trace : preview}
            maxGap={record?.criteria.max_gap_s ?? 3}
            preview={!record}
          />
        </Suspense>
        <div className="lab-trace-footer">
          <span>
            {record ? (
              <>
                <span className="lab-mini-label">RUN</span>{" "}
                <code title={record.run_id}>{record.run_id}</code>
              </>
            ) : (
              "Geplanter Sollwertsprung nach 30 s. Zeitachse in tatsächlichen Modellsekunden."
            )}
          </span>
          {active ? (
            <button
              className="lab-text-button danger"
              onClick={() => {
                void cancel();
              }}
            >
              Test abbrechen
            </button>
          ) : record ? (
            <button className="lab-text-button" onClick={newTest}>
              Neuen Test vorbereiten
            </button>
          ) : null}
        </div>
        {active && record && (
          <div
            className="lab-progress"
            aria-label="Testfortschritt"
            role="progressbar"
            aria-valuenow={Math.round(record.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${record.progress * 100}%` }} />
            <span>
              {stateNames[record.state]} · {Math.round(record.progress * 100)}%
            </span>
          </div>
        )}
        {record?.error && (
          <p className="lab-run-error" role="alert">
            {record.error}
          </p>
        )}
        <Metrics analysis={record?.analysis ?? null} />
      </section>
      <section className="lab-check-panel">
        <SectionHeading number="02" title="Prüfergebnis">
          {record?.analysis && (
            <span className="lab-mono">
              {format(record.analysis.quality.coverage_pct)}% Zeitabdeckung
            </span>
          )}
        </SectionHeading>
        {record?.analysis ? (
          <>
            <div className="lab-table-scroll">
              <table className="lab-table">
                <thead>
                  <tr>
                    <th>Prüfung</th>
                    <th>Ist / Grenze</th>
                    <th>Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {record.analysis.checks.map((check) => (
                    <tr key={check.id}>
                      <td>
                        <strong>{check.name}</strong>
                        <small>{check.detail}</small>
                      </td>
                      <td className="lab-mono">
                        {format(check.actual)} / {format(check.threshold)} {check.unit}
                      </td>
                      <td>
                        <span className={`lab-check-state ${check.state}`}>
                          {verdictNames[check.state]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lab-quality-note">
              {record.analysis.quality.sample_count} Messpunkte ·{" "}
              {record.analysis.quality.missing_samples} fehlende Ist-Werte · maximale Zeitlücke{" "}
              {format(record.analysis.quality.max_gap_s)} s · Abtastabdeckung{" "}
              {format(record.analysis.quality.sampling_coverage_pct)}%. Energie wird nicht über
              Lücken interpoliert.
            </div>
          </>
        ) : (
          <div className="lab-empty">
            <Icon name="shield" size={25} />
            <div>
              <strong>Erst messen. Dann bewerten.</strong>
              <p>
                Die Kriterien werden beim Start eingefroren. Fehlende Daten ergeben kein scheinbares
                PASS.
              </p>
            </div>
          </div>
        )}
      </section>
      {record?.analysis && (
        <section className="lab-compare-panel">
          <SectionHeading number="03" title="Baseline-Vergleich" />
          <label className="lab-field">
            <span>Vergleichbarer Referenzlauf</span>
            <select
              value={baseline}
              onChange={(event) => {
                void compare(event.target.value);
              }}
            >
              <option value="">
                {compatible.length
                  ? "Baseline auswählen…"
                  : "Noch kein vergleichbarer Referenzlauf"}
              </option>
              {compatible.map((run) => (
                <option value={run.run_id} key={run.run_id}>
                  {run.label} · {sourceName(run)} ·{" "}
                  {new Date(run.created_ts).toLocaleString("de-DE")}
                </option>
              ))}
            </select>
          </label>
          {comparison && (
            <div className="lab-deltas">
              {[
                { key: "peak_power_kw", label: "Δ Spitzenleistung", unit: "kW" },
                { key: "tracking_mae_kw", label: "Δ Sollabweichung", unit: "kW" },
                { key: "response_time_s", label: "Δ Reaktionszeit", unit: "s" },
                { key: "limit_violation_s", label: "Δ Limitverletzung", unit: "s" },
              ].map((delta) => {
                const value = comparison.deltas[delta.key as keyof Comparison["deltas"]];
                return (
                  <div key={delta.key}>
                    <span>{delta.label}</span>
                    <strong>
                      {value != null && value > 0 ? "+" : ""}
                      {format(value)} <small>{delta.unit}</small>
                    </strong>
                  </div>
                );
              })}
            </div>
          )}
          {compareError && <p role="alert">{compareError}</p>}
          {comparison && (
            <a
              className="lab-compare-download"
              href={labUrl(
                `/compare/report.html?baseline_id=${encodeURIComponent(comparison.baseline_id)}&candidate_id=${encodeURIComponent(comparison.candidate_id)}`,
              )}
              download
            >
              <Icon name="download" size={15} />
              Vergleichsbericht HTML
            </a>
          )}
          <p className="lab-footnote">
            Nur identische Testfälle, Prüfstanddaten, Kriterien und Soll-/Limittraces sind
            vergleichbar. Differenzen sind kein kausaler Wirksamkeitsnachweis.
          </p>
        </section>
      )}
      {record?.state === "completed" && (
        <section className="lab-export">
          <div>
            <h3>Evidenz mitnehmen</h3>
            <p>Konfiguration, Messpunkte und Prüfentscheidungen bleiben nachvollziehbar.</p>
          </div>
          <div className="lab-export-links">
            {record.artifacts
              .filter((name) => name !== "source.csv")
              .map((name) => (
                <a
                  key={name}
                  href={labUrl(
                    `/runs/${record.run_id}/artifacts/${name}${name === "report.html" ? "?inline=true" : ""}`,
                  )}
                  download={name !== "report.html"}
                  target={name === "report.html" ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  <Icon name="download" size={15} />
                  {name === "report.html"
                    ? "HTML-Bericht"
                    : name === "record.json"
                      ? "Record JSON"
                      : "Trace CSV"}
                </a>
              ))}
          </div>
        </section>
      )}
      {record && (
        <details className="lab-audit">
          <summary>Eingefrorenes Profil & Provenienz</summary>
          <dl>
            <dt>Prüfstand</dt>
            <dd>
              {record.bench.name} · {record.bench.max_power_kw} kW Nennleistung
            </dd>
            <dt>Quelle</dt>
            <dd>
              {sourceName(record)}{" "}
              {record.filename ? `· ${record.filename}` : `· Seed ${record.request?.seed ?? "n/a"}`}
            </dd>
            <dt>Erstellt</dt>
            <dd>{new Date(record.created_ts).toLocaleString("de-DE")}</dd>
            <dt>Neustarts</dt>
            <dd>{record.recovery_count}</dd>
            <dt>Datei-SHA256</dt>
            <dd>
              <code>{record.source_sha256 ?? "Simulation: keine Importdatei"}</code>
            </dd>
            <dt>Backend-SHA256</dt>
            <dd>
              <code>{record.build_source_sha256 ?? "n/a"}</code>
            </dd>
          </dl>
          <p>
            Diese Auswertung prüft eine obere Leistungsgrenze, keine elektrische Schutzfunktion.
            Keine Hardwarekalibrierung.
          </p>
        </details>
      )}
    </div>
  );
}
