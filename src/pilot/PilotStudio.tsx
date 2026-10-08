import { useEffect, useState } from "react";
import { request, url } from "../munich/api";
import type { PilotAssessment, PilotImport, PilotProject, PilotTolerances } from "./types";
import { pilotReport } from "./report";
import { issueLabel, statusLabel } from "../shared/issues";
import { EvidenceBadge } from "../ui/EvidenceBadge";
import "./PilotStudio.css";

const demoCsv =
  "timestamp,measured_kw,model_kw\n2026-01-15T10:00:00+01:00,100,105\n2026-01-15T10:01:00+01:00,120,118\n2026-01-15T10:02:00+01:00,110,112\n2026-01-15T10:03:00+01:00,105,107\n";
const number = (n: number | null | undefined) =>
  n == null ? "n/a" : n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
export default function PilotStudio() {
  const [projects, setProjects] = useState<PilotProject[]>([]);
  const [selected, setSelected] = useState<PilotProject | null>(null);
  const [imports, setImports] = useState<PilotImport[]>([]);
  const [assessments, setAssessments] = useState<PilotAssessment[]>([]);
  const [name, setName] = useState("");
  const [decision, setDecision] = useState("");
  const [scope, setScope] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [role, setRole] = useState<PilotImport["role"]>("holdout");
  const [boundary, setBoundary] = useState("");
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [semantics, setSemantics] = useState("point_samples");
  const [replaySource, setReplaySource] = useState("");
  const [replayRun, setReplayRun] = useState("");
  const [replayMetric, setReplayMetric] = useState("grid_import_kw");
  const [mae, setMae] = useState("");
  const [energy, setEnergy] = useState("");
  const [minRows, setMinRows] = useState("60");
  const [minHours, setMinHours] = useState("1");
  const [tolerances, setTolerances] = useState<PilotTolerances | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<PilotProject[]>("/pilot/projects", { signal: controller.signal })
      .then(setProjects)
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setImports([]);
    setAssessments([]);
    setTolerances(null);
    if (!selected) return;
    const controller = new AbortController();
    Promise.all([
      request<PilotImport[]>(`/pilot/projects/${selected.id}/imports`, {
        signal: controller.signal,
      }),
      request<PilotAssessment[]>(`/pilot/projects/${selected.id}/assessments`, {
        signal: controller.signal,
      }),
      request<PilotTolerances | null>(`/pilot/projects/${selected.id}/tolerances`, {
        signal: controller.signal,
      }).catch(() => null),
    ])
      .then(([i, a, t]) => {
        setImports(i);
        setAssessments(a);
        applyTolerances(t);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [selected]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await action(async () => {
      const p = await request<PilotProject>("/pilot/projects", {
        method: "POST",
        body: JSON.stringify({ name, decision, scope, acceptance_note: acceptance }),
      });
      setProjects((previous) => [p, ...previous]);
      setSelected(p);
      setNotice("Pilotprojekt gespeichert.");
    });
  }
  async function upload(demo = false) {
    if (!selected || (!demo && !file)) return;
    const projectId = selected.id;
    await action(async () => {
      if (file && file.size > 5_000_000 && !demo) throw new Error("CSV maximal 5 MB.");
      let item: PilotImport;
      try {
        item = await request<PilotImport>(`/pilot/projects/${projectId}/imports`, {
          method: "POST",
          body: JSON.stringify({
            filename: demo ? "synthetisches-beispiel.csv" : file!.name,
            csv_text: demo ? demoCsv : await file!.text(),
            role: demo ? "calibration" : role,
            sample_semantics: demo ? "point_samples" : semantics,
            measurement_boundary: demo
              ? "Synthetischer Demonstrations-Abgang, keine FMG-Messung"
              : boundary,
            source_note: demo
              ? "Vier erfundene Mess-/Modellpunkte. Nur Funktionsdemo, keine Kalibrierung oder Validierung."
              : source,
          }),
        });
      } catch (e) {
        setImports(await request<PilotImport[]>(`/pilot/projects/${projectId}/imports`));
        throw e;
      }
      setImports((previous) => [item, ...previous]);
      if (!demo && role === "holdout")
        applyTolerances(
          await request<PilotTolerances | null>(`/pilot/projects/${projectId}/tolerances`).catch(
            () => tolerances,
          ),
        );
      setNotice("Originalquelle und Qualitätsprüfung gespeichert.");
    });
  }
  function applyTolerances(t: PilotTolerances | null) {
    const valid = t && t.tolerances ? t : null;
    setTolerances(valid);
    if (valid) {
      setMae(String(valid.tolerances.mae_max_kw));
      setEnergy(String(valid.tolerances.energy_error_max_pct));
      setMinRows(String(valid.tolerances.min_rows));
      setMinHours(String(valid.tolerances.min_coverage_seconds / 3600));
    }
  }
  async function saveTolerances(lock: boolean) {
    if (!selected) return;
    const projectId = selected.id;
    await action(async () => {
      const saved = await request<PilotTolerances>(`/pilot/projects/${projectId}/tolerances`, {
        method: "PUT",
        body: JSON.stringify({
          mae_max_kw: Number(mae),
          energy_error_max_pct: Number(energy),
          min_rows: Number(minRows),
          min_coverage_seconds: Number(minHours) * 3600,
          lock,
        }),
      });
      applyTolerances(saved);
      setNotice(
        lock
          ? "Abnahmekriterien gesperrt. Sie gelten unverändert für alle Bewertungen dieses Projekts."
          : "Entwurf gespeichert. Vor dem ersten Holdout-Import sperren.",
      );
    });
  }
  async function assess(item: PilotImport) {
    if (!selected || !tolerances?.locked) return;
    const frozen = tolerances.tolerances;
    await action(async () => {
      const a = await request<PilotAssessment>(`/pilot/projects/${selected.id}/assessments`, {
        method: "POST",
        body: JSON.stringify({
          import_id: item.id,
          mae_max_kw: frozen.mae_max_kw,
          energy_error_max_pct: frozen.energy_error_max_pct,
        }),
      });
      setAssessments((previous) => [a, ...previous]);
      setNotice("Bewertung mit den gesperrten Kriterien gespeichert; kein Betriebsnachweis.");
    });
  }
  async function replay() {
    if (!selected) return;
    await action(async () => {
      const item = await request<PilotImport>(`/pilot/projects/${selected.id}/replays`, {
        method: "POST",
        body: JSON.stringify({
          import_id: replaySource,
          run_id: replayRun.trim(),
          metric: replayMetric,
        }),
      });
      setImports((previous) => [item, ...previous]);
      setNotice(
        "Modellwerte aus dem geprüften Run zugeordnet. Originalmessung bleibt unverändert.",
      );
    });
  }
  function report() {
    if (!selected) return;
    const href = URL.createObjectURL(
      new Blob([pilotReport(selected, imports, assessments)], { type: "text/html;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `pilot-${selected.id}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const positive = (value: string) =>
    value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
  const tolerancesValid =
    positive(mae) &&
    positive(energy) &&
    Number(energy) <= 50 &&
    Number.isInteger(Number(minRows)) &&
    Number(minRows) >= 60 &&
    Number(minHours) >= 1;
  const locked = Boolean(tolerances?.locked);
  const holdoutBlocked = role === "holdout" && !locked;
  const assessmentsFor = (id: string) => assessments.filter((a) => a.import_id === id);
  return (
    <section className="pilot-studio" aria-labelledby="pilot-heading">
      <header className="pilot-studio__header">
        <div>
          <span className="pilot-studio__eyebrow">Pilot Decision Studio · Messdaten-Abgleich</span>
          <h2 id="pilot-heading">Stimmt das Modell mit der Messung überein?</h2>
          <p>
            Eine konkrete Flughafenentscheidung, vorab gesperrte Abnahmekriterien, dokumentierte
            Messgrenzen und ein übergebbares Testpaket. Keine Einzelgerätetests statt eures
            TestingLabs.
          </p>
        </div>
        <span className="muc-tag">Read-only / Pilot</span>
      </header>
      <ol className="pilot-studio__steps" aria-label="Ablauf im Pilotprojekt">
        <li data-done={selected ? "true" : undefined}>01 Entscheidung</li>
        <li data-done={locked ? "true" : undefined}>02 Kriterien sperren</li>
        <li data-done={imports.length ? "true" : undefined}>03 Messdaten</li>
        <li>04 Modellabgleich</li>
        <li data-done={assessments.length ? "true" : undefined}>05 Bewertung &amp; Paket</li>
      </ol>
      <p className="pilot-studio__note">
        Reihenfolge ist Methode: erst die Frage, dann die Grenzen, dann die Daten. PASS gibt es nur
        für einen unabhängigen Holdout-Datensatz mit vorher gesperrten Kriterien. Modellwerte im CSV
        sind zugelieferte Vergleichswerte, keine nachgewiesenen Simulator-Ausgaben. Kein PASS bei
        schlechter Datenqualität.
      </p>
      {error && (
        <p role="alert" className="pilot-studio__error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pilot-studio__notice">
          {notice}
        </p>
      )}
      <div className="pilot-studio__grid">
        <aside className="pilot-studio__card">
          <h3>01 · Entscheidung festhalten</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              Projektname
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="München / Vorfeldflotte"
              />
            </label>
            <label>
              Welche Entscheidung soll der Test ermöglichen?
              <textarea
                required
                maxLength={1000}
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                placeholder="Genügt der Anschluss für zusätzliche E-Busse, ohne Einsatzfristen zu verletzen?"
              />
            </label>
            <label>
              System- und Messgrenze
              <textarea
                required
                maxLength={1000}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="Abgang, Flotte, Zeitraum; Annahmen und Ausschlüsse"
              />
            </label>
            <label>
              Abnahmekriterien in Worten / noch abzustimmen
              <textarea
                required
                maxLength={2000}
                value={acceptance}
                onChange={(e) => setAcceptance(e.target.value)}
                placeholder="Mit Betreiber vereinbarte Leistungs-, Fehler- und Einsatzgrenzen"
              />
            </label>
            <button type="submit" disabled={busy}>
              Projekt anlegen
            </button>
          </form>
          <h3 className="pilot-studio__subhead">Vorhandene Projekte</h3>
          <div className="pilot-studio__list" aria-label="Pilotprojekte">
            {projects.length === 0 && <p>Noch keine Projekte.</p>}
            {projects.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                aria-pressed={selected?.id === p.id}
                onClick={() => {
                  setSelected(p);
                  setError("");
                  setNotice("");
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </aside>
        <div className="pilot-studio__flow">
          {!selected ? (
            <div className="pilot-studio__card">
              <h3>Mit einer echten Frage beginnen</h3>
              <p>
                Projekt links anlegen oder auswählen. Danach Abnahmekriterien sperren, Messdaten
                importieren, Abweichungen bewerten und die Originalquellen samt Prüfprotokoll
                exportieren.
              </p>
              <p>
                Für die Präsentation stehen explizit synthetische Beispieldaten bereit. Echte
                Flughafen- oder Lab-Daten erst in einer abgesicherten Kundeninstanz verwenden.
              </p>
            </div>
          ) : (
            <>
              <div className="pilot-studio__card">
                <h3>{selected.name}</h3>
                <p>{selected.decision}</p>
                <small>Projekt-ID: {selected.id}</small>
                <div className="pilot-studio__actions">
                  <a
                    className="pilot-studio__link"
                    href={url(`/pilot/projects/${selected.id}/package`)}
                  >
                    Testpaket herunterladen
                  </a>
                  <button onClick={report}>Entscheidungsbericht</button>
                  <a className="pilot-studio__link" href={url("/pilot/template.csv")}>
                    CSV-Vorlage
                  </a>
                </div>
              </div>

              <section
                className="pilot-studio__card pilot-studio__tolerances"
                data-locked={locked ? "true" : "false"}
                aria-labelledby="pilot-tolerances-title"
              >
                <h3 id="pilot-tolerances-title">
                  02 · Abnahmekriterien vorab festlegen und sperren
                </h3>
                <p>
                  Vor jedem Holdout-Import mit Betreiber und Lab vereinbaren. Gesperrte Kriterien
                  sind unveränderlich, gelten für alle Bewertungen dieses Projekts und werden mit
                  Hash ins Testpaket übernommen. Keine voreingestellten Erfolgsschwellen.
                </p>
                {locked && tolerances ? (
                  <div className="pilot-studio__locked" role="status">
                    <p>
                      <strong>Gesperrt</strong> seit{" "}
                      {new Date(tolerances.locked_at!).toLocaleString("de-DE")}
                    </p>
                    <dl>
                      <div>
                        <dt>Max. MAE</dt>
                        <dd>{number(tolerances.tolerances.mae_max_kw)} kW</dd>
                      </div>
                      <div>
                        <dt>Max. Energiefehler</dt>
                        <dd>{number(tolerances.tolerances.energy_error_max_pct)} %</dd>
                      </div>
                      <div>
                        <dt>Min. Messpunkte</dt>
                        <dd>{number(tolerances.tolerances.min_rows)}</dd>
                      </div>
                      <div>
                        <dt>Min. Abdeckung</dt>
                        <dd>{number(tolerances.tolerances.min_coverage_seconds / 3600)} h</dd>
                      </div>
                    </dl>
                    <small>
                      SHA256 der Kriterien: <code>{tolerances.sha256}</code>
                    </small>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveTolerances(true);
                    }}
                  >
                    <div className="pilot-studio__split">
                      <label>
                        Maximaler MAE (kW)
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          value={mae}
                          onChange={(e) => setMae(e.target.value)}
                        />
                      </label>
                      <label>
                        Maximaler absoluter Energiefehler (%)
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="any"
                          required
                          value={energy}
                          onChange={(e) => setEnergy(e.target.value)}
                        />
                      </label>
                      <label>
                        Mindestzahl Messpunkte
                        <input
                          type="number"
                          min="60"
                          step="1"
                          required
                          value={minRows}
                          onChange={(e) => setMinRows(e.target.value)}
                        />
                      </label>
                      <label>
                        Mindest-Zeitabdeckung (h)
                        <input
                          type="number"
                          min="1"
                          step="any"
                          required
                          value={minHours}
                          onChange={(e) => setMinHours(e.target.value)}
                        />
                      </label>
                    </div>
                    {tolerances && !locked && (
                      <p className="pilot-studio__hint">
                        Entwurf gespeichert (SHA256 <code>{tolerances.sha256.slice(0, 12)}…</code>
                        ), noch nicht gesperrt.
                      </p>
                    )}
                    <div className="pilot-studio__actions">
                      <button type="submit" disabled={busy || !tolerancesValid}>
                        Kriterien festlegen und sperren
                      </button>
                      <button
                        type="button"
                        disabled={busy || !tolerancesValid}
                        onClick={() => void saveTolerances(false)}
                      >
                        Als Entwurf speichern
                      </button>
                    </div>
                    <p className="pilot-studio__hint">
                      Grenzen: MAE &gt; 0, Energiefehler &gt; 0 und ≤ 50 %, mindestens 60 Punkte und
                      1 h. Der erste Holdout-Import sperrt einen Entwurf automatisch.
                    </p>
                  </form>
                )}
              </section>

              <section className="pilot-studio__card" aria-labelledby="pilot-import-title">
                <h3 id="pilot-import-title">03 · Messdaten importieren</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void upload();
                  }}
                >
                  <div className="pilot-studio__split">
                    <label>
                      Datensatz-Rolle
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as PilotImport["role"])}
                      >
                        <option value="calibration">Kalibrierung</option>
                        <option value="holdout">Unabhängiger Holdout</option>
                        <option value="lab">Lab-Messung</option>
                      </select>
                    </label>
                    <label>
                      CSV-Datei (max. 5 MB)
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        required
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                  {holdoutBlocked && (
                    <p className="pilot-studio__blocked" role="note">
                      Holdout-Import gesperrt: zuerst in Schritt 02 die Abnahmekriterien festlegen
                      und sperren.
                    </p>
                  )}
                  <label>
                    Messwert-Zeitbezug
                    <select value={semantics} onChange={(e) => setSemantics(e.target.value)}>
                      <option value="point_samples">Punktmessungen (CSV-Vergleich)</option>
                      <option value="interval_end_mean">
                        Minutenmittel am Intervallende (Run-Abgleich)
                      </option>
                    </select>
                  </label>
                  <label>
                    Messgrenze / Einheit kW
                    <input
                      required
                      value={boundary}
                      maxLength={1000}
                      onChange={(e) => setBoundary(e.target.value)}
                      placeholder="Netzbezug am Vorfeld-Abgang, Wirkleistung"
                    />
                  </label>
                  <label>
                    Quelle, Modellherkunft und Einschränkungen
                    <textarea
                      required
                      value={source}
                      maxLength={2000}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </label>
                  <div className="pilot-studio__actions">
                    <button type="submit" disabled={busy || !file || holdoutBlocked}>
                      Messdaten prüfen
                    </button>
                    <button type="button" disabled={busy} onClick={() => void upload(true)}>
                      Synthetisches Beispiel laden
                    </button>
                  </div>
                </form>
              </section>

              <section className="pilot-studio__card" aria-labelledby="pilot-replay-title">
                <h3 id="pilot-replay-title">04 · Gespeicherten Modelllauf zuordnen</h3>
                <p>
                  Nur abgeschlossene, integritätsgeprüfte gekoppelte Runs. Messgrenze muss fachlich
                  zur Größe passen. UTC-Zeitstempel müssen den gesamten Run minutengenau abdecken,
                  einschließlich Vor- und Nachlauf; keine Interpolation oder Zeitverschiebung.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void replay();
                  }}
                >
                  <label>
                    Originalmessung
                    <select
                      required
                      value={replaySource}
                      onChange={(e) => setReplaySource(e.target.value)}
                    >
                      <option value="">Messdatensatz wählen</option>
                      {imports
                        .filter(
                          (i) =>
                            i.quality.state === "valid" &&
                            i.sample_semantics === "interval_end_mean" &&
                            !i.source_import_id,
                        )
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="pilot-studio__split">
                    <label>
                      Gekoppelte Run-ID
                      <input
                        required
                        value={replayRun}
                        onChange={(e) => setReplayRun(e.target.value)}
                        maxLength={64}
                      />
                    </label>
                    <label>
                      Passende Modellgröße
                      <select
                        value={replayMetric}
                        onChange={(e) => setReplayMetric(e.target.value)}
                      >
                        <option value="grid_import_kw">Netzimport (kW)</option>
                        <option value="ground_charging_kw">Vorfeld-Ladeleistung (kW)</option>
                        <option value="parking_kw">Parkhaus-Ladeleistung (kW)</option>
                      </select>
                    </label>
                  </div>
                  <button type="submit" disabled={busy || !replaySource || !replayRun.trim()}>
                    Messung mit Run abgleichen
                  </button>
                </form>
              </section>

              <section className="pilot-studio__card" aria-labelledby="pilot-assess-title">
                <h3 id="pilot-assess-title">05 · Bewerten</h3>
                {!locked && (
                  <p className="pilot-studio__blocked" role="note">
                    Bewertung erst nach dem Sperren der Abnahmekriterien (Schritt 02).
                  </p>
                )}
                {imports.length === 0 && <p>Noch keine Messdaten importiert.</p>}
                <div className="pilot-studio__imports">
                  {imports.map((i) => {
                    const latest = assessmentsFor(i.id)[0];
                    const synthetic = i.filename === "synthetisches-beispiel.csv";
                    return (
                      <article className="pilot-studio__import" key={i.id}>
                        <div className="pilot-studio__import-head">
                          <strong>{i.filename}</strong>
                          {synthetic && <EvidenceBadge level="synthetic" />}
                          {i.role === "holdout" ? (
                            <span className="pilot-studio__role">Holdout</span>
                          ) : (
                            <span className="pilot-studio__role">
                              {i.role === "calibration" ? "Kalibrierung" : "Lab"} · kein PASS
                              möglich
                            </span>
                          )}
                        </div>
                        <small>
                          {i.quality.rows} Zeilen · Qualität:{" "}
                          {i.quality.state === "valid" ? "auswertbar" : "nicht auswertbar"} ·{" "}
                          {i.measurement_boundary}
                        </small>
                        <p>{i.source_note}</p>
                        {i.quality.issues.length > 0 && (
                          <ul>
                            {i.quality.issues.map((issue, n) => (
                              <li key={n}>{issueLabel(issue)}</li>
                            ))}
                          </ul>
                        )}
                        <dl>
                          <div>
                            <dt>MAE</dt>
                            <dd>{number(latest?.metrics.time_weighted_mae_kw)} kW</dd>
                          </div>
                          <div>
                            <dt>Bias</dt>
                            <dd>{number(latest?.metrics.time_weighted_bias_kw)} kW</dd>
                          </div>
                          <div>
                            <dt>Energiefehler</dt>
                            <dd>{number(latest?.metrics.energy_error_pct)} %</dd>
                          </div>
                        </dl>
                        <small className="mono">SHA256: {i.quality.sha256}</small>
                        <button disabled={busy || !locked} onClick={() => void assess(i)}>
                          Mit gesperrten Kriterien bewerten
                        </button>
                        {assessmentsFor(i.id).map((a) => (
                          <div
                            key={a.id}
                            className="pilot-studio__verdict"
                            data-status={a.validity_status}
                          >
                            <p>
                              <strong>{a.validity_status}</strong> ·{" "}
                              {statusLabel(a.validity_status)}
                            </p>
                            {a.not_evaluable_reasons.length > 0 && (
                              <ul aria-label="Gründe">
                                {a.not_evaluable_reasons.map((reason) => (
                                  <li key={reason}>
                                    {issueLabel(reason)} <code>{reason}</code>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <small>
                              MAE ≤ {number(a.thresholds.mae_max_kw)} kW · Energiefehler ≤{" "}
                              {number(a.thresholds.energy_error_max_pct)} %
                              {a.validity_status === "PASS" &&
                                " · nur dieser quantitative Vergleich, keine Gesamtvalidierung"}
                            </small>
                          </div>
                        ))}
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
