export const METRICS = {
  grid_import_kw: "Netzbezug des Modellbereichs",
  ground_charging_kw: "Ladeleistung der Vorfeldflotte",
  parking_kw: "Ladeleistung im Parkhaus",
};
export type Metric = keyof typeof METRICS;
export type MeasurementProfile = {
  run_id: string;
  metric: Metric;
  unit: "kW";
  interval_seconds: 60;
  sample_semantics: "interval_end_mean";
  evidence_level: "model_checked";
  points: { timestamp: string; model_kw: number }[];
  provenance: { artifact_sha256: string; [key: string]: unknown };
  study?: {
    solution: "direct" | "managed" | "managed_storage";
    electric_share_pct: number;
    grid_import_limit_kw: number;
  } | null;
};
export const MAX_BYTES = 5 * 1024 * 1024;

export function exportCsv(profile: MeasurementProfile, kind: "model" | "template" | "exercise") {
  const header =
    kind === "model"
      ? "timestamp,model_kw"
      : kind === "template"
        ? "timestamp,measured_kw"
        : "timestamp,measured_kw,data_kind";
  return (
    header +
    "\n" +
    profile.points
      .map((p) => {
        if (kind === "model") return `${p.timestamp},${p.model_kw}`;
        if (kind === "template") return `${p.timestamp},`;
        // A deliberately non-identical practice series, never an independent measurement.
        return `${p.timestamp},${(p.model_kw * 1.05 + 1).toFixed(6)},synthetic_exercise`;
      })
      .join("\n") +
    "\n"
  );
}

function instant(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(?:\.0{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
    text,
  );
  if (!m) return NaN;
  const [, year, month, day, hour, minute, zone] = m;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    (zone !== "Z" && (Number(zone!.slice(1, 3)) > 14 || Number(zone!.slice(4)) > 59))
  )
    return NaN;
  return Date.parse(text);
}

export function compareCsv(text: string, profile: MeasurementProfile) {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error("Die Datei ist größer als 5 MiB.");
  if (
    profile.points.length < 60 ||
    profile.points.length > 100000 ||
    profile.unit !== "kW" ||
    profile.sample_semantics !== "interval_end_mean" ||
    profile.interval_seconds !== 60
  )
    throw new Error("Das Profil benötigt mindestens 60 aufeinanderfolgende Minutenwerte in kW.");
  const lines = text
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  const header = lines.shift()?.trim();
  const tagged = header === "timestamp,measured_kw,data_kind";
  if (header !== "timestamp,measured_kw" && !tagged)
    throw new Error(
      "Erwartet: timestamp,measured_kw (Komma als Trennzeichen, Dezimalpunkt, kW). Das Modellprofil ist keine Messdatei.",
    );
  if (lines.length !== profile.points.length)
    throw new Error(
      `Zeitdeckung unvollständig: ${lines.length} statt ${profile.points.length} Minutenwerte. Keine Lücken oder zusätzlichen Zeiträume erlaubt.`,
    );
  let absolute = 0,
    bias = 0,
    modelSum = 0,
    measuredSum = 0,
    previous = NaN;
  let modelPeak = 0,
    measuredPeak = 0;
  const measured = lines.map((line, i) => {
    const cols = line.split(",").map((s) => s.trim());
    if (cols.length !== (tagged ? 3 : 2) || (tagged && cols[2] !== "synthetic_exercise"))
      throw new Error(`Zeile ${i + 2}: CSV-Spalten oder Herkunftsmarkierung ungültig.`);
    const time = instant(cols[0]!);
    const p = profile.points[i]!;
    if (
      !Number.isFinite(time) ||
      time !== instant(p.timestamp) ||
      (i > 0 && time - previous !== 60000)
    )
      throw new Error(
        `Zeile ${i + 2}: Zeitstempel muss exakt zum Minutenende der Simulation passen (mit Zeitzone). Keine Verschiebung oder Interpolation.`,
      );
    previous = time;
    const raw = cols[1]!;
    const value = Number(raw);
    if (
      !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1000000
    )
      throw new Error(
        `Zeile ${i + 2}: gültige, nicht negative Leistung in kW fehlt. Leere Felder sind keine Nullwerte.`,
      );
    if (!Number.isFinite(p.model_kw) || p.model_kw < 0)
      throw new Error("Modellprofil enthält ungültige Leistung.");
    absolute += Math.abs(p.model_kw - value);
    bias += p.model_kw - value;
    modelSum += p.model_kw;
    measuredSum += value;
    modelPeak = Math.max(modelPeak, p.model_kw);
    measuredPeak = Math.max(measuredPeak, value);
    return value;
  });
  if (
    modelSum > 0 &&
    measuredSum > 0 &&
    Math.max(modelSum / measuredSum, measuredSum / modelSum) >= 100
  )
    throw new Error(
      "Einheitenverdacht: Modell und Messung unterscheiden sich um mindestens Faktor 100. Bitte kW statt W und die Messgrenze prüfen.",
    );
  return {
    mae_kw: absolute / lines.length,
    bias_kw: bias / lines.length,
    model_kwh: modelSum / 60,
    measured_kwh: measuredSum / 60,
    energy_error_pct:
      measuredSum === 0 ? null : (Math.abs(modelSum - measuredSum) / measuredSum) * 100,
    model_peak_kw: modelPeak,
    measured_peak_kw: measuredPeak,
    hours: lines.length / 60,
    synthetic: tagged,
    identical: absolute <= 1e-6 * lines.length,
    measured,
  };
}

export type MeasurementComparison = ReturnType<typeof compareCsv>;

export function downloadFile(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
