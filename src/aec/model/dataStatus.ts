/**
 * Datenstand eines Projekts: vier Datenquellen, je "echt" / "Annahme" / "fehlt".
 *
 * "echt" heisst: aus einer benannten Quelle, nicht erfunden. Was die Daten beweisen,
 * sagt getrennt die Evidenzstufe. Abgewiesene Importe (schlechte Datenqualitaet) zaehlen
 * nie als echt; "empirisch bestanden" gibt es nur ueber eine Holdout-Bewertung mit PASS.
 */
import type { EvidenceLevel } from "../../ui/EvidenceBadge";
import { issueLabel } from "../../shared/issues";
import { FLEET_LABEL } from "./fleet";

export type DataState = "echt" | "annahme" | "fehlt";
export type DataItemId = "flugplan" | "flotte" | "messdaten" | "lab";

export type LinkedPlan = {
  snapshotId: string;
  serviceDate: string;
  sourceDataDate: string;
  importedAt: string;
  sharedGroups: number;
  departures: number;
  arrivals: number;
};
export type AssetEntry = {
  key: string;
  label: string;
  group: "flotte" | "anlagen";
  value: number;
  unit: string;
  originalValue: number;
  originalUnit: string;
  source: string;
  sourceDate: string | null;
  status: "echt" | "annahme";
};
export type AssetField = {
  key: string;
  label: string;
  group: "flotte" | "anlagen";
  unit: string;
  min: number;
  max: number;
  integer: boolean;
  /** Standardannahme des Modells, Vorbelegung im Formular (bleibt ohne Quelle Annahme). */
  default: number | null;
};
export type Assets = {
  status: DataState;
  entries: AssetEntry[];
  fields: AssetField[];
  version: {
    createdAt: string;
    filename: string | null;
    sourceKind: string;
    sha256: string;
  } | null;
};
export type MeasurementImport = {
  id: string;
  role: "calibration" | "holdout" | "lab";
  filename: string;
  sourceNote: string;
  createdAt: string;
  valid: boolean;
  issues: string[];
  rows: number;
  first: string | null;
  last: string | null;
};
export type LabRun = {
  id: string;
  source: "simulation" | "csv_import";
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  filename: string | null;
  createdTs: string;
  verdict: "pass" | "fail" | "inconclusive" | null;
  qualityReasons: string[];
  error: string | null;
};

export type DataInputs = {
  /** false: Beispiel- oder lokales Projekt ohne Backend. */
  available: boolean;
  plans: LinkedPlan[];
  assets: Assets | null;
  imports: MeasurementImport[];
  tolerances: { locked: boolean; sha256: string | null } | null;
  /** Pilot-Bewertungen: nur PASS + Holdout ergibt "empirisch bestanden". */
  holdoutPass: boolean;
  labRuns: LabRun[];
};

export type DataItem = {
  id: DataItemId;
  title: string;
  state: DataState;
  source: string | null;
  date: string | null;
  evidence: EvidenceLevel;
  evidenceDetail: string;
  detail: string;
  warnings: string[];
};

export type DataStatus = { items: DataItem[]; real: number; total: 4; answer: string };

export const EMPTY_INPUTS: DataInputs = {
  available: false,
  plans: [],
  assets: null,
  imports: [],
  tolerances: null,
  holdoutPass: false,
  labRuns: [],
};

export const STATE_LABEL: Record<DataState, string> = {
  echt: "belegt",
  annahme: "Annahme",
  fehlt: "fehlt",
};

/** "2026-10-03" bzw. ISO-Zeitpunkt -> "03.10.2026". */
export function deDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

const latest = <T>(list: T[], at: (x: T) => string) =>
  list.reduce<T | null>((a, b) => (!a || at(b) > at(a) ? b : a), null);

function flugplan(inp: DataInputs): DataItem {
  const plan = latest(inp.plans, (p) => p.importedAt);
  const base = {
    id: "flugplan" as const,
    title: "Flugplan",
    evidenceDetail: "Planzeiten, keine Ist-Daten.",
  };
  if (!plan)
    return {
      ...base,
      state: "fehlt",
      source: null,
      date: null,
      evidence: "assumption",
      detail: "Ohne Flugplan wird mit erfundenen Abflugwellen gerechnet.",
      warnings: [],
    };
  const warnings =
    plan.sharedGroups > 0
      ? [
          `${plan.sharedGroups} Flüge stehen eventuell doppelt drin (Codeshares). Gerechnet wird erst, wenn jemand bestätigt, dass es eigene Flüge sind.`,
        ]
      : [];
  return {
    ...base,
    state: "echt",
    source: "Offizieller Saisonflugplan (PDF), von Hand eingelesen",
    date: `gerechneter Tag ${deDate(plan.serviceDate)}, Plan vom ${deDate(plan.sourceDataDate)}`,
    evidence: "assumption",
    detail: `${plan.departures} Abflüge und ${plan.arrivals} Ankünfte.`,
    warnings,
  };
}

