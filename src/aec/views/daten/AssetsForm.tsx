/** b) Fahrzeuge und Anlagen: Werte mit Quelle eintragen oder als Datei hochladen. */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { importAssets, saveAssets, type AssetInput } from "../../api/data";
import { isExampleFile, type AssetField, type DataInputs } from "../../model/dataStatus";
import { EXAMPLE_REFUSED, errorText, Format, Result, type FormProps } from "./shared";

type Row = { value: string; source: string; date: string };

export default function AssetsForm({
  project,
  inputs,
  reload,
  disabled,
}: FormProps & { inputs: DataInputs }) {
  const fields: AssetField[] = useMemo(() => inputs.assets?.fields ?? [], [inputs.assets]);
  const initial = useMemo(() => {
    const rows: Record<string, Row> = {};
    for (const f of fields) {
      const e = inputs.assets?.entries.find((x) => x.key === f.key);
      rows[f.key] = e
        ? { value: String(e.value), source: e.source, date: e.sourceDate ?? "" }
        : {
            // Vorbelegung mit der Standardannahme; ohne Quelle bleibt sie "Annahme".
            value: !inputs.assets?.entries.length && f.default !== null ? String(f.default) : "",
            source: "",
            date: "",
          };
    }
    return rows;
  }, [fields, inputs.assets]);
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => setRows(initial), [initial]);

  const set = (key: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [key]: { ...r[key]!, ...patch } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    const entries: AssetInput[] = [];
    for (const f of fields) {
      const r = rows[f.key];
      if (!r || r.value.trim() === "") continue;
      const value = Number(r.value.replace(",", "."));
      if (!Number.isFinite(value))
        return setError(`„${f.label}“ braucht eine Zahl, eingetragen ist „${r.value}“.`);
      entries.push({
        key: f.key,
        value,
        unit: f.unit,
        source: r.source.trim(),
        source_date: r.date || null,
      });
    }
    setBusy(true);
    try {
      const saved = await saveAssets(project, entries);
      setOk(
        `${saved.entries.length} Werte gespeichert, ${saved.entries.filter((x) => x.status === "echt").length} davon mit Quelle. Sie gelten ab der nächsten Rechnung.`,
      );
      await reload();
    } catch (err) {
      setError(errorText(err, "Das Speichern hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Keine Datei ausgewählt.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    setBusy(true);
    try {
      const saved = await importAssets(project, file);
      setOk(
        `${saved.entries.length} Werte aus ${file.name} übernommen, die Originaldatei bleibt gespeichert.`,
      );
      await reload();
    } catch (err) {
      setError(errorText(err, "Das Einlesen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  const groups: { id: AssetField["group"]; title: string }[] = [
    { id: "anlagen", title: "Anschluss und Anlagen" },
    { id: "flotte", title: "Fahrzeuge und Ladepunkte" },
  ];
  return (
    <div className="aec-dform">
      <Format
        files={[
          ["flotte-anlagen-BEISPIEL.csv", "Beispieldatei CSV (erfundene Werte)"],
          ["flotte-anlagen-BEISPIEL.json", "Beispieldatei JSON (erfundene Werte)"],
        ]}
      >
        je Wert eine Zahl und ihre Quelle, etwa „Fuhrparkliste FMG, Stand 30.09.2026“. Als Datei
        geht auch CSV mit Kopfzeile <code>key,value,unit,source,source_date</code> (Komma oder
        Semikolon, Zeilen mit # sind Kommentare) oder JSON <code>{'{"entries": [...]}'}</code>.
        Einheiten kW/MW, kWh/MWh, kWp/MWp, Stück. MW wird in kW umgerechnet, die Originaldatei
        bleibt gespeichert.
      </Format>
      <p className="aec-fine">
        Ihre Werte ersetzen ab der nächsten Rechnung unsere Standardwerte. Bisherige Ergebnisse
        bleiben, wie sie sind.
      </p>
      <form onSubmit={submit} aria-label="Fahrzeuge und Anlagen eintragen" className="aec-assets">
        {groups.map((g) => (
          <fieldset key={g.id} className="aec-assets__group">
            <legend>{g.title}</legend>
            {fields
              .filter((f) => f.group === g.id)
              .map((f) => {
                const r = rows[f.key] ?? { value: "", source: "", date: "" };
                const state =
                  r.value.trim() === "" ? "leer" : r.source.trim() ? "belegt" : "Annahme";
                return (
                  <div key={f.key} className="aec-assets__row" data-state={state}>
                    <span className="aec-assets__label" id={`al-${f.key}`}>
                      {f.label}
                      <small>{state}</small>
                    </span>
                    <label className="aec-assets__value">
                      <span className="aec-visually-hidden">{f.label}: Wert</span>
                      <input
                        inputMode="decimal"
                        value={r.value}
                        disabled={disabled || busy}
                        placeholder="–"
                        onChange={(e) => set(f.key, { value: e.target.value })}
                      />
                      <span aria-hidden="true">{f.unit}</span>
                    </label>
                    <label>
                      <span className="aec-visually-hidden">{f.label}: woher</span>
                      <input
                        value={r.source}
                        disabled={disabled || busy}
                        placeholder="Woher stammt der Wert?"
                        onChange={(e) => set(f.key, { source: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="aec-visually-hidden">{f.label}: Stand</span>
                      <input
                        type="date"
                        value={r.date}
                        disabled={disabled || busy}
                        onChange={(e) => set(f.key, { date: e.target.value })}
                      />
                    </label>
                  </div>
                );
              })}
          </fieldset>
        ))}
        <button type="submit" className="aec-button" disabled={disabled || busy || !fields.length}>
          Speichern
        </button>
      </form>
      <form className="aec-dgrid" onSubmit={upload} aria-label="Fahrzeuge und Anlagen als Datei">
        <label className="aec-dgrid__wide">
          Oder alles als Datei hochladen (CSV oder JSON)
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="aec-button aec-button--ghost" disabled={disabled || busy}>
          Datei hochladen
        </button>
      </form>
      <Result error={error} ok={ok} />
    </div>
  );
}
