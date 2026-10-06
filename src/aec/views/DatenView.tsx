import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { EvidenceBadge, type EvidenceLevel } from "../../ui/EvidenceBadge";
import { issueLabel } from "../../pilot/issues";
import { request as munichRequest } from "../../munich/api";
import type { FlightPlanInfo, FlightPlanSnapshot } from "../../munich/flightplanTypes";
import {
  importAssets,
  importLab,
  importMeasurement,
  linkFlightPlan,
  saveAssets,
  type AssetInput,
} from "../dataApi";
import {
  deDate,
  importError,
  isExampleFile,
  STATE_LABEL,
  type AssetField,
  type DataInputs,
  type DataItem,
  type DataItemId,
  type DataStatus,
} from "../dataStatus";
import Link from "../Link";
import { AnswerHead, Details } from "../parts";
import type { Route } from "../routes";
import type { Project } from "../types";

type ProjectRoute = Extract<Route, { page: "projekt" }>;
export type DatenProps = {
  project: Project;
  inputs: DataInputs;
  status: DataStatus;
  reload: () => Promise<void>;
  route: ProjectRoute;
};

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
const example = (file: string) => `${BASE}beispiele/${file}`;
const FLIGHT_PLAN_SOURCE = "https://www.munich-airport.de/saisonflugplan";

/** Warnhinweis an, solange die Runtime-Konfiguration ihn nicht ausdruecklich abschaltet. */
export function sharedDemoNotice(): boolean {
  return globalThis.__TWIN_CONFIG__?.sharedDemoNotice !== false;
}

const EXAMPLE_REFUSED =
  "Das ist eine Beispieldatei mit erfundenen Werten. Bitte die echte Datei des Projekts wählen.";

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? importError(e.message) : fallback;
}

/* ---------------------------------------------------------------- Bausteine */