function flotte(inp: DataInputs): DataItem {
  const a = inp.assets;
  const base = {
    id: "flotte" as const,
    title: "Fahrzeuge und Anlagen",
    evidence: "assumption" as EvidenceLevel,
    evidenceDetail: "Bestandsangaben, nicht gemessen.",
  };
  if (!a || a.entries.length === 0)
    return {
      ...base,
      state: "fehlt",
      source: null,
      date: null,
      detail: "Gerechnet wird mit Standardwerten für Fahrzeuge, Ladepunkte und Anschluss.",
      warnings: [],
    };
  const sources = [...new Set(a.entries.map((e) => e.source).filter(Boolean))];
  const open = a.entries.filter((e) => !e.source);
  const dates = a.entries
    .map((e) => e.sourceDate)
    .filter((d): d is string => !!d)
    .sort();
  const hasGrid = a.entries.some((e) => e.key === "grid_import_limit_kw");
  const hasFleet = a.entries.some((e) => e.key.endsWith(".vehicles"));
  const state: DataState = open.length === 0 && hasGrid && hasFleet ? "echt" : "annahme";
  const warnings: string[] = [];
  if (open.length)
    warnings.push(
      `${open.length} ${open.length === 1 ? "Wert hat noch keine Quelle und bleibt eine Annahme" : "Werte haben noch keine Quelle und bleiben Annahmen"}: ${open
        .map((e) => e.label)
        .join(", ")}.`,
    );
  if (!hasGrid) warnings.push("Es fehlt die Leistung des Netzanschlusses.");
  if (!hasFleet) warnings.push("Die Zahl der Fahrzeuge fehlt.");
  return {
    ...base,
    state,
    source: sources.length ? sources.join(" · ") : null,
    date: dates.length ? `Quelle vom ${deDate(dates[dates.length - 1])}` : null,
    detail: `${a.entries.length} Werte hinterlegt, sie gelten für jede neue Rechnung.`,
    warnings,
  };
}

function messdaten(inp: DataInputs): DataItem {
  const own = inp.imports.filter((i) => i.role === "calibration" || i.role === "holdout");
  const valid = own.filter((i) => i.valid);
  const rejected = own.filter((i) => !i.valid);
  const last = latest(valid, (i) => i.createdAt);
  const base = { id: "messdaten" as const, title: "Messungen am Flughafen" };
  const warnings = rejected.length
    ? [
        `${rejected.length} ${rejected.length === 1 ? "Datei war nicht verwendbar" : "Dateien waren nicht verwendbar"} und ${rejected.length === 1 ? "zählt" : "zählen"} nicht: ${[
          ...new Set(rejected.flatMap((i) => i.issues)),
        ]
          .slice(0, 3)
          .map(issueLabel)
          .join(" ")}`,
      ]
    : [];
  if (!last)
    return {
      ...base,
      state: "fehlt",
      source: null,
      date: null,
      evidence: "assumption",
      evidenceDetail: "Ohne Messung ist das Modell nicht abgestimmt (unkalibriert).",
      detail:
        "Ohne gemessenen Strombedarf können wir das Modell nicht mit der Wirklichkeit vergleichen.",
      warnings,
    };
  const roles = new Set(valid.map((i) => i.role));
  if (!inp.tolerances?.locked && roles.has("holdout"))
    warnings.push("Die Prüfmessung kann das Modell erst bestätigen, wenn Grenzen festgelegt sind.");
  return {
    ...base,
    state: "echt",
    source: last.sourceNote || last.filename,
    date:
      last.first && last.last
        ? `${deDate(last.first)} bis ${deDate(last.last)}`
        : `eingelesen am ${deDate(last.createdAt)}`,
    evidence: inp.holdoutPass ? "empirical_passed" : "empirical_open",
    evidenceDetail: inp.holdoutPass
      ? "Die Prüfmessung hält die vorher festgelegten Grenzen ein."
      : "Bestätigt ist das Modell erst durch eine Prüfmessung mit vorher festgelegten Grenzen.",
    detail: [
      roles.has("calibration") ? "Zum Abstimmen" : null,
      roles.has("holdout")
        ? roles.has("calibration")
          ? "als Prüfmessung"
          : "Als Prüfmessung"
        : null,
    ]
      .filter(Boolean)
      .join(" und ")
      .concat(
        `, ${valid.length} ${valid.length === 1 ? "verwendbare Messreihe" : "verwendbare Messreihen"}.`,
      ),
    warnings,
  };
}

