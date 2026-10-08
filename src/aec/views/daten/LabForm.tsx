/** d) Messung aus dem Testing-Lab (FlexLab-CSV) einlesen. */
import { useState, type FormEvent } from "react";
import { importLab } from "../../api/data";
import { isExampleFile } from "../../model/dataStatus";
import { unit } from "../../model/format";
import { EXAMPLE_REFUSED, errorText, Format, Result, type FormProps } from "./shared";

const LAB_CASES = [
  ["setpoint-step", "Sollwertsprung"],
  ["flex-reduction", "Flex-Reduktion"],
  ["power-cap", "Leistungsbegrenzung"],
  ["telemetry-loss", "Telemetrieausfall"],
] as const;

export default function LabForm({ project, reload, disabled }: FormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [caseId, setCaseId] = useState<string>("setpoint-step");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Keine Datei ausgewählt.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    setBusy(true);
    try {
      await importLab(project, file, label || file.name, caseId);
      setOk(`${file.name} eingelesen, die Auswertung läuft.`);
      await reload();
    } catch (err) {
      setError(errorText(err, "Das Einlesen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[["flexlab-BEISPIEL-erfundene-werte.csv", "Beispieldatei (erfundene Werte)"]]}>
        CSV mit Kopfzeile <code>ts_s,power_kw,setpoint_kw,limit_kw</code>: Sekunden seit
        Versuchsbeginn, aufsteigend, Leistungen in kW, höchstens {unit(5, "MB")} oder 100.000
        Messwerte. Ein leeres <code>power_kw</code> zählt als Lücke. Gelesen werden nur Messdaten,
        kein Gerät wird angesteuert.
      </Format>
      <form className="aec-dgrid" onSubmit={submit} aria-label="Lab-Messung einlesen">
        <label className="aec-dgrid__wide">
          Messung aus dem Lab (CSV)
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Welcher Versuch?
          <select
            value={caseId}
            disabled={disabled || busy}
            onChange={(e) => setCaseId(e.target.value)}
          >
            {LAB_CASES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Welches Gerät?
          <input
            value={label}
            maxLength={120}
            disabled={disabled || busy}
            placeholder="z. B. Bus-Ladepunkt 150 kW"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird eingelesen …" : "Lab-Messung einlesen"}
        </button>
      </form>
      <Result error={error} ok={ok} />
    </div>
  );
}
