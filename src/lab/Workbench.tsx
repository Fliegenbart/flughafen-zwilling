import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import "./Workbench.css";
import { EvidenceBadge } from "../ui/EvidenceBadge";
import { labRequest, labUrl } from "./api";
import RunEvidence from "./RunEvidence";
import { configError, restoreConfig } from "./config";
import {
  Field,
  format,
  Icon,
  SectionHeading,
  sourceName,
  stateNames,
  verdictNames,
} from "./components";
import type { Bench, CaseId, Catalog, Comparison, Criteria, LabRun, Sample } from "./types";

type View = "test" | "import" | "history" | "bench";
const nav: { id: View; label: string; icon: "pulse" | "upload" | "history" | "settings" }[] = [
  { id: "test", label: "Testlauf", icon: "pulse" },
  { id: "import", label: "Messdaten", icon: "upload" },
  { id: "history", label: "Historie", icon: "history" },
  { id: "bench", label: "Prüfstand", icon: "settings" },
];
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing may block persistence. */
  }
}

export default function Workbench() {
  const [view, setView] = useState<View>("test");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [caseId, setCaseId] = useState<CaseId>("setpoint-step");
  const [duration, setDuration] = useState(180);
  const [seed, setSeed] = useState(42);
  const [speed, setSpeed] = useState(20);
  const [label, setLabel] = useState("");
  const [history, setHistory] = useState<LabRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<LabRun | null>(null);
  const [trace, setTrace] = useState<Sample[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [baseline, setBaseline] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<string | null>(null);
  const restored = useRef(false);

  const selectRun = useCallback((id: string) => {
    selectionRef.current = id;
    setSelected(id);
    setRecord(null);
    setTrace([]);
    setComparison(null);
    setBaseline("");
    setCompareError(null);
    try {
      localStorage.setItem("flexlab:selected", id);
    } catch {
      /* Selection is optional. */
    }
  }, []);

  const connect = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [data, runs] = await Promise.all([
          labRequest<Catalog>("/catalog", { signal }),
          labRequest<LabRun[]>("/runs", { signal }),
        ]);
        if (signal?.aborted) return;
        setCatalog(data);
        setHistory(runs);
        setConnected(true);
        setError(null);
        setBench((current) => current ?? restoreConfig("flexlab:bench", data.default_bench));
        setCriteria(
          (current) => current ?? restoreConfig("flexlab:criteria", data.default_criteria),
        );
        if (!restored.current) {
          restored.current = true;
          let previous: string | null = null;
          try {
            previous = localStorage.getItem("flexlab:selected");
          } catch {
            /* Optional. */
          }
          const initial = runs.find((run) => run.run_id === previous) ?? runs[0];
          if (initial) selectRun(initial.run_id);
        }
      } catch (failure) {
        if (!signal?.aborted) {
          setConnected(false);
          setError(failure instanceof Error ? failure.message : "Backend nicht erreichbar");
        }
      }
    },
    [selectRun],
  );

  useEffect(() => {
    const controller = new AbortController();
    void connect(controller.signal);
    const interval = window.setInterval(() => {
      void connect(controller.signal);
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [connect]);

  useEffect(() => {
    if (bench) remember("flexlab:bench", bench);
  }, [bench]);
  useEffect(() => {
    if (criteria) remember("flexlab:criteria", criteria);
  }, [criteria]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        const [current, samples] = await Promise.all([
          labRequest<LabRun>(`/runs/${selected}`, { signal: controller.signal }),
          labRequest<Sample[]>(`/runs/${selected}/trace`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setRecord(current);
        setTrace(samples);
        setConnected(true);
        if (current.state === "queued" || current.state === "running")
          timer = window.setTimeout(() => {
            void poll();
          }, 600);
        else {
          const runs = await labRequest<LabRun[]>("/runs", { signal: controller.signal });
          if (!controller.signal.aborted) setHistory(runs);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Lauf nicht erreichbar");
          setConnected(false);
          timer = window.setTimeout(() => {
            void poll();
          }, 3000);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selected]);

  const currentCase = catalog?.cases.find((test) => test.id === caseId);
  const active = record?.state === "running" || record?.state === "queued";
  const invalidConfig = configError(bench, criteria);
  const canStart = connected && bench && criteria && !busy && !active && !invalidConfig;
  const preview = useMemo<Sample[]>(() => {
    if (!bench) return [];
    const low = Math.min(20, bench.max_power_kw * 0.2, bench.grid_limit_kw * 0.25);
    const high = Math.min(bench.max_power_kw * 0.7, bench.grid_limit_kw);
    return Array.from({ length: duration + 1 }, (_, ts_s) => {
      const limit_kw =
        caseId === "power-cap" && ts_s >= 30 ? bench.grid_limit_kw * 0.55 : bench.grid_limit_kw;
      const initial = caseId === "flex-reduction" || caseId === "power-cap" ? high : low;
      const setpoint_kw =
        ts_s < 30 ? initial : caseId === "flex-reduction" ? low : Math.min(high, limit_kw);
      return { ts_s, limit_kw, setpoint_kw, power_kw: null };
    });
  }, [bench, caseId, duration]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      const result = await labRequest<LabRun>("/runs", {
        method: "POST",
        body: JSON.stringify({
          case_id: caseId,
          bench,
          criteria,
          duration_s: duration,
          seed,
          playback_speed: speed,
          label,
        }),
      });
      selectRun(result.run_id);
      setRecord(result);
      setView("test");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const candidate = event.target.files?.[0];
    if (!candidate) return;
    setFile(null);
    setError(null);
    if (candidate.size > 5_000_000) {
      setError("CSV ist größer als 5 MB");
      return;
    }
    try {
      const content = await candidate.text();
      setFile({ name: candidate.name, content });
    } catch {
      setError("Datei konnte nicht gelesen werden");
    }
  }

  async function importCsv(event: FormEvent) {
    event.preventDefault();
    if (!file || !bench || !criteria || !connected || busy || invalidConfig) return;
    setBusy(true);
    setError(null);
    try {
      const result = await labRequest<LabRun>("/imports", {
        method: "POST",
        body: JSON.stringify({
          csv_text: file.content,
          filename: file.name,
          case_id: caseId,
          bench,
          criteria,
          label: label || file.name,
        }),
      });
      selectRun(result.run_id);
      setRecord(result);
      setFile(null);
      if (upload.current) upload.current.value = "";
      setView("test");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!record) return;
    try {
      setRecord(await labRequest<LabRun>(`/runs/${record.run_id}/cancel`, { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Abbruch fehlgeschlagen");
    }
  }

  async function compare(id: string) {
    setBaseline(id);
    setComparison(null);
    setCompareError(null);
    if (!record || !id) return;
    try {
      setComparison(
        await labRequest<Comparison>(
          `/compare?baseline_id=${encodeURIComponent(id)}&candidate_id=${encodeURIComponent(record.run_id)}`,
        ),
      );
    } catch (failure) {
      setCompareError(failure instanceof Error ? failure.message : "Vergleich fehlgeschlagen");
    }
  }

  function newTest() {
    selectionRef.current = null;
    setSelected(null);
    setRecord(null);
    setTrace([]);
    setComparison(null);
    setView("test");
    try {
      localStorage.removeItem("flexlab:selected");
    } catch {
      /* Optional. */
    }
  }
  const filteredHistory = history.filter((run) =>
    `${run.label} ${run.run_id} ${sourceName(run)}`.toLowerCase().includes(query.toLowerCase()),
  );
  const compatible = history.filter(
    (run) =>
      run.run_id !== record?.run_id &&
      run.state === "completed" &&
      run.comparison_key &&
      run.comparison_key === record?.comparison_key,
  );
  const configFields = (
    <>
      <label className="lab-field">
        <span>Testfall</span>
        <select value={caseId} onChange={(event) => setCaseId(event.target.value as CaseId)}>
          {catalog?.cases.map((test) => (
            <option key={test.id} value={test.id}>
              {test.name}
            </option>
          ))}
        </select>
      </label>
      <p className="lab-case-description">{currentCase?.description}</p>
      <label className="lab-field">
        <span>
          Bezeichnung <small>optional</small>
        </span>
        <input
          value={label}
          maxLength={120}
          placeholder="z. B. Charger 03 · Versuch 1"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
    </>
  );

  return (
    <div className="lab-shell">
      <aside className="lab-sidebar">
        <a className="lab-brand" href="/?workspace=flexlab">
          <span className="lab-brand-symbol">
            <Icon name="pulse" size={25} />
          </span>
          <span>
            FlexLab<small>TESTING WORKBENCH</small>
          </span>
        </a>
        <div className="lab-workspace-label">LOKALER ARBEITSPLATZ</div>
        <nav aria-label="Arbeitsbereiche">
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "lab-nav active" : "lab-nav"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.id === "history" && <span>{history.length}</span>}
            </button>
          ))}
        </nav>
        <div className="lab-sidebar-bottom">
          <div className="lab-readonly">
            <Icon name="shield" />
            <strong>Read-only by design</strong>
            <p>Kein Schreibzugriff auf reale Anlagen.</p>
          </div>
          <button className="lab-help" onClick={() => setShowHelp(!showHelp)}>
            Pilot-Anleitung <Icon name="arrow" size={15} />
          </button>
          <a className="lab-legacy" href="/?workspace=airport">
            Airport-Prototyp öffnen
          </a>
          <span className="lab-version">LOCAL EDITION / v1.0</span>
        </div>
      </aside>
      <main className="lab-main">
        <header className="lab-topbar">
          <span>
            TestingLab <span className="lab-slash">/</span>{" "}
            {nav.find((item) => item.id === view)?.label}
          </span>
          <div className="lab-top-status">
            <span className={`lab-dot ${connected ? "online" : "offline"}`} />
            {connected ? "Backend verbunden" : "Backend nicht verbunden"}
            <button
              className="lab-text-button"
              onClick={() => {
                void connect();
              }}
            >
              Neu prüfen
            </button>
          </div>
        </header>
        <div className="lab-page-header">
          <div>
            <p className="lab-eyebrow">FlexLab Workbench · Messdaten realer Komponenten</p>
            <h1>Hält die Komponente, was das Modell annimmt?</h1>
            <p>Lade- und Flexibilitätstests nachvollziehbar auswerten: Ist, Soll und Limit im Vergleich.</p>
          </div>
          <div className="lab-header-evidence">
            <EvidenceBadge level="empirical_open" label="Messdaten, read-only" />
            <div className="lab-source-badge">
              <Icon name="shield" size={15} />
              Keine Live-Anbindung
            </div>
          </div>
        </div>
        {invalidConfig && (
          <div className="lab-alert" role="alert">
            Konfiguration prüfen: {invalidConfig}
          </div>
        )}
        {error && (
          <div className="lab-alert" role="alert">
            <strong>Aktion nicht möglich.</strong> {error}
            <button aria-label="Fehlermeldung schließen" onClick={() => setError(null)}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {showHelp && (
          <section className="lab-help-panel">
            <SectionHeading number="?" title="In fünf Minuten zum ersten Ergebnis">
              <button className="lab-text-button" onClick={() => setShowHelp(false)}>
                Schließen
              </button>
            </SectionHeading>
            <ol>
              <li>Sollwertsprung wählen, Referenz-Prüfstand prüfen und Test starten.</li>
              <li>
                Ist, Soll und Limit vergleichen. „Abgeschlossen“ ist nicht gleich „Bestanden“.
              </li>
              <li>
                Unter Messdaten eigene CSV oder das ausdrücklich simulierte Beispiel importieren.
              </li>
              <li>
                Prüfkriterien und Datenabdeckung lesen. Mit gleichem Profil einen zweiten Test als
                Baseline vergleichen.
              </li>
              <li>
                HTML-Bericht, Record und Trace exportieren. Für eine echte Anlage zuerst deren Mess-
                und Sicherheitsgrenzen mit dem Lab festlegen.
              </li>
            </ol>
            <p>
              Nur lokal verwenden. Keine Geräteansteuerung; Simulation ist kein Hardware-Nachweis.
            </p>
          </section>
        )}

        {view === "test" && (
          <div className="lab-test-grid">
            <section className="lab-command-panel">
              <SectionHeading number="01" title="Testauftrag" />
              <form onSubmit={start}>
                {configFields}
                <div className="lab-two-fields">
                  <Field
                    label="Modellzeit"
                    value={duration}
                    onChange={setDuration}
                    min={caseId === "telemetry-loss" ? 90 : 60}
                    max={1800}
                    unit="s"
                  />
                  <Field label="Seed" value={seed} onChange={setSeed} unit="#" max={2147483647} />
                </div>
                <label className="lab-field">
                  <span>Wiedergabe</span>
                  <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                    <option value={1}>1× · Echtzeit-Simulation</option>
                    <option value={20}>20× · Beschleunigt</option>
                    <option value={100}>100× · Schnelldurchlauf</option>
                  </select>
                </label>
                <div className="lab-config-summary">
                  <span>PRÜFSTAND</span>
                  <strong>{bench?.name ?? "Wird geladen…"}</strong>
                  <p>
                    {format(bench?.max_power_kw, 0)} kW Nennleistung ·{" "}
                    {format(bench?.grid_limit_kw, 0)} kW Limit
                  </p>
                  <button
                    type="button"
                    className="lab-text-button"
                    onClick={() => setView("bench")}
                  >
                    Konfiguration & Kriterien <Icon name="arrow" size={14} />
                  </button>
                </div>
                <button className="lab-primary" disabled={!canStart} type="submit">
                  {busy ? "Wird angelegt…" : "Test starten"}
                  <Icon name="arrow" />
                </button>
                <p className="lab-footnote">
                  Nur SIL-Referenzmodell. Kein Befehl wird an ein Gerät gesendet.
                </p>
              </form>
              <div className="lab-command-footer">
                <span className="lab-mini-label">AUCH OHNE SIMULATION NUTZBAR</span>
                <button className="lab-import-shortcut" onClick={() => setView("import")}>
                  <Icon name="upload" />
                  Eigene Messdaten auswerten
                </button>
              </div>
            </section>
            <RunEvidence
              record={record}
              trace={trace}
              preview={preview}
              active={active}
              baseline={baseline}
              comparison={comparison}
              compareError={compareError}
              compatible={compatible}
              compare={compare}
              cancel={cancel}
              newTest={newTest}
            />
          </div>
        )}

        {view === "import" && (
          <section className="lab-import-panel">
            <SectionHeading number="01" title="Messdaten importieren" />
            <div className="lab-import-grid">
              <form onSubmit={importCsv}>
                {configFields}
                <label className="lab-upload-zone">
                  <Icon name="upload" size={32} />
                  <strong>{file?.name ?? "CSV-Datei auswählen"}</strong>
                  <span>Maximal 5 MB · Daten bleiben in der lokalen Installation</span>
                  <input
                    ref={upload}
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="CSV-Datei auswählen"
                    onChange={(event) => {
                      void readFile(event);
                    }}
                  />
                </label>
                <button
                  className="lab-primary"
                  disabled={!file || !connected || busy || !bench || !criteria || !!invalidConfig}
                  type="submit"
                >
                  {busy ? "Wird geprüft…" : "Messdaten auswerten"}
                  <Icon name="arrow" />
                </button>
              </form>
              <div className="lab-import-contract">
                <p className="lab-eyebrow">EXPLIZITER DATENVERTRAG</p>
                <h3>Vier Spalten. Eine klare Aussage.</h3>
                <code>ts_s,power_kw,setpoint_kw,limit_kw</code>
                <dl>
                  <dt>ts_s</dt>
                  <dd>Relative Zeit in Sekunden, strikt aufsteigend.</dd>
                  <dt>power_kw</dt>
                  <dd>Aufgezeichnete Ist-Leistung in kW. Leer = fehlender Messwert.</dd>
                  <dt>setpoint_kw</dt>
                  <dd>Tatsächlich aufgezeichneter, bereits begrenzter Sollwert in kW.</dd>
                  <dt>limit_kw</dt>
                  <dd>Gültige obere Leistungsgrenze in kW, linksgehalten.</dd>
                </dl>
                <p>
                  Komma oder Semikolon, Dezimalpunkt. Keine NaN-/Infinity-Werte. Positive Leistung =
                  Bezug; negative Leistung = Einspeisung. Der Import ist keine unabhängige
                  Bestätigung einer Hardwaremessung.
                </p>
                <div className="lab-inline-links">
                  <a href={labUrl("/template.csv")} download>
                    CSV-Vorlage <Icon name="download" size={14} />
                  </a>
                  <a href={labUrl("/example.csv")} download>
                    Simuliertes Beispiel <Icon name="download" size={14} />
                  </a>
                </div>
                <div className="lab-info-note">
                  <strong>Vor dem Import festlegen</strong>
                  <p>
                    Prüfstand und Kriterien gelten für diesen Import. Unter „Prüfstand“ Abtastrate,
                    Datenqualitätsgate und Toleranzen anpassen.
                  </p>
                  <button className="lab-text-button" onClick={() => setView("bench")}>
                    Kriterien prüfen <Icon name="arrow" size={14} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "history" && (
          <section className="lab-history-panel">
            <SectionHeading number="01" title="Testhistorie">
              <span className="lab-mono">{history.length} Läufe · Auto-Refresh 10 s</span>
            </SectionHeading>
            <label className="lab-search">
              <span>Läufe suchen</span>
              <input
                placeholder="Bezeichnung, Quelle oder Run-ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="lab-table-scroll">
              <table className="lab-table history">
                <thead>
                  <tr>
                    <th>Test / Run-ID</th>
                    <th>Quelle</th>
                    <th>Zeitpunkt</th>
                    <th>Ergebnis</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((run) => (
                    <tr key={run.run_id}>
                      <td>
                        <strong>{run.label}</strong>
                        <code>{run.run_id}</code>
                      </td>
                      <td>{sourceName(run)}</td>
                      <td>{new Date(run.created_ts).toLocaleString("de-DE")}</td>
                      <td>
                        <span className={`lab-badge ${run.analysis?.verdict ?? "neutral"}`}>
                          {run.analysis
                            ? verdictNames[run.analysis.verdict]
                            : stateNames[run.state]}
                        </span>
                      </td>
                      <td>
                        <button
                          className="lab-text-button"
                          onClick={() => {
                            selectRun(run.run_id);
                            setView("test");
                          }}
                        >
                          Öffnen <Icon name="arrow" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredHistory.length === 0 && (
              <div className="lab-empty">
                <Icon name="history" size={25} />
                <div>
                  <strong>Noch keine passenden Läufe</strong>
                  <p>
                    Simulationen und importierte Messdaten erscheinen hier dauerhaft mit ihrer
                    Run-ID.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {view === "bench" && bench && criteria && (
          <div className="lab-settings-grid">
            <section className="lab-settings-panel">
              <SectionHeading number="01" title="Prüfstandprofil" />
              <label className="lab-field">
                <span>Bezeichnung</span>
                <input
                  value={bench.name}
                  maxLength={100}
                  onChange={(event) => setBench({ ...bench, name: event.target.value })}
                />
              </label>
              <div className="lab-two-fields">
                <Field
                  label="Nennleistung"
                  value={bench.max_power_kw}
                  onChange={(value) => setBench({ ...bench, max_power_kw: value })}
                  min={1}
                  unit="kW"
                />
                <Field
                  label="Anschlusslimit"
                  value={bench.grid_limit_kw}
                  onChange={(value) => setBench({ ...bench, grid_limit_kw: value })}
                  min={1}
                  unit="kW"
                />
                <Field
                  label="Einspeise-Untergrenze"
                  value={bench.min_power_kw}
                  onChange={(value) => setBench({ ...bench, min_power_kw: value })}
                  min={-10000}
                  max={0}
                  unit="kW"
                />
              </div>
              <div className="lab-setting-divider">
                <h3>Nur für die Referenzsimulation</h3>
                <p>Keine Angaben über das Verhalten einer realen Anlage.</p>
              </div>
              <div className="lab-two-fields">
                <Field
                  label="Leistungsrampe"
                  value={bench.ramp_kw_per_s}
                  onChange={(value) => setBench({ ...bench, ramp_kw_per_s: value })}
                  min={0.1}
                  step={0.1}
                  unit="kW/s"
                />
                <Field
                  label="Antwortverzögerung"
                  value={bench.response_delay_s}
                  onChange={(value) => setBench({ ...bench, response_delay_s: value })}
                  max={120}
                  unit="s"
                />
                <Field
                  label="Messrauschen (±)"
                  value={bench.noise_kw}
                  onChange={(value) => setBench({ ...bench, noise_kw: value })}
                  max={5}
                  step={0.05}
                  unit="kW"
                />
              </div>
              <div className="lab-info-note">
                <strong>Lokal gespeichert, pro Lauf eingefroren.</strong>
                <p>
                  Änderungen gelten nur für neue Tests. Bereits erstellte Records behalten ihr
                  ursprüngliches Profil.
                </p>
              </div>
            </section>
            <section className="lab-settings-panel">
              <SectionHeading number="02" title="Akzeptanzkriterien" />
              <div className="lab-two-fields">
                <Field
                  label="Leistungstoleranz"
                  value={criteria.tolerance_kw}
                  onChange={(value) => setCriteria({ ...criteria, tolerance_kw: value })}
                  max={100}
                  step={0.1}
                  unit="kW"
                />
                <Field
                  label="Max. Sollabweichung (MAE)"
                  value={criteria.tracking_mae_max_kw}
                  onChange={(value) => setCriteria({ ...criteria, tracking_mae_max_kw: value })}
                  max={100}
                  step={0.1}
                  unit="kW"
                />
                <Field
                  label="Max. Reaktionszeit"
                  value={criteria.response_max_s}
                  onChange={(value) => setCriteria({ ...criteria, response_max_s: value })}
                  min={1}
                  max={300}
                  unit="s"
                />
                <Field
                  label="Stabilitätsfenster"
                  value={criteria.settling_s}
                  onChange={(value) => setCriteria({ ...criteria, settling_s: value })}
                  min={1}
                  max={60}
                  unit="s"
                />
                <Field
                  label="Einschwingfrist für MAE"
                  value={criteria.grace_s}
                  onChange={(value) => setCriteria({ ...criteria, grace_s: value })}
                  max={300}
                  unit="s"
                />
                <Field
                  label="Limitverletzung erlaubt"
                  value={criteria.limit_violation_budget_s}
                  onChange={(value) =>
                    setCriteria({ ...criteria, limit_violation_budget_s: value })
                  }
                  max={300}
                  step={0.1}
                  unit="s"
                />
              </div>
              <div className="lab-setting-divider">
                <h3>Datenqualität vor PASS/FAIL</h3>
                <p>Unzureichende Abdeckung führt zu „Nicht bewertbar“.</p>
              </div>
              <div className="lab-two-fields">
                <Field
                  label="Min. Zeitabdeckung"
                  value={criteria.min_coverage_pct}
                  onChange={(value) => setCriteria({ ...criteria, min_coverage_pct: value })}
                  min={90}
                  max={100}
                  unit="%"
                />
                <Field
                  label="Erwartetes Messintervall"
                  value={criteria.expected_interval_s}
                  onChange={(value) => setCriteria({ ...criteria, expected_interval_s: value })}
                  min={0.01}
                  max={1000}
                  step={0.1}
                  unit="s"
                />
                <Field
                  label="Max. gültige Zeitlücke"
                  value={criteria.max_gap_s}
                  onChange={(value) => setCriteria({ ...criteria, max_gap_s: value })}
                  min={criteria.expected_interval_s}
                  max={Math.min(300, 10 * criteria.expected_interval_s)}
                  step={0.1}
                  unit="s"
                />
              </div>
              <button
                className="lab-secondary"
                onClick={() => {
                  if (catalog) {
                    setBench(catalog.default_bench);
                    setCriteria(catalog.default_criteria);
                  }
                }}
              >
                Referenzwerte zurücksetzen
              </button>
              <button className="lab-primary" onClick={() => setView("test")}>
                Zum Testauftrag <Icon name="arrow" />
              </button>
            </section>
          </div>
        )}
        <footer className="lab-footer">
          <span>
            <Icon name="shield" size={13} />
            Lokale Auswertung · Keine automatische Anlagensteuerung
          </span>
          <a
            href={`${labUrl("").replace("/api/v1/lab", "")}/docs`}
            target="_blank"
            rel="noreferrer"
          >
            API-Dokumentation <Icon name="arrow" size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