function lab(inp: DataInputs): DataItem {
  const base = { id: "lab" as const, title: "Messungen im Testing-Lab" };
  const measured = inp.labRuns.filter((r) => r.source === "csv_import");
  const done = latest(
    measured.filter((r) => r.state === "completed"),
    (r) => r.createdTs,
  );
  const pending = measured.filter((r) => r.state === "queued" || r.state === "running");
  const failed = measured.filter((r) => r.state === "failed");
  const warnings: string[] = [];
  if (pending.length)
    warnings.push(
      `${pending.length === 1 ? "Eine Messung wird" : `${pending.length} Messungen werden`} noch ausgewertet.`,
    );
  if (failed.length)
    warnings.push(
      `${failed.length === 1 ? "Eine Messung ließ" : `${failed.length} Messungen ließen`} sich nicht auswerten und ${failed.length === 1 ? "zählt" : "zählen"} nicht${failed[0]?.error ? `: ${failed[0].error}` : "."}`,
    );
  if (done) {
    if (done.qualityReasons.length)
      warnings.push(`Die Messung hat Schwächen: ${done.qualityReasons.join(" ")}`);
    return {
      ...base,
      state: "echt",
      source: done.filename ?? "FlexLab-CSV",
      date: `eingelesen am ${deDate(done.createdTs)}`,
      evidence: "empirical_open",
      evidenceDetail: "Messung an einem einzelnen Gerät, nicht am Flughafen.",
      detail:
        done.verdict === "pass"
          ? "Das Gerät hat den Versuch bestanden."
          : done.verdict === "fail"
            ? "Das Gerät hat den Versuch nicht bestanden."
            : "Das Ergebnis ist nicht eindeutig.",
      warnings,
    };
  }
  const simulated = inp.labRuns.some((r) => r.source === "simulation");
  return {
    ...base,
    state: simulated ? "annahme" : "fehlt",
    source: simulated ? "FlexLab-Simulation" : null,
    date: null,
    evidence: simulated ? "synthetic" : "assumption",
    evidenceDetail: simulated ? "Simuliert, nicht gemessen." : "Noch nicht im Lab gemessen.",
    detail: simulated
      ? "Bisher gibt es nur simulierte Versuche."
      : "Ohne Messung im Lab bleibt offen, wie sich die echten Geräte verhalten.",
    warnings,
  };
}

const MISSING_TEXT: Record<DataItemId, string> = {
  flugplan: "der offizielle Flugplan",
  flotte: "Angaben zu Fahrzeugen und Anlagen",
  messdaten: "Messungen vom Flughafen",
  lab: "Messungen aus dem Testing-Lab",
};

