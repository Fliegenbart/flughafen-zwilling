import { useEffect, useState } from "react";
import { request, type ApiError } from "../api/http";
import { apiBase } from "../../shared/runtimeConfig";
import type {
  PilotProject,
  PilotImport,
  PilotAssessment,
  PilotTolerances,
} from "../../pilot/types";
import { issueLabel } from "../../shared/issues";
import { useNav } from "../context";
import { SAMPLE_PROJECT } from "../sample";
import Link from "../Link";
import "./measurement.css";

type Run = {
  run_id: string;
  state: string;
  scenario_id: string;
  artifacts: string[];
  end_ts?: string;
};
type Evidence = { day_start_utc: string; series: { minute: number }[] };
const PREFIX = "measurement-workflow-v1:";
const url = (path: string) => `${apiBase()}/api/v1${path}`;
const METRICS = {
  grid_import_kw: "Netzbezug (kW)",
  ground_charging_kw: "Ladeleistung Vorfeld (kW)",
  parking_kw: "Ladeleistung Parkhaus (kW)",
};
type Metric = keyof typeof METRICS;
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const n = (v: number | null | undefined) =>
  v == null ? "nicht auswertbar" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
function download(text: string, name: string) {
  const href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function MeasurementWorkflow({
  projectId,
  initialRun,
}: {
  projectId: string;
  initialRun?: string;
}) {
  const nav = useNav();
  const [runs, setRuns] = useState<Run[]>([]),
    [saved, setSaved] = useState<PilotProject[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [runId, setRunId] = useState(initialRun ?? ""),
    [verified, setVerified] = useState(false),
    [evidence, setEvidence] = useState<Evidence | null>(null);
  const [project, setProject] = useState<PilotProject | null>(null),
    [question, setQuestion] = useState("");
  const [boundary, setBoundary] = useState(""),
    [metric, setMetric] = useState<Metric>("grid_import_kw");
  const [mae, setMae] = useState(""),
    [energy, setEnergy] = useState(""),
    [tolerances, setTolerances] = useState<PilotTolerances | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [source, setSource] = useState(""),
    [consent, setConsent] = useState(false),
    [holdout, setHoldout] = useState(false);
  const [imports, setImports] = useState<PilotImport[]>([]),
    [sourceId, setSourceId] = useState(""),
    [replay, setReplay] = useState<PilotImport | null>(null),
    [assessment, setAssessment] = useState<PilotAssessment | null>(null);
  const locked = Boolean(tolerances?.locked),
    base = project ? `/pilot/projects/${project.id}` : "";
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    (async () => {
      const [all, projects] = await Promise.all([
        request<Run[]>("/runs", { signal: ctrl.signal }),
        request<PilotProject[]>("/pilot/projects", { signal: ctrl.signal }),
      ]);
      if (!alive) return;
      setRuns(
        all.filter(
          (r) =>
            r.state === "completed" &&
            r.artifacts.some((a) => a.split(/[\\/]/).pop() === "coupled-evidence.json"),
        ),
      );
      const comparisons = projects.filter((p) => p.acceptance_note.startsWith(PREFIX));
      setSaved(comparisons);
      const p = comparisons.find((p) => p.id === projectId);
      if (!p) return;
      const [links, t, im, assessments] = await Promise.all([
        request<{ kind: string; ref_id: string }[]>(`/projects/${p.id}/links`, {
          signal: ctrl.signal,
        }),
        request<PilotTolerances | null>(`/pilot/projects/${p.id}/tolerances`, {
          signal: ctrl.signal,
        }),
        request<PilotImport[]>(`/pilot/projects/${p.id}/imports`, { signal: ctrl.signal }),
        request<PilotAssessment[]>(`/pilot/projects/${p.id}/assessments`, { signal: ctrl.signal }),
      ]);
      if (!alive) return;
      const selected = links.find((l) => l.kind === "coupled_run");
      if (!selected)
        throw new Error(
          "Dieser Vergleich hat keine verknüpfte Berechnung. Bitte einen neuen Abgleich anlegen.",
        );
      const m = p.acceptance_note.slice(PREFIX.length);
      if (!(m in METRICS)) throw new Error("Unbekannte Vergleichsgröße.");
      setProject(p);
      setQuestion(p.decision);
      setBoundary(p.scope);
      setMetric(m as Metric);
      setRunId(selected.ref_id);
      setTolerances(t);
      setImports(im);
      if (t) {
        setMae(String(t.tolerances.mae_max_kw));
        setEnergy(String(t.tolerances.energy_error_max_pct));
      }
      const a = assessments[assessments.length - 1];
      const rp = a ? im.find((i) => i.id === a.import_id && i.source_import_id) : undefined;
      if (rp) {
        setSourceId(rp.source_import_id!);
        setReplay(rp);
        setAssessment(a!);
      }
    })()
      .catch((e) => {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [projectId]);
  useEffect(() => {
    setVerified(false);
    setEvidence(null);
    if (!runId) return;
    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      const record = await request<{ status: Run; scenario_snapshot: { domain: string } }>(
        `/runs/${runId}/record`,
        { signal: ctrl.signal },
      );
      if (
        record.status.state !== "completed" ||
        record.scenario_snapshot?.domain !== "airport_coupled_v1"
      )
        throw new Error("Nur abgeschlossene gekoppelte Berechnungen sind geeignet.");
      const safety = await request<{ audit: Record<string, boolean> }>(`/runs/${runId}/safety`, {
        signal: ctrl.signal,
      });
      if (
        ![
          "fingerprint_match",
          "artifact_hashes_match",
          "report_consistent_match",
          "reports_hashed",
        ].every((k) => safety.audit[k] === true)
      )
        throw new Error("Berechnungsnachweis ist nicht vollständig verifiziert.");
      const ev = await request<Evidence>(`/runs/${runId}/artifacts/coupled-evidence.json`, {
        signal: ctrl.signal,
      });
      if (!ev.series?.length || !Number.isFinite(Date.parse(ev.day_start_utc)))
        throw new Error("Zeitreihe der Berechnung fehlt.");
      if (alive) {
        setEvidence(ev);
        setVerified(true);
        try {
          const q = sessionStorage.getItem(`aec.measurement-question.${runId}`);
          if (q && projectId === SAMPLE_PROJECT.id) setQuestion(q);
        } catch {
          /* optional handoff */
        }
      }
    })().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [runId, projectId]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function freeze() {
    await act(async () => {
      let p = project;
      if (!p) {
        p = await request<PilotProject>(
          "/pilot/projects",
          post({
            name: question.trim().slice(0, 160),
            decision: question.trim(),
            scope: boundary.trim(),
            acceptance_note: PREFIX + metric,
          }),
        );
        setProject(p);
      }
      const links = await request<{ kind: string; ref_id: string }[]>(`/projects/${p.id}/links`);
      if (!links.some((link) => link.kind === "coupled_run" && link.ref_id === runId)) {
        await request(
          `/projects/${p.id}/links`,
          post({
            kind: "coupled_run",
            ref_id: runId,
            note: "Berechnungsbasis des Messdaten-Abgleichs",
          }),
        );
      }
      const t = await request<PilotTolerances>(`/pilot/projects/${p.id}/tolerances`, {
        method: "PUT",
        body: JSON.stringify({
          mae_max_kw: Number(mae),
          energy_error_max_pct: Number(energy),
          min_rows: 60,
          min_coverage_seconds: 3600,
          lock: true,
        }),
      });
      setTolerances(t);
      setSaved((prev) => (prev.some((x) => x.id === p!.id) ? prev : [p!, ...prev]));
    });
  }
  async function upload() {
    if (!file || !project) return;
    await act(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error("Die CSV darf maximal 5 MiB groß sein.");
      const csv = await file.text();
      if (
        csv
          .split(/\r?\n/)[0]
          ?.split(",")
          .map((x) => x.trim())
          .join(",") !== "timestamp,measured_kw"
      )
        throw new Error(
          "Bitte nur timestamp,measured_kw hochladen. Modellwerte werden ausschließlich vom Server ergänzt.",
        );
      let item: PilotImport;
      try {
        item = await request<PilotImport>(
          `${base}/imports`,
          post({
            filename: file.name,
            csv_text: csv,
            role: holdout ? "holdout" : "lab",
            measurement_boundary: boundary,
            source_note: source,
            sample_semantics: "interval_end_mean",
          }),
        );
      } catch (e) {
        const body = (e as ApiError).body as PilotImport | undefined;
        if (body?.id && body.quality) item = body;
        else throw e;
      }
      setImports((prev) => [item, ...prev]);
      setSourceId(item.id);
      setReplay(null);
      setAssessment(null);
      setFile(null);
    });
  }
  async function evaluate() {
    if (!project || !sourceId) return;
    setAssessment(null);
    await act(async () => {
      let rp = replay;
      if (!rp || rp.source_import_id !== sourceId) {
        rp = await request<PilotImport>(
          `${base}/replays`,
          post({ import_id: sourceId, run_id: runId, metric }),
        );
        setReplay(rp);
      }
      const a = await request<PilotAssessment>(`${base}/assessments`, post({ import_id: rp.id }));
      setAssessment(a);
    });
  }
  function template() {
    if (!evidence) return;
    const origin = Date.parse(evidence.day_start_utc);
    download(
      "timestamp,measured_kw\n" +
        evidence.series
          .map((r) => `${new Date(origin + r.minute * 60000).toISOString()},`)
          .join("\n") +
        "\n",
      "messraster-ohne-messwerte.csv",
    );
  }
  const originals = imports.filter((i) => !i.source_import_id);
  const selected = originals.find((i) => i.id === sourceId);
  const validForm =
    verified &&
    question.trim() &&
    boundary.trim() &&
    Number(mae) > 0 &&
    Number(mae) <= 100000 &&
    Number(energy) > 0 &&
    Number(energy) <= 50;
  const fmtTime = (minute: number) =>
    new Date(Date.parse(evidence!.day_start_utc) + minute * 60000).toISOString();
  return (
    <div className="mw">
      <header>
        <span className="aec-kicker">MESSDATEN-ABGLEICH</span>
        <h1>Simulation mit Messdaten überprüfen</h1>
        <p>
          Wählen Sie eine gespeicherte Berechnung und vergleichen Sie deren Leistungswerte mit einer
          eigenen Messreihe. Hier werden keine Prüfaufträge erfunden und keine Anlagen angesteuert.
        </p>
      </header>
      <aside className="mw-notice">
        <strong>Öffentliche Demo:</strong> Keine vertraulichen Flughafen- oder Kundendaten
        hochladen. Alle Besucher teilen diesen Datenbereich. Echte vertrauliche Messungen gehören in
        eine getrennte, geschützte Instanz.
      </aside>
      {saved.length > 0 && (
        <label>
          Gespeicherten Abgleich öffnen
          <select
            value={project?.id ?? ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) nav.navigate({ page: "lab", projekt: e.target.value });
            }}
          >
            <option value="">Abgleich auswählen</option>
            {saved.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ol className="mw-steps" aria-label="Ablauf">
        <li>1 · Berechnung auswählen</li>
        <li>2 · Prüffrage festlegen</li>
        <li>3 · Messdaten hochladen</li>
        <li>4 · Abweichungen auswerten</li>
      </ol>
      {error && (
        <p role="alert" className="aec-error">
          {error}
        </p>
      )}
      {busy && <p role="status">Wird auf dem Server gespeichert bzw. berechnet …</p>}
      <section>
        <h2>1 · Berechnung auswählen</h2>
        <p>
          Nur gespeicherte, abgeschlossene Fahrzeug-/Energie-Simulationen sind geeignet. Eine
          Vorschau oder ein reiner Gate-Test reicht nicht aus.
        </p>
        {loading ? (
          <p>Berechnungen werden geladen …</p>
        ) : !runs.length ? (
          <p>
            Noch keine gespeicherte gekoppelte Berechnung vorhanden. Starten Sie die Simulation und
            wählen Sie dort „Mit Messdaten überprüfen“.
          </p>
        ) : null}
        <label>
          Gespeicherte Berechnung
          <select
            value={runId}
            disabled={busy || Boolean(project)}
            onChange={(e) => {
              setRunId(e.target.value);
              setError("");
            }}
          >
            <option value="">Berechnung auswählen</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id} · {r.end_ts ?? r.scenario_id}
              </option>
            ))}
          </select>
        </label>
        <Link to={{ page: "start" }}>
          Zur interaktiven Simulation
        </Link>
        {verified && evidence && (
          <div className="mw-receipt">
            <strong>Integrität geprüft, keine empirische Validierung.</strong>
            <p>
              Run: <code>{runId}</code>
            </p>
            <p>
              {evidence.series.length} Minutenwerte · {fmtTime(evidence.series[0]!.minute)} bis{" "}
              {fmtTime(evidence.series[evidence.series.length - 1]!.minute)} (UTC)
            </p>
            <a href={url(`/runs/${runId}/artifacts/coupled-evidence.json`)}>
              Berechnungsnachweis öffnen
            </a>
          </div>
        )}
      </section>
      <section>
        <h2>2 · Prüffrage festlegen</h2>
        <p>
          Was soll an welchem Messpunkt überprüft werden? Grenzen werden vor dem Import gespeichert
          und gesperrt, nicht nach dem Ergebnis angepasst.
        </p>
        <fieldset disabled={!verified || busy || Boolean(project)}>
          <label>
            Ihre Prüffrage
            <textarea
              value={question}
              maxLength={1000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Beispielsweise: Wie stark weicht der Netzbezug am Trafo ab?"
            />
          </label>
          <label>
            Messgrenze
            <input
              value={boundary}
              maxLength={1000}
              onChange={(e) => setBoundary(e.target.value)}
              placeholder="Messpunkt, enthaltene Verbraucher und Abgrenzung"
            />
          </label>
          <label>
            Vergleichsgröße
            <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {Object.entries(METRICS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset disabled={!verified || busy || locked}>
          <div className="mw-grid">
            <label>
              Maximaler mittlerer Fehler (kW)
              <input
                type="number"
                min="0.001"
                max="100000"
                step="any"
                value={mae}
                onChange={(e) => setMae(e.target.value)}
              />
            </label>
            <label>
              Maximaler Energiefehler (%)
              <input
                type="number"
                min="0.001"
                max="50"
                step="any"
                value={energy}
                onChange={(e) => setEnergy(e.target.value)}
              />
            </label>
          </div>
          <p>
            Mindestens 60 Werte und eine Stunde Abdeckung. Vollständige Zeitdeckung des gewählten
            Laufs ist erforderlich. Die MAE-Grenze darf höchstens 50 % der mittleren gemessenen
            Leistung betragen.
          </p>
        </fieldset>
        <button
          className="aec-button"
          disabled={!validForm || busy || locked}
          onClick={() => void freeze()}
        >
          Prüffrage und Grenzen speichern
        </button>
        {locked && (
          <p role="status">
            Prüffrage gespeichert, Grenzen gesperrt.{" "}
            <Link to={{ page: "lab", projekt: project!.id }}>
              Dauerhafter Link zu diesem Abgleich
            </Link>
          </p>
        )}
      </section>
      <section>
        <h2>3 · Messdaten hochladen</h2>
        <p>
          CSV mit exakt <code>timestamp,measured_kw</code>, UTF-8, kW und ISO-Zeitstempel mit
          Zeitzone. Jeder Wert ist der Mittelwert der Minute, die am Zeitstempel endet. Kein
          automatisches Verschieben, Auffüllen oder Interpolieren.
        </p>
        <p>
          Die Messung muss denselben Zeitraum und dieselbe Messgrenze abdecken wie die Simulation.
          Das leere Raster enthält ausdrücklich keine Messwerte.
        </p>
        <button className="aec-button aec-button--ghost" disabled={!verified} onClick={template}>
          Leeres Zeitraster herunterladen
        </button>
        <fieldset disabled={!locked || busy}>
          <label>
            CSV-Messdatei
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Quelle und Messbedingungen
            <textarea
              value={source}
              maxLength={2000}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Herkunft, Messgerät, Versuchsbedingungen, synthetisch oder real"
            />
          </label>
          <label className="mw-check">
            <input
              type="checkbox"
              checked={holdout}
              onChange={(e) => setHoldout(e.target.checked)}
            />
            Unabhängige Messreihe: nicht zur Kalibrierung verwendet, nicht aus dem Modell erzeugt.
          </label>
          <p>
            Ohne diese Bestätigung entsteht nur eine Diagnose, kein Holdout-Nachweis. Eine
            Bestätigung allein beweist keine Unabhängigkeit.
          </p>
          <label className="mw-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Keine vertraulichen oder personenbezogenen Daten enthalten; Speicherung in der
            öffentlichen Demo verstanden.
          </label>
          <button
            className="aec-button"
            disabled={!file || !source.trim() || !consent || busy}
            onClick={() => void upload()}
          >
            Messdaten importieren
          </button>
        </fieldset>
        {!!originals.length && (
          <label>
            Importierte Messreihe
            <select
              value={sourceId}
              disabled={busy}
              onChange={(e) => {
                setSourceId(e.target.value);
                setReplay(null);
                setAssessment(null);
              }}
            >
              <option value="">Messreihe auswählen</option>
              {originals.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.filename} ·{" "}
                  {i.quality.state === "valid" ? "formal gültig" : "nicht auswertbar"}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && (
          <div className="mw-receipt">
            <p>
              {selected.quality.rows} Werte · Datenqualität:{" "}
              {selected.quality.state === "valid"
                ? "formal gültig, Vergleich noch offen"
                : "nicht auswertbar"}
            </p>
            {selected.quality.issues.map((i) => (
              <p key={i}>{issueLabel(i)}</p>
            ))}
            <p>
              Original-Hash: <code>{selected.quality.sha256}</code>
            </p>
          </div>
        )}
      </section>
      <section>
        <h2>4 · Abweichungen auswerten</h2>
        <p>
          Der Server entnimmt die Modellwerte dem geprüften Lauf. Hochgeladene Modellwerte werden
          nicht übernommen. Originalmessung und Berechnungsnachweise bleiben erhalten.
        </p>
        <button
          className="aec-button"
          disabled={!verified || !locked || selected?.quality.state !== "valid" || busy}
          onClick={() => void evaluate()}
        >
          Abweichungen berechnen
        </button>
        {!assessment && (
          <p>Noch kein Vergleichsergebnis. Ohne passende Messdaten wird kein Ergebnis angezeigt.</p>
        )}
        {assessment && (
          <div className="mw-result">
            <h3>
              {assessment.evaluation_kind === "lab_diagnostic"
                ? "Diagnose, kein Validierungsnachweis"
                : assessment.validity_status === "PASS"
                  ? "Vorab festgelegte Grenzen eingehalten"
                  : assessment.validity_status === "FAIL"
                    ? "Vorab festgelegte Grenzen überschritten"
                    : "Nicht auswertbar"}
            </h3>
            <p>Serverstatus: {assessment.validity_status}</p>
            <dl>
              <dt>Mittlere absolute Abweichung</dt>
              <dd>{n(assessment.metrics.time_weighted_mae_kw)} kW</dd>
              <dt>Mittlere gerichtete Abweichung (Modell − Messung)</dt>
              <dd>{n(assessment.metrics.time_weighted_bias_kw)} kW</dd>
              <dt>Energieabweichung</dt>
              <dd>{n(assessment.metrics.energy_error_pct)} %</dd>
              <dt>Verglichener Zeitraum</dt>
              <dd>{n((assessment.metrics.paired_coverage_seconds ?? 0) / 3600)} Stunden</dd>
            </dl>
            {assessment.not_evaluable_reasons.map((r) => (
              <p key={r}>{issueLabel(r)}</p>
            ))}
            <p>
              Gilt nur für diese Messreihe, Messgrenze und Kriterien. Keine Bestätigung des gesamten
              Flughafenmodells, keine Betriebs- oder Sicherheitsfreigabe.
            </p>
            <a href={url(`${base}/package`)}>
              Vergleich mit Originaldaten und Nachweisen herunterladen (ZIP)
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
