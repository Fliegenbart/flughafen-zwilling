/** c) Messreihe vom Flughafen einlesen, zum Abstimmen oder als Pruefmessung. */
import { useState, type FormEvent } from "react";
import { issueLabel } from "../../../shared/issues";
import { importMeasurement } from "../../api/data";
import { isExampleFile, type DataInputs } from "../../model/dataStatus";
import Link from "../../Link";
import type { Route } from "../../routes";
import { EXAMPLE_REFUSED, errorText, Format, Result, type FormProps } from "./shared";

type ProjectRoute = Extract<Route, { page: "projekt" }>;

export default function MeasurementForm({
  project,
  inputs,
  reload,
  disabled,
  route,
}: FormProps & {
  inputs: DataInputs;
  route: ProjectRoute;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState<"calibration" | "holdout">("calibration");
  const [semantics, setSemantics] = useState<"point_samples" | "interval_end_mean">(
    "point_samples",
  );
  const [boundary, setBoundary] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const locked = inputs.tolerances?.locked === true;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Keine Datei ausgewählt.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    if (!boundary.trim() || !source.trim())
      return setError("Ohne Messort und Herkunft lässt sich die Messreihe nicht einordnen.");
    setBusy(true);
    try {
      const result = await importMeasurement(project, {
        file,
        role,
        measurementBoundary: boundary,
        sourceNote: source,
        sampleSemantics: semantics,
      });
      if (result.valid)
        setOk(
          `${result.rows} Messwerte aus ${file.name} eingelesen, ${role === "holdout" ? "als Prüfmessung" : "zum Abstimmen des Modells"}.`,
        );
      else
        setError(
          `Die Messreihe ist nicht verwendbar und wird nur zur Nachvollziehbarkeit gespeichert. ${result.issues.map(issueLabel).join(" ")}`,
        );
      await reload();
    } catch (err) {
      setError(errorText(err, "Das Einlesen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format
        files={[["lastgang-BEISPIEL-erfundene-werte.csv", "Beispieldatei (erfundene Werte)"]]}
      >
        CSV (UTF-8) mit Kopfzeile <code>timestamp,measured_kw</code>, wahlweise dazu{" "}
        <code>model_kw</code>. Zeit mit Zeitzone (2026-10-04T08:00:00+02:00), Leistung in kW, in
        gleichen Abständen, höchstens 5 MB oder 100.000 Zeilen. Lücken nicht auffüllen. Doppelte,
        ungeordnete oder fehlende Zeitpunkte machen die Messreihe unbrauchbar.
      </Format>
      <p className="aec-notice" data-locked={locked ? "" : undefined}>
        {locked
          ? `Die Prüfgrenzen stehen fest (Fingerabdruck ${inputs.tolerances?.sha256?.slice(0, 12) ?? "–"}…).`
          : "Noch ist nicht festgelegt, wie weit Modell und Messung auseinanderliegen dürfen. Ohne diese Grenzen kann keine Prüfmessung das Modell bestätigen."}{" "}
        <Link to={{ page: "lab", projekt: route.projekt, werkstatt: "pilot" }}>
          Grenzen festlegen (Testing-Lab)
        </Link>
      </p>
      <form className="aec-dgrid" onSubmit={submit} aria-label="Messreihe einlesen">
        <label className="aec-dgrid__wide">
          Messreihe als CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Wofür ist die Messreihe?
          <select
            value={role}
            disabled={disabled || busy}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="calibration">zum Abstimmen des Modells</option>
            <option value="holdout">als Prüfmessung (Holdout)</option>
          </select>
        </label>
        <label>
          Was steht in jeder Zeile?
          <select
            value={semantics}
            disabled={disabled || busy}
            onChange={(e) => setSemantics(e.target.value as typeof semantics)}
          >
            <option value="point_samples">ein Messwert zu diesem Zeitpunkt</option>
            <option value="interval_end_mean">der Mittelwert der Minute davor</option>
          </select>
        </label>
        <label className="aec-dgrid__wide">
          Wo wurde gemessen?
          <input
            value={boundary}
            disabled={disabled || busy}
            placeholder="z. B. Trafo Vorfeld Süd, Abgang Ladepark"
            onChange={(e) => setBoundary(e.target.value)}
          />
        </label>
        <label className="aec-dgrid__wide">
          Woher stammen die Daten?
          <input
            value={source}
            disabled={disabled || busy}
            placeholder="z. B. Zählerexport FMG, Stand 01.10.2026"
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird geprüft …" : "Messreihe einlesen"}
        </button>
      </form>
      {inputs.imports.length ? (
        <ul className="aec-dlist" aria-label="Bisher eingelesene Messreihen">
          {inputs.imports.map((i) => (
            <li key={i.id} data-valid={i.valid ? "" : undefined}>
              <span>{i.filename}</span>
              <span>
                {i.role === "holdout" ? "Prüfmessung" : i.role === "lab" ? "Lab" : "zum Abstimmen"}
              </span>
              <span>
                {i.valid
                  ? `${i.rows} Messwerte`
                  : `nicht verwendbar: ${i.issues.map(issueLabel).join(" ")}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Result error={error} ok={ok} />
    </div>
  );
}