/** Aufzaehlung; enthaelt ein Teil schon "und", verbindet das letzte Glied mit "sowie". */
const join = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} ${parts.some((p) => p.includes(" und ")) ? "sowie" : "und"} ${parts[parts.length - 1]}`;

function dataAnswer(items: DataItem[]): string {
  const real = items.filter((i) => i.state === "echt").length;
  const head =
    real === items.length
      ? `Alle ${items.length} Datenquellen sind belegt.`
      : real === 0
        ? `Noch ist keine der ${items.length} Datenquellen belegt, gerechnet wird mit Annahmen.`
        : `${real} von ${items.length} Datenquellen ${real === 1 ? "ist" : "sind"} belegt.`;
  const missing = items.filter((i) => i.state === "fehlt").map((i) => i.id);
  const assumed = items.filter((i) => i.state === "annahme").map((i) => i.id);
  const parts: string[] = [head];
  if (missing.length) {
    const ids = new Set(missing);
    const texts: string[] = [];
    if (ids.has("messdaten") && ids.has("lab")) {
      for (const id of missing)
        if (id !== "messdaten" && id !== "lab") texts.push(MISSING_TEXT[id]);
      texts.push("Messungen vom Flughafen und aus dem Testing-Lab");
    } else texts.push(...missing.map((id) => MISSING_TEXT[id]));
    const plural = texts.length > 1 || !texts[0]!.startsWith("der ");
    parts.push(`Es ${plural ? "fehlen" : "fehlt"} ${join(texts)}.`);
  }
  if (assumed.length)
    parts.push(
      `Für ${join(assumed.map((id) => items.find((i) => i.id === id)!.title))} gelten noch Annahmen.`,
    );
  return parts.join(" ");
}

export function computeDataStatus(inp: DataInputs): DataStatus {
  const items = [flugplan(inp), flotte(inp), messdaten(inp), lab(inp)];
  return {
    items,
    real: items.filter((i) => i.state === "echt").length,
    total: 4,
    answer: dataAnswer(items),
  };
}

/** Startschritt: Daten, solange Flugplan und Flotte nicht beide echt sind. */
export function needsDataStep(status: DataStatus): boolean {
  const s = (id: DataItemId) => status.items.find((i) => i.id === id)?.state;
  return !(s("flugplan") === "echt" && s("flotte") === "echt");
}

/**
 * Fehlermeldungen der Importe auf Deutsch. Die Backends liefern teils englische
 * Codes (Flugplan, Pilot) und teils schon deutsche Saetze (Lab, Projektwerte).
 */
export function importError(detail: string): string {
  const d = detail.trim();
  if (d.startsWith("invalid_assets: ")) return d.slice("invalid_assets: ".length);
  if (d.startsWith("role_forbidden"))
    return "Aus dieser Ansicht lassen sich keine Daten eintragen. Wechseln Sie zur Flughafen-Ansicht.";
  if (/csv_text exceeds|5 MiB/.test(d)) return "Die Datei ist größer als 5 MB.";
  if (/filename must not contain a path/.test(d))
    return "Der Dateiname darf keinen Ordnerpfad enthalten.";
  if (/measurement_boundary|source_note/.test(d) && /blank|empty|at least/.test(d))
    return "Bitte sagen Sie, wo gemessen wurde und woher die Daten stammen.";
  if (/project not found/i.test(d)) return "Dieses Projekt gibt es nicht mehr.";
  if (/already exists/.test(d)) return "Diese Datei gehört schon zum Projekt.";
  if (/^API-Fehler 413|too large|groesser|größer/i.test(d)) return "Die Datei ist zu groß.";
  if (/^API-Fehler 5\d\d/.test(d)) return "Der Server konnte die Datei nicht verarbeiten.";
  if (/Failed to fetch|NetworkError|aborted/i.test(d)) return "Keine Verbindung zum Server.";
  if (/^[a-z_]+$/.test(d)) return issueLabel(d);
  return d;
}

/** Lokale Vorpruefung: die Beispieldateien sind erfunden und gehoeren nicht ins Projekt. */
export function isExampleFile(name: string): boolean {
  return /beispiel|example/i.test(name);
}

/**
 * Standardflotte des gekoppelten Modells (backend/app/munich/coupled_models.py,
 * `default_fleets`): 100 Fahrzeuge. Eine Gesamtzahl wird nach diesen Anteilen verteilt.
 */
const DEFAULT_FLEET = [
  { kind: "bus", label: FLEET_LABEL.bus, vehicles: 20, chargers: 8 },
  { kind: "baggage_tractor", label: FLEET_LABEL.baggage_tractor, vehicles: 35, chargers: 12 },
  { kind: "pushback_tug", label: FLEET_LABEL.pushback_tug, vehicles: 10, chargers: 4 },
  { kind: "gpu", label: FLEET_LABEL.gpu, vehicles: 35, chargers: 10 },
] as const;
export const MAX_FLEET = 300;

/** Gesamtzahl nach Standardanteilen verteilen (groesster Rest), Ladepunkte mitskaliert. */
export function distributeFleet(total: number) {
  const n = Math.max(0, Math.min(MAX_FLEET, Math.round(total)));
  const sum = DEFAULT_FLEET.reduce((a, f) => a + f.vehicles, 0);
  const raw = DEFAULT_FLEET.map((f) => (n * f.vehicles) / sum);
  const vehicles = raw.map(Math.floor);
  let rest = n - vehicles.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) if (rest-- > 0) vehicles[i]! += 1;
  return DEFAULT_FLEET.map((f, i) => ({
    kind: f.kind,
    label: f.label,
    vehicles: vehicles[i]!,
    chargers: Math.min(vehicles[i]!, Math.round((f.chargers * n) / sum)),
  }));
}
