import { useEffect, useState } from "react";
import { request, url } from "../munich/api";
import type { PilotAssessment, PilotImport, PilotProject } from "./types";
import { pilotReport } from "./report";
import { issueLabel } from "./issues";
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
    if (!selected) return;
    const controller = new AbortController();
    Promise.all([
      request<PilotImport[]>(`/pilot/projects/${selected.id}/imports`, {
        signal: controller.signal,
      }),
      request<PilotAssessment[]>(`/pilot/projects/${selected.id}/assessments`, {
        signal: controller.signal,
      }),
    ])
      .then(([i, a]) => {
        setImports(i);
        setAssessments(a);
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
      setNotice("Originalquelle und Qualitätsprüfung gespeichert.");
    });
  }
  async function assess(item: PilotImport) {
    if (!selected) return;
    await action(async () => {
      const a = await request<PilotAssessment>(`/pilot/projects/${selected.id}/assessments`, {
        method: "POST",
        body: JSON.stringify({
          import_id: item.id,
          mae_max_kw: Number(mae),
          energy_error_max_pct: Number(energy),
        }),
      });
      setAssessments((previous) => [a, ...previous]);
      setNotice("Bewertung mit diesen Schwellen gespeichert; kein Betriebsnachweis.");
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
  const thresholdsReady =
    mae.trim() !== "" &&
    energy.trim() !== "" &&
    Number.isFinite(Number(mae)) &&
    Number.isFinite(Number(energy)) &&
    Number(mae) >= 0 &&
    Number(energy) >= 0;
  return (
    <section className="pilot-studio" aria-labelledby="pilot-heading">
      <header className="pilot-studio__header">
        <div>
          <span className="pilot-studio__eyebrow">Vom Szenario zum überprüfbaren Versuch</span>
          <h2 id="pilot-heading">Pilot Decision Studio</h2>
          <p>
            Eine konkrete Flughafenentscheidung, dokumentierte Messgrenzen und ein übergebbares
            Testpaket. Keine neuen Einzelgerätetests statt eures TestingLabs.
          </p>
        </div>
        <span className="muc-tag">Read-only / Pilot</span>
      </header>
      <ol className="pilot-studio__steps">
        <li>01 Entscheidung</li>
        <li>02 Messdaten</li>
        <li>03 Modellabgleich</li>
        <li>04 TestingLab-Paket</li>
      </ol>
      <p className="pilot-studio__note">
        Modellwerte im CSV sind zugelieferte Vergleichswerte, nicht automatisch nachgewiesene
        Simulator-Ausgaben. Kalibrierung und Holdout müssen zeitlich getrennt sein. Kein PASS bei
        schlechter Datenqualität.
      </p>
      {error && (
        <p role="alert" className="pilot-studio__error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="pilot-studio__grid">
        <aside className="pilot-studio__card">
          <h3>Entscheidung festhalten</h3>
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
              Abnahmekriterien / noch abzustimmen
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
          <div className="pilot-studio__list" aria-label="Pilotprojekte">
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
        <div className="pilot-studio__card">
          {!selected ? (
            <>
              <h3>Mit einer echten Frage beginnen</h3>
              <p>
                Projekt links anlegen oder auswählen. Danach Messdaten importieren, Abweichungen
                beurteilen und die Originalquellen samt Prüfprotokoll exportieren.
              </p>
              <p>
                Für die Präsentation stehen explizit synthetische Beispieldaten bereit. Echte
                Flughafen- oder Lab-Daten erst in einer abgesicherten Kundeninstanz verwenden.
              </p>
            </>
          ) : (
            <>
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
                  <button type="submit" disabled={busy || !file}>
                    Messdaten prüfen
                  </button>
                  <button type="button" disabled={busy} onClick={() => void upload(true)}>
                    Synthetisches Beispiel laden
                  </button>
                </div>
              </form>
              <h3>Gespeicherten Modelllauf zuordnen</h3>
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
                  <select value={replayMetric} onChange={(e) => setReplayMetric(e.target.value)}>
                    <option value="grid_import_kw">Netzimport (kW)</option>
                    <option value="ground_charging_kw">Vorfeld-Ladeleistung (kW)</option>
                    <option value="parking_kw">Parkhaus-Ladeleistung (kW)</option>
                  </select>
                </label>
                <button type="submit" disabled={busy || !replaySource || !replayRun.trim()}>
                  Messung mit Run abgleichen
                </button>
              </form>
              <h3>Bewertungsgrenzen</h3>
              <p>
                Keine voreingestellten Erfolgsschwellen. Vor der Bewertung fachlich vereinbaren;
                jede Bewertung hält ihre Schwellen unverändert fest.
              </p>
              <div className="pilot-studio__split">
                <label>
                  Maximaler MAE (kW)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={mae}
                    onChange={(e) => setMae(e.target.value)}
                  />
                </label>
                <label>
                  Maximaler absoluter Energiefehler (%)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={energy}
                    onChange={(e) => setEnergy(e.target.value)}
                  />
                </label>
              </div>
              <div className="pilot-studio__imports">
                {imports.map((i) => (
                  <article className="pilot-studio__import" key={i.id}>
                    <strong>{i.filename}</strong>
                    <small>
                      {i.role} · {i.quality.rows} Zeilen · Qualität:{" "}
                      {i.quality.state === "valid" ? "auswertbar" : "nicht auswertbar"}
                    </small>
                    <small>{i.measurement_boundary}</small>
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
                        <dd>
                          {number(
                            assessments.find((a) => a.import_id === i.id)?.metrics
                              .time_weighted_mae_kw,
                          )}{" "}
                          kW
                        </dd>
                      </div>
                      <div>
                        <dt>Bias</dt>
                        <dd>
                          {number(
                            assessments.find((a) => a.import_id === i.id)?.metrics
                              .time_weighted_bias_kw,
                          )}{" "}
                          kW
                        </dd>
                      </div>
                      <div>
                        <dt>Energiefehler</dt>
                        <dd>
                          {number(
                            assessments.find((a) => a.import_id === i.id)?.metrics.energy_error_pct,
                          )}{" "}
                          %
                        </dd>
                      </div>
                    </dl>
                    <small>SHA256: {i.quality.sha256}</small>
                    <button disabled={busy || !thresholdsReady} onClick={() => void assess(i)}>
                      Mit diesen Grenzen bewerten
                    </button>
                    {assessments
                      .filter((a) => a.import_id === i.id)
                      .map((a) => (
                        <p key={a.id}>
                          <strong>{a.validity_status}</strong>
                          {a.not_evaluable_reasons.map(issueLabel).join("; ")} · MAE ≤{" "}
                          {number(a.thresholds.mae_max_kw)} kW · Energiefehler ≤{" "}
                          {number(a.thresholds.energy_error_max_pct)} %
                        </p>
                      ))}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
