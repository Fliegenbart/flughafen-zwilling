import { useEffect, useRef, useState } from "react";
import { request } from "../api/http";
import Link from "../Link";
import {
  compareCsv,
  downloadFile,
  exportCsv,
  MAX_BYTES,
  METRICS,
  type MeasurementComparison,
  type MeasurementProfile,
  type Metric,
} from "./measurementData";
import "./quickMeasurement.css";

type Run = { run_id: string; state: string; artifacts: string[]; end_ts?: string };
const number = (n: number | null) =>
  n === null ? "nicht definiert" : n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const date = (s: string) => new Date(s).toLocaleString("de-DE", { timeZone: "UTC" });

function Trace({
  profile,
  result,
}: {
  profile: MeasurementProfile;
  result: MeasurementComparison;
}) {
  const max = Math.max(1, result.model_peak_kw, result.measured_peak_kw);
  // Display bucket means only; all original minute values enter the statistics.
  const step = Math.ceil(profile.points.length / 240);
  function path(values: number[]) {
    const means = [];
    for (let i = 0; i < values.length; i += step) {
      const bucket = values.slice(i, i + step);
      means.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
    }
    return means
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${48 + (i / Math.max(1, means.length - 1)) * 620},${190 - (v / max) * 160}`,
      )
      .join(" ");
  }
  return (
    <figure className="qm-trace">
      <svg
        viewBox="0 0 700 225"
        role="img"
        aria-label="Leistungsverlauf: Modell blau, Messdatei orange"
      >
        <path d="M48,25V190H668" fill="none" stroke="#c9d8eb" />
        <text x="5" y="20">
          {number(max)} kW
        </text>
        <text x="15" y="194">
          0
        </text>
        <path
          d={path(profile.points.map((p) => p.model_kw))}
          fill="none"
          stroke="#3867df"
          strokeWidth="2"
        />
        <path d={path(result.measured)} fill="none" stroke="#b55518" strokeWidth="2" />
        <text x="48" y="215">
          Start
        </text>
        <text x="600" y="215">
          {number(result.hours)} h
        </text>
      </svg>
      <figcaption>
        <span>Blau: Simulation</span>
        <span>Orange: {result.synthetic ? "Übungsdatei" : "Messdatei"}</span>
        Kurve verdichtet; Kennzahlen verwenden alle Minutenwerte.
      </figcaption>
    </figure>
  );
}

export default function QuickMeasurementCheck({ initialRun }: { initialRun?: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState(initialRun ?? "");
  const [metric, setMetric] = useState<Metric>("grid_import_kw");
  const [profile, setProfile] = useState<MeasurementProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [candidate, setCandidate] = useState<MeasurementComparison | null>(null);
  const [result, setResult] = useState<MeasurementComparison | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function clearFile(resetInput = true) {
    sequence.current += 1;
    setCandidate(null);
    setResult(null);
    setFilename("");
    setConfirmed(false);
    setReading(false);
    if (resetInput && input.current) input.current.value = "";
  }
  useEffect(() => {
    if (initialRun) return;
    const ctrl = new AbortController();
    void request<Run[]>("/runs", { signal: ctrl.signal })
      .then((all) => {
        if (!ctrl.signal.aborted)
          setRuns(
            all.filter(
              (r) =>
                r.state === "completed" &&
                r.artifacts.some((a) => a.split(/[\\/]/).pop() === "coupled-evidence.json"),
            ),
          );
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(String(e.message));
      });
    return () => ctrl.abort();
  }, [initialRun]);
  useEffect(() => {
    clearFile();
    setProfile(null);
    setError("");
    setLoading(false);
    if (!run) return;
    const ctrl = new AbortController();
    setLoading(true);
    void request<MeasurementProfile>(
      `/runs/${encodeURIComponent(run)}/measurement-profile?metric=${metric}`,
      { signal: ctrl.signal },
    )
      .then((p) => {
        if (!ctrl.signal.aborted) setProfile(p);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(String(e.message));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => {
      ctrl.abort();
      sequence.current += 1;
    };
  }, [run, metric, revision]);

  async function choose(file: File | undefined) {
    clearFile(false);
    setError("");
    if (!file || !profile) return;
    const ticket = sequence.current;
    setFilename(file.name);
    setReading(true);
    try {
      if (file.size > MAX_BYTES) throw new Error("Die Datei ist größer als 5 MiB.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const parsed = compareCsv(text, profile);
      if (ticket === sequence.current) setCandidate(parsed);
    } catch (e) {
      if (ticket === sequence.current)
        setError(
          e instanceof TypeError
            ? "Die Datei muss UTF-8-kodiert sein."
            : e instanceof Error
              ? e.message
              : "Datei konnte nicht gelesen werden.",
        );
    } finally {
      if (ticket === sequence.current) setReading(false);
    }
  }
  function save(kind: "model" | "template" | "exercise") {
    if (!profile) return;
    const name =
      kind === "model"
        ? "lastprofil-simulation"
        : kind === "template"
          ? "messvorlage-LEER"
          : "uebung-SYNTHETISCH";
    downloadFile(exportCsv(profile, kind), `${name}-${metric}-${run.slice(0, 8)}.csv`);
  }
  return (
    <div className="qm">
      <header className="qm-head">
        <Link to={{ page: "start" }}>Zur Simulation</Link>
        <p className="qm-eyebrow">Simulation → Datei → Vergleich</p>
        <h1>
          Vom Lastprofil <br />
          <em>zum Messvergleich.</em>
        </h1>
        <p>
          Sehen Sie, wie weit Messwerte und Simulation auseinanderliegen. Ohne Projektformular, ohne
          Anlagensteuerung.
        </p>
        <span className="qm-privacy">
          Ihre Messdatei bleibt in diesem Browser. Kein Upload, keine Speicherung auf dem Server.
        </span>
      </header>
      <div className="qm-body">
        {!initialRun && (
          <label>
            Gespeicherte Simulation
            <select
              value={run}
              onChange={(e) => {
                clearFile();
                setProfile(null);
                setRun(e.target.value);
              }}
            >
              <option value="">Simulation auswählen</option>
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.end_ts ? date(r.end_ts) : "Abgeschlossen"} · {r.run_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Vergleichsgröße
          <select
            value={metric}
            onChange={(e) => {
              clearFile();
              setProfile(null);
              setMetric(e.target.value as Metric);
            }}
          >
            {Object.entries(METRICS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {loading && <p role="status">Simulationsnachweis wird geprüft …</p>}
        {error && (
          <div role="alert" className="qm-error">
            <strong>Kein Vergleich möglich.</strong> {error}
            {!profile && run && (
              <button onClick={() => setRevision((n) => n + 1)}>Profil erneut laden</button>
            )}
          </div>
        )}
        {!run && (
          <p>
            Starten Sie auf der Startseite einen Vergleich und wählen Sie „Lastprofil & Messdaten
            öffnen“.
          </p>
        )}
        {profile && (
          <>
            {profile.study && (
              <p className="qm-context">
                <strong>
                  {
                    {
                      direct: "Direkt laden",
                      managed: "Vorausschauend laden",
                      managed_storage: "Geplant + Speicher",
                    }[profile.study.solution]
                  }
                </strong>
                {" · "}
                {profile.study.electric_share_pct} % elektrisch ·{" "}
                {number(profile.study.grid_import_limit_kw)} kW Anschluss
              </p>
            )}
            <p className="qm-context">
              <strong>{profile.points.length.toLocaleString("de-DE")} Minutenwerte</strong> ·{" "}
              {number(profile.points.length / 60)} Stunden · kW
              <br />
              Minutenenden: {date(profile.points[0]!.timestamp)} bis{" "}
              {date(profile.points[profile.points.length - 1]!.timestamp)} UTC
            </p>
            <div className="qm-steps">
              <section aria-labelledby="qm-export">
                <span className="qm-step">01 / Exportieren</span>
                <h2 id="qm-export">Das Lastprofil mitnehmen.</h2>
                <p>
                  Berechnete Leistung der gewählten Variante am eingestellten Anschluss. Kein
                  Steuerbefehl und kein gemessener Verlauf.
                </p>
                <button className="qm-primary" onClick={() => save("model")}>
                  Lastprofil herunterladen
                </button>
                <button onClick={() => save("template")}>Leere Messvorlage herunterladen</button>
                <details>
                  <summary>Zum ersten Mal hier?</summary>
                  <p>
                    Die Übungsdatei enthält erfundene Werte: Modellleistung + 5 % + 1 kW. Damit
                    können Sie den Dateiablauf testen, nicht das Modell validieren.
                  </p>
                  <button onClick={() => save("exercise")}>Übungsdatei herunterladen</button>
                  <p>Danach rechts auswählen. Sie brauchen dafür keine Lab-Daten.</p>
                </details>
              </section>
              <section aria-labelledby="qm-import">
                <span className="qm-step">02 / Lokal auswählen</span>
                <h2 id="qm-import">Ihre Messdatei hinzufügen.</h2>
                <p>
                  CSV mit <code>timestamp,measured_kw</code>. UTC-Zeitraster wie links,
                  Dezimalpunkt, UTF-8. Minutenmittelwerte, keine Momentanwerte.
                </p>
                <label
                  className="qm-drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (input.current) input.current.value = "";
                    void choose(e.dataTransfer.files[0]);
                  }}
                >
                  <strong>CSV-Messdatei auswählen</strong>
                  <span>oder hier ablegen · maximal 5 MiB</span>
                  <input
                    ref={input}
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="CSV-Messdatei auswählen"
                    onChange={(e) => void choose(e.target.files?.[0])}
                  />
                </label>
                {reading && <p role="status">Datei wird lokal geprüft …</p>}
                {candidate && (
                  <p role="status">
                    {filename} · {candidate.measured.length} Werte
                    {candidate.synthetic
                      ? " · synthetische Übung"
                      : " · Herkunft nicht verifiziert"}
                  </p>
                )}
                <label className="qm-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => {
                      setConfirmed(e.target.checked);
                      setResult(null);
                    }}
                  />
                  Gleiche Messgrenze, Minutenmittelwerte in kW und passender Zeitraum. Bei der
                  Übungsdatei sind diese Bedingungen vorgegeben.
                </label>
                <button
                  className="qm-primary"
                  disabled={!candidate || !confirmed || reading}
                  onClick={() => setResult(candidate)}
                >
                  Messdaten vergleichen
                </button>
              </section>
            </div>
            <section className="qm-result" aria-labelledby="qm-result-title">
              <span className="qm-step">03 / Verstehen</span>
              <h2 id="qm-result-title">
                {result
                  ? result.synthetic
                    ? "Übungsvergleich, keine echten Messdaten"
                    : "Abweichungen Ihrer Datei"
                  : "Was passt, was weicht ab?"}
              </h2>
              {!result ? (
                <p>
                  Nach der Dateiauswahl erscheinen hier Leistungsverlauf, Energie und Abweichungen.
                  Es werden keine Ergebnisse erfunden.
                </p>
              ) : (
                <>
                  <p>
                    {result.synthetic
                      ? "Die Übungswerte sind aus der Simulation abgeleitet, kein unabhängiger Nachweis."
                      : "Lokale Diagnose. Die Herkunft der Datei und die Messbedingungen sind nicht unabhängig geprüft."}{" "}
                    Kein PASS und keine Validierung des Flughafenmodells.
                  </p>
                  <dl className="qm-stats">
                    <div>
                      <dt>Mittlere absolute Abweichung</dt>
                      <dd>{number(result.mae_kw)} kW</dd>
                      <small>Über alle Minutenwerte</small>
                    </div>
                    <div>
                      <dt>Energieabweichung</dt>
                      <dd>
                        {number(result.energy_error_pct)}
                        {result.energy_error_pct === null ? "" : " %"}
                      </dd>
                      <small>Bezogen auf die Energie der Datei</small>
                    </div>
                    <div>
                      <dt>Energiemenge der Datei{result.synthetic ? " (Übung)" : ""}</dt>
                      <dd>{number(result.measured_kwh)} kWh</dd>
                      <small>Modell: {number(result.model_kwh)} kWh</small>
                    </div>
                  </dl>
                  <Trace profile={profile} result={result} />
                  <p>
                    Leistungsspitzen: Modell {number(result.model_peak_kw)} kW · Datei{" "}
                    {number(result.measured_peak_kw)} kW. Mittlere gerichtete Abweichung (Modell −
                    Datei): {number(result.bias_kw)} kW.
                  </p>
                  {result.identical && (
                    <p className="qm-error">
                      Die Reihen sind praktisch identisch. Prüfen Sie die Herkunft: kopierte
                      Modellwerte sind kein unabhängiger Nachweis.
                    </p>
                  )}
                  <button
                    onClick={() =>
                      downloadFile(
                        JSON.stringify(
                          { kind: "local_diagnostic_not_validation", profile, filename, result },
                          null,
                          2,
                        ),
                        `lokaler-vergleich-${run.slice(0, 8)}.json`,
                        "application/json",
                      )
                    }
                  >
                    Lokalen Vergleich herunterladen
                  </button>
                </>
              )}
            </section>
            <details className="qm-audit">
              <summary>Berechnungsgrundlage & Dateiformat</summary>
              <p>
                Run-ID: <code>{run}</code>
                <br />
                Artefakt-SHA256: <code>{profile.provenance.artifact_sha256}</code>
              </p>
              <p>
                Simulation mit überprüfter Dateiintegrität, keine empirische Validierung. Jeder
                Zeitstempel bezeichnet das Ende einer Minute; der Wert ist deren mittlere
                Wirkleistung. Keine automatische Zeitverschiebung, Interpolation oder
                Einheitenumrechnung. Netzbezug ist nicht der gesamte Standortverbrauch.
              </p>
              <p>
                Lastprofil: timestamp,model_kw. Messvorlage: timestamp,measured_kw. Übung:
                zusätzlich data_kind=synthetic_exercise. Negative Werte werden für diese Bezugs- und
                Lademetriken nicht akzeptiert.
              </p>
              <button
                onClick={() =>
                  downloadFile(
                    JSON.stringify(profile, null, 2),
                    `profil-nachweis-${run.slice(0, 8)}.json`,
                    "application/json",
                  )
                }
              >
                Profilnachweis herunterladen
              </button>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