function StateChip({ state }: { state: DataItem["state"] }) {
  return (
    <span className="aec-dstate" data-state={state}>
      <i aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

function Format({ children, files }: { children: ReactNode; files: [string, string][] }) {
  return (
    <div className="aec-dformat">
      <p>
        <strong>Format.</strong> {children}
      </p>
      {files.length ? (
        <p className="aec-dformat__files">
          {files.map(([file, label]) => (
            <a key={file} href={example(file)} download className="aec-dlink">
              {label}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function Result({ error, ok }: { error: string; ok: string }) {
  return (
    <>
      <p className="aec-derror" role="alert" hidden={!error}>
        {error}
      </p>
      <p className="aec-dok" role="status">
        {ok}
      </p>
    </>
  );
}

function DataCard({
  item,
  index,
  children,
}: {
  item: DataItem;
  index: number;
  children: ReactNode;
}) {
  const id = `daten-${item.id}`;
  // Nur der Anfangszustand haengt am Status: nach einem Import bleibt der Abschnitt offen,
  // damit die Erfolgsmeldung sichtbar bleibt.
  const [initiallyOpen] = useState(item.state !== "echt");
  return (
    <li className="aec-dcard" data-state={item.state} aria-labelledby={id} id={`punkt-${item.id}`}>
      <header className="aec-dcard__head">
        <span className="aec-dcard__no" aria-hidden="true">
          {String.fromCharCode(97 + index)}
        </span>
        <h2 id={id}>{item.title}</h2>
        <StateChip state={item.state} />
        <EvidenceBadge level={item.evidence} detail={item.evidenceDetail} />
      </header>
      <dl className="aec-dcard__facts">
        <div>
          <dt>Quelle</dt>
          <dd>{item.source ?? "keine"}</dd>
        </div>
        <div>
          <dt>Datum</dt>
          <dd>{item.date ?? "–"}</dd>
        </div>
      </dl>
      <p className="aec-dcard__detail">{item.detail}</p>
      {item.warnings.length ? (
        <ul className="aec-dcard__warn">
          {item.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <Details
        summary={item.state === "echt" ? "Daten ergänzen oder ersetzen" : "Daten eintragen"}
        open={initiallyOpen}
      >
        {children}
      </Details>
    </li>
  );
}

/* ---------------------------------------------------------------- a) Flugplan */

function FlightPlanForm({ project, reload, disabled }: FormProps) {
  const [plans, setPlans] = useState<FlightPlanInfo[]>([]);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
  );
  const [file, setFile] = useState<File | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    void munichRequest<FlightPlanInfo[]>("/munich/flight-plans")
      .then((list) => alive && setPlans(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [disabled]);

  async function link(plan: FlightPlanInfo, imported: boolean) {
    await linkFlightPlan(project, plan.snapshot_id);
    const groups = plan.possible_shared_flight_groups;
    setOk(
      `${imported ? "Flugplan importiert und" : "Flugplan"} mit dem Projekt verknüpft: Verkehrstag ${deDate(plan.service_date)}, ${plan.departure_entry_count} Abflugeinträge.${
        groups
          ? ` Achtung: ${groups} ungeklärte Mehrfachgruppen. Bitte in der Werkstatt prüfen.`
          : " Keine ungeklärten Mehrfachgruppen."
      }`,
    );
    await reload();
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Bitte das PDF des Flugplans auswählen.");
    if (!/\.pdf$/i.test(file.name) || file.size > 6 * 1024 * 1024)
      return setError("Bitte eine PDF-Datei mit höchstens 6 MiB wählen.");
    if (!date) return setError("Bitte den Verkehrstag wählen.");
    setBusy(true);
    try {
      const plan = await munichRequest<FlightPlanSnapshot>(
        `/munich/flight-plans?service_date=${encodeURIComponent(date)}`,
        { method: "POST", body: file, headers: { "Content-Type": "application/pdf" } },
        45000,
      );
      await link(plan, true);
    } catch (err) {
      setError(flightPlanError(errorText(err, "Import fehlgeschlagen.")));
    } finally {
      setBusy(false);
    }
  }

  async function choose(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    const plan = plans.find((p) => p.snapshot_id === pick);
    if (!plan) return setError("Bitte einen importierten Flugplan wählen.");
    setBusy(true);
    try {
      await link(plan, false);
    } catch (err) {
      setError(errorText(err, "Verknüpfen fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[]}>
        PDF des offiziellen Saisonflugplans (
        <a href={FLIGHT_PLAN_SOURCE} target="_blank" rel="noreferrer">
          munich-airport.de/saisonflugplan
        </a>
        ), höchstens 6 MiB, dazu der Verkehrstag im Geltungsbereich. Gelesen werden Planzeiten,
        keine Ist-Bewegungen. Mögliche Codeshares (Mehrfachgruppen) werden markiert, nicht
        zusammengelegt. Keine Beispieldatei: es wird nur das offizielle PDF gelesen.
      </Format>
      <form className="aec-dgrid" onSubmit={upload} aria-label="Flugplan-PDF importieren">
        <label>
          Verkehrstag
          <input
            type="date"
            value={date}
            required
            disabled={disabled || busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="aec-dgrid__wide">
          Flugplan-PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird gelesen…" : "PDF importieren"}
        </button>
      </form>
      {plans.length ? (
        <form className="aec-dgrid" onSubmit={choose} aria-label="Importierten Flugplan verknüpfen">
          <label className="aec-dgrid__wide">
            Oder bereits importierten Flugplan verknüpfen
            <select
              value={pick}
              disabled={disabled || busy}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Flugplan wählen…</option>
              {plans.map((p) => (
                <option key={p.snapshot_id} value={p.snapshot_id}>
                  {deDate(p.service_date)} · Stand {deDate(p.source_data_date)} ·{" "}
                  {p.departure_entry_count} Abflüge
                  {p.possible_shared_flight_groups
                    ? ` · ${p.possible_shared_flight_groups} Mehrfachgruppen`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="aec-button aec-button--ghost"
            disabled={disabled || busy}
          >
            Verknüpfen
          </button>
        </form>
      ) : null}
      <Result error={error} ok={ok} />
    </div>
  );
}

/** Flugplan-Backend meldet teils englisch bzw. ohne Umlaute; hier in klare Saetze. */
export function flightPlanError(detail: string): string {
  if (/application\/pdf/.test(detail)) return "Bitte eine PDF-Datei hochladen.";
  if (/laeuft bereits/.test(detail))
    return "Es läuft bereits ein Flugplan-Import. Bitte kurz warten.";
  if (/Zeitlimit/.test(detail)) return "Der Upload hat zu lange gedauert. Bitte erneut versuchen.";
  if (/6 MiB/.test(detail)) return "Das PDF ist größer als 6 MiB.";
  if (/^API-Fehler 422|Layout|layout|unlesbar|Flugzeile/i.test(detail))
    return `Das PDF ließ sich nicht als Saisonflugplan lesen. ${detail.startsWith("API-Fehler") ? "" : detail}`.trim();
  return detail;
}

/* ------------------------------------------------------ b) Flotte und Anlagen */

type Row = { value: string; source: string; date: string };

function AssetsForm({ project, inputs, reload, disabled }: FormProps & { inputs: DataInputs }) {
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
      if (!Number.isFinite(value)) return setError(`„${f.label}“: „${r.value}“ ist keine Zahl.`);
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
        `${saved.entries.length} Werte gespeichert, ${saved.entries.filter((x) => x.status === "echt").length} davon mit Quelle. Sie gelten ab dem nächsten Variantenlauf.`,
      );
      await reload();
    } catch (err) {
      setError(errorText(err, "Speichern fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Bitte eine CSV- oder JSON-Datei wählen.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    setBusy(true);
    try {
      const saved = await importAssets(project, file);
      setOk(
        `${file.name}: ${saved.entries.length} Werte übernommen. Original mit SHA256 gespeichert.`,
      );
      await reload();
    } catch (err) {
      setError(errorText(err, "Import fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  const groups: { id: AssetField["group"]; title: string }[] = [
    { id: "anlagen", title: "Anlagen" },
    { id: "flotte", title: "Flotte je Klasse" },
  ];
  return (
    <div className="aec-dform">
      <Format
        files={[
          ["flotte-anlagen-BEISPIEL.csv", "Beispiel-CSV (erfundene Werte)"],
          ["flotte-anlagen-BEISPIEL.json", "Beispiel-JSON (erfundene Werte)"],
        ]}
      >
        Je Wert eine Zahl in der genannten Einheit und die Quelle (z. B. „Fuhrparkliste FMG, Stand
        30.09.2026“). Ohne Quelle bleibt ein Wert eine Annahme. Als Datei: CSV mit Kopfzeile{" "}
        <code>key,value,unit,source,source_date</code> (Komma oder Semikolon, Zeilen mit # sind
        Kommentare) oder JSON <code>{'{"entries": [...]}'}</code>. Einheiten kW/MW, kWh/MWh,
        kWp/MWp, Stück; MW wird in kW umgerechnet, das Original bleibt erhalten.
      </Format>
      <p className="aec-fine">
        Wirkung: Die Werte ersetzen in der Varianten-Basis dieses Projekts die Standardannahmen
        (gekoppelte Läufe ab dem nächsten Variantenlauf). Nicht genannte Modellparameter bleiben
        Annahmen; bereits gerechnete Läufe bleiben unverändert.
      </p>
      <form onSubmit={submit} aria-label="Flotte und Anlagen eintragen" className="aec-assets">
        {groups.map((g) => (
          <fieldset key={g.id} className="aec-assets__group">
            <legend>{g.title}</legend>
            {fields
              .filter((f) => f.group === g.id)
              .map((f) => {
                const r = rows[f.key] ?? { value: "", source: "", date: "" };
                const state = r.value.trim() === "" ? "leer" : r.source.trim() ? "echt" : "Annahme";
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
                      <span className="aec-visually-hidden">{f.label}: Quelle</span>
                      <input
                        value={r.source}
                        disabled={disabled || busy}
                        placeholder="Quelle"
                        onChange={(e) => set(f.key, { source: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="aec-visually-hidden">{f.label}: Datum der Quelle</span>
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
          Werte speichern
        </button>
      </form>
      <form className="aec-dgrid" onSubmit={upload} aria-label="Flotte und Anlagen als Datei">
        <label className="aec-dgrid__wide">
          Oder Datei hochladen (CSV/JSON)
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="aec-button aec-button--ghost" disabled={disabled || busy}>
          Datei importieren
        </button>
      </form>
      <Result error={error} ok={ok} />
    </div>
  );
}

/* -------------------------------------------------------- c) Messdaten Flughafen */

function MeasurementForm({
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
    if (!file) return setError("Bitte die Lastgang-CSV wählen.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    if (!boundary.trim() || !source.trim())
      return setError(
        "Bitte Messgrenze und Quelle angeben. Ohne sie ist der Lastgang nicht einzuordnen.",
      );
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
          `${file.name}: ${result.rows} Messpunkte als ${role === "holdout" ? "Holdout" : "Kalibrierung"} importiert.`,
        );
      else
        setError(
          `Import abgewiesen und als nicht auswertbar gespeichert: ${result.issues.map(issueLabel).join(" ")}`,
        );
      await reload();
    } catch (err) {
      setError(errorText(err, "Import fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[["lastgang-BEISPIEL-erfundene-werte.csv", "Beispiel-CSV (erfundene Werte)"]]}>
        UTF-8-CSV mit Kopfzeile <code>timestamp,measured_kw</code>, optional <code>model_kw</code>.
        Zeitstempel im ISO-Format mit Zeitzone (2026-10-04T08:00:00+02:00), Wirkleistung in kW,
        gleichmäßige Abstände, höchstens 5 MiB bzw. 100.000 Zeilen. Lücken nicht auffüllen,
        Vorzeichen dokumentieren. Doppelte, nicht aufsteigende oder fehlende Werte sperren die
        Bewertung.
      </Format>
      <p className="aec-notice" data-locked={locked ? "" : undefined}>
        {locked
          ? `Abnahmekriterien vorab gesperrt (SHA256 ${inputs.tolerances?.sha256?.slice(0, 12) ?? "–"}…). Ein Holdout wird gegen diese Grenzen bewertet.`
          : "Abnahmekriterien sind noch nicht gesperrt. Ein Holdout kann nur PASS ergeben, wenn die Kriterien vorher feststehen; der erste Holdout-Import sperrt einen gespeicherten Entwurf automatisch. Kalibrierdaten ergeben nie PASS."}{" "}
        <Link to={{ page: "lab", projekt: route.projekt, werkstatt: "pilot" }}>
          Kriterien im Messdaten-Abgleich festlegen
        </Link>
      </p>
      <form className="aec-dgrid" onSubmit={submit} aria-label="Lastgang importieren">
        <label className="aec-dgrid__wide">
          Lastgang-CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Verwendung
          <select
            value={role}
            disabled={disabled || busy}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="calibration">Kalibrierung</option>
            <option value="holdout">Holdout (unabhängige Prüfung)</option>
          </select>
        </label>
        <label>
          Zeitbezug
          <select
            value={semantics}
            disabled={disabled || busy}
            onChange={(e) => setSemantics(e.target.value as typeof semantics)}
          >
            <option value="point_samples">Punktmessung</option>
            <option value="interval_end_mean">Minutenmittel am Intervallende</option>
          </select>
        </label>
        <label className="aec-dgrid__wide">
          Messgrenze
          <input
            value={boundary}
            disabled={disabled || busy}
            placeholder="z. B. Trafo Vorfeld Süd, Abgang Ladepark"
            onChange={(e) => setBoundary(e.target.value)}
          />
        </label>
        <label className="aec-dgrid__wide">
          Quelle
          <input
            value={source}
            disabled={disabled || busy}
            placeholder="z. B. Zählerexport FMG, Stand 01.10.2026"
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird geprüft…" : "Lastgang importieren"}
        </button>
      </form>
      {inputs.imports.length ? (
        <ul className="aec-dlist" aria-label="Bisherige Messdaten-Importe">
          {inputs.imports.map((i) => (
            <li key={i.id} data-valid={i.valid ? "" : undefined}>
              <span>{i.filename}</span>
              <span>
                {i.role === "holdout" ? "Holdout" : i.role === "lab" ? "Lab" : "Kalibrierung"}
              </span>
              <span>
                {i.valid ? `${i.rows} Punkte` : `abgewiesen: ${i.issues.map(issueLabel).join(" ")}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Result error={error} ok={ok} />
    </div>
  );
}

/* ---------------------------------------------------------------- d) Lab */

const LAB_CASES = [
  ["setpoint-step", "Sollwertsprung"],
  ["flex-reduction", "Flex-Reduktion"],
  ["power-cap", "Leistungsbegrenzung"],
  ["telemetry-loss", "Telemetrieausfall"],
] as const;

function LabForm({ project, reload, disabled }: FormProps) {
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
    if (!file) return setError("Bitte die FlexLab-CSV wählen.");
    if (isExampleFile(file.name)) return setError(EXAMPLE_REFUSED);
    setBusy(true);
    try {
      await importLab(project, file, label || file.name, caseId);
      setOk(`${file.name} importiert und mit dem Projekt verknüpft. Die Auswertung läuft.`);
      await reload();
    } catch (err) {
      setError(errorText(err, "Import fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[["flexlab-BEISPIEL-erfundene-werte.csv", "Beispiel-CSV (erfundene Werte)"]]}>
        CSV mit Kopfzeile <code>ts_s,power_kw,setpoint_kw,limit_kw</code>: Zeit in Sekunden ab
        Versuchsbeginn, strikt aufsteigend, Leistungen in kW; höchstens 5 MB bzw. 100.000
        Messpunkte. Leere <code>power_kw</code> gelten als Messlücke. Nur Messdaten, keine
        Ansteuerung von Hardware.
      </Format>
      <form className="aec-dgrid" onSubmit={submit} aria-label="Lab-Messung importieren">
        <label className="aec-dgrid__wide">
          FlexLab-CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Prüffall
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
          Bezeichnung
          <input
            value={label}
            maxLength={120}
            disabled={disabled || busy}
            placeholder="z. B. Bus-Ladepunkt 150 kW"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird importiert…" : "Lab-Messung importieren"}
        </button>
      </form>
      <Result error={error} ok={ok} />
    </div>
  );
}

/* ---------------------------------------------------------------- Ansicht */

type FormProps = { project: Project; reload: () => Promise<void>; disabled: boolean };

const BEST: EvidenceLevel[] = ["empirical_passed", "empirical_open", "model_checked", "synthetic"];

export const FOCUS_KEY = "aec.focusData";

export default function DatenView({ project, inputs, status, reload, route }: DatenProps) {
  const disabled = !inputs.available;
  useEffect(() => {
    // Nach "Projekt anlegen": Abschnitt Flotte und Anlagen öffnen und fokussieren.
    let target: string | null = null;
    try {
      target = sessionStorage.getItem(FOCUS_KEY);
      sessionStorage.removeItem(FOCUS_KEY);
    } catch {
      /* ohne Sitzungsspeicher */
    }
    if (!target) return;
    const card = document.getElementById(`punkt-${target}`);
    card?.querySelector("details")?.setAttribute("open", "");
    card?.scrollIntoView?.({ block: "start" });
    requestAnimationFrame(() => card?.querySelector<HTMLInputElement>("form input")?.focus());
  }, []);
  const count = (s: DataItem["state"]) => status.items.filter((i) => i.state === s).length;
  const evidence = BEST.find((l) => status.items.some((i) => i.evidence === l)) ?? "assumption";
  const forms: Record<DataItemId, ReactNode> = {
    flugplan: <FlightPlanForm project={project} reload={reload} disabled={disabled} />,
    flotte: <AssetsForm project={project} inputs={inputs} reload={reload} disabled={disabled} />,
    messdaten: (
      <MeasurementForm
        project={project}
        inputs={inputs}
        reload={reload}
        disabled={disabled}
        route={route}
      />
    ),
    lab: <LabForm project={project} reload={reload} disabled={disabled} />,
  };
  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Daten · Was wissen wir schon?"
        answer={status.answer}
        lead="„echt“ heißt: aus einer benannten Quelle, nicht erfunden. Was die Daten beweisen, sagt getrennt die Evidenzstufe. Abgewiesene Importe zählen nie."
        evidence={evidence}
        source={inputs.available ? "api" : "beispiel"}
        kpis={[
          { value: String(status.real), unit: "von 4", label: "Datenquellen echt" },
          { value: String(count("annahme")), label: "auf Annahmen" },
          {
            value: String(count("fehlt")),
            label: "fehlen",
            tone: count("fehlt") ? "signal" : undefined,
          },
        ]}
      />
      {sharedDemoNotice() ? (
        <aside className="aec-dwarn" role="note" aria-label="Hinweis zur Demo-Instanz">
          <strong>Geteilte Demo, keine Mandantentrennung.</strong> Alle Nutzer dieser Instanz sehen
          dieselben Daten. Keine echten Kundendaten, keine privaten Flughafen- oder Lab-Messdaten
          hochladen; nur synthetische Testdaten und öffentliche Flugpläne. Echte Daten gehören in
          eine eigene Instanz mit persönlicher Anmeldung.
        </aside>
      ) : null}
      {disabled ? (
        <p className="aec-notice">
          {project.source === "beispiel"
            ? "Beispielprojekt ohne Server-Anbindung: Daten lassen sich erst in einem eigenen Projekt eintragen."
            : "Server nicht erreichbar: Daten lassen sich gerade nicht eintragen."}
        </p>
      ) : null}
      <ol className="aec-dlist-cards" aria-label="Vier Datenquellen">
        {status.items.map((item, i) => (
          <DataCard key={item.id} item={item} index={i}>
            {forms[item.id]}
          </DataCard>
        ))}
      </ol>
    </>
  );
}
