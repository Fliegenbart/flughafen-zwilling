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
} from "../api/data";
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
} from "../model/dataStatus";
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
  "Das ist unsere Beispieldatei mit erfundenen Werten. Bitte wählen Sie die echte Datei Ihres Projekts.";

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
        <strong>So muss die Datei aussehen:</strong> {children}
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
          <dt>Woher</dt>
          <dd>{item.source ?? "noch keine Quelle"}</dd>
        </div>
        <div>
          <dt>Stand</dt>
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
        summary={item.state === "echt" ? "Ergänzen oder ersetzen" : "Jetzt eintragen"}
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
      `Flugplan vom ${deDate(plan.service_date)} mit ${plan.departure_entry_count} Abflügen ${imported ? "eingelesen und " : ""}übernommen.${
        groups
          ? ` ${groups} Flüge stehen eventuell doppelt drin (Codeshares) und müssen unter „Anlagenplan und Flugplan“ auf der Seite Tag geklärt werden.`
          : ""
      }`,
    );
    await reload();
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Kein PDF ausgewählt.");
    if (!/\.pdf$/i.test(file.name) || file.size > 6 * 1024 * 1024)
      return setError("Das PDF darf höchstens 6 MB groß sein.");
    if (!date) return setError("Kein Tag ausgewählt.");
    setBusy(true);
    try {
      const plan = await munichRequest<FlightPlanSnapshot>(
        `/munich/flight-plans?service_date=${encodeURIComponent(date)}`,
        { method: "POST", body: file, headers: { "Content-Type": "application/pdf" } },
        45000,
      );
      await link(plan, true);
    } catch (err) {
      setError(flightPlanError(errorText(err, "Das Einlesen hat nicht geklappt.")));
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
      setError(errorText(err, "Das Zuordnen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[]}>
        das PDF des offiziellen Saisonflugplans (
        <a href={FLIGHT_PLAN_SOURCE} target="_blank" rel="noreferrer">
          munich-airport.de/saisonflugplan
        </a>
        ), höchstens 6 MB, dazu ein Tag, für den der Plan gilt. Gelesen werden die Planzeiten.
        Codeshares, die doppelt drinstehen könnten, werden markiert und nicht zusammengelegt.
      </Format>
      <form className="aec-dgrid" onSubmit={upload} aria-label="Flugplan einlesen">
        <label>
          Welcher Tag?
          <input
            type="date"
            value={date}
            required
            disabled={disabled || busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="aec-dgrid__wide">
          Flugplan als PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird gelesen …" : "Flugplan einlesen"}
        </button>
      </form>
      {plans.length ? (
        <form className="aec-dgrid" onSubmit={choose} aria-label="Vorhandenen Flugplan verwenden">
          <label className="aec-dgrid__wide">
            Oder einen schon eingelesenen Flugplan verwenden
            <select
              value={pick}
              disabled={disabled || busy}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Flugplan wählen …</option>
              {plans.map((p) => (
                <option key={p.snapshot_id} value={p.snapshot_id}>
                  {deDate(p.service_date)} · Stand {deDate(p.source_data_date)} ·{" "}
                  {p.departure_entry_count} Abflüge
                  {p.possible_shared_flight_groups
                    ? ` · ${p.possible_shared_flight_groups} mögliche Codeshares`
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
            Verwenden
          </button>
        </form>
      ) : null}
      <Result error={error} ok={ok} />
    </div>
  );
}

/** Flugplan-Backend meldet teils englisch bzw. ohne Umlaute; hier in klare Saetze. */
export function flightPlanError(detail: string): string {
  if (/application\/pdf/.test(detail)) return "Das ist kein PDF.";
  if (/laeuft bereits/.test(detail))
    return "Es wird schon ein Flugplan eingelesen, danach geht es weiter.";
  if (/Zeitlimit/.test(detail)) return "Das Hochladen hat zu lange gedauert und wurde abgebrochen.";
  if (/6 MiB/.test(detail)) return "Das PDF ist größer als 6 MB.";
  if (/^API-Fehler 422|Layout|layout|unlesbar|Flugzeile/i.test(detail))
    return `Wir konnten das PDF nicht als Saisonflugplan lesen. ${detail.startsWith("API-Fehler") ? "" : detail}`.trim();
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
        Versuchsbeginn, aufsteigend, Leistungen in kW, höchstens 5 MB oder 100.000 Messwerte. Ein
        leeres <code>power_kw</code> zählt als Lücke. Gelesen werden nur Messdaten, kein Gerät wird
        angesteuert.
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
  // Ueberschrift = erster Satz; der Rest (was fehlt, was Annahme ist) steht darunter.
  const cut = status.answer.indexOf(". ");
  const headline = cut >= 0 ? status.answer.slice(0, cut + 1) : status.answer;
  const detail = cut >= 0 ? status.answer.slice(cut + 2) : "";
  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Ihre Daten · Was liegt schon vor?"
        answer={headline}
        lead={detail || undefined}
        evidence={evidence}
        source={inputs.available ? "api" : "beispiel"}
        kpis={[
          { value: String(status.real), unit: "von 4", label: "mit Quelle belegt" },
          { value: String(count("annahme")), label: "noch Annahme" },
          {
            value: String(count("fehlt")),
            label: "fehlen noch",
            tone: count("fehlt") ? "signal" : undefined,
          },
        ]}
      />
      {sharedDemoNotice() ? (
        <aside className="aec-dwarn" role="note" aria-label="Hinweis zur Demo-Instanz">
          <strong>Keine echten Kundendaten hochladen.</strong> Alle mit Demo-Zugang sehen, was hier
          liegt. Für echte Daten gibt es eine eigene Umgebung mit persönlicher Anmeldung.
        </aside>
      ) : null}
      {disabled ? (
        <p className="aec-notice">
          {project.source === "beispiel"
            ? "Im Beispielprojekt lassen sich keine Daten eintragen, dafür braucht es ein eigenes Projekt."
            : "Der Server antwortet nicht, Eintragen ist gerade nicht möglich."}
        </p>
      ) : null}
      <ol className="aec-dlist-cards" aria-label="Die vier Datenquellen">
        {status.items.map((item, i) => (
          <DataCard key={item.id} item={item} index={i}>
            {forms[item.id]}
          </DataCard>
        ))}
      </ol>
    </>
  );
}
