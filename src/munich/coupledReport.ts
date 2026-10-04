import type { CoupledKpis, CoupledRecord, FleetKind } from "./coupledTypes";
import { number } from "./config";
import { REPORT_STYLES } from "../ui/reportStyles";

export const FLEET_LABELS: Record<FleetKind, string> = {
  bus: "Bus",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Pushback",
  gpu: "Mobile GPU",
};
export const POLICY_LABELS = { uncontrolled: "Ungesteuert", mission_priority: "Fristenpriorität" };
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

/** Hinweis, wenn der Regelunterschied in dieser Welt nicht energetisch messbar ist. */
export function ruleDifferenceNote(a: CoupledKpis, b: CoupledKpis): string | null {
  if (!a.bottleneck || !b.bottleneck) return null;
  const same =
    a.departure_readiness_pct !== null &&
    b.departure_readiness_pct !== null &&
    Math.abs(b.departure_readiness_pct - a.departure_readiness_pct) < 0.05;
  if (!same) return null;
  if (a.bottleneck === "resource" && b.bottleneck === "resource")
    return "Unterschied der Laderegel nicht messbar, Engpass: Fahrzeugverfügbarkeit";
  if (a.bottleneck === "none" && b.bottleneck === "none")
    return "Unterschied der Laderegel nicht messbar: kein Engpass im Modell";
  return null;
}

function deltaText(x: number, y: number): string {
  const rounded = Math.round((y - x) * 10) / 10;
  const delta = Object.is(rounded, -0) ? 0 : rounded;
  return `${delta > 0 ? "+" : ""}${number(delta, 1)}`;
}

export function coupledPair(
  records: CoupledRecord[],
  expectedHash: string,
): [CoupledRecord, CoupledRecord] {
  const baseline = records.find(
    (r) => r.model_pack_snapshot.parameter_set.policy === "uncontrolled",
  );
  const priority = records.find(
    (r) => r.model_pack_snapshot.parameter_set.policy === "mission_priority",
  );
  if (
    !baseline ||
    !priority ||
    records.length !== 2 ||
    records.some(
      (r) =>
        r.status.state !== "completed" ||
        r.summary?.domain !== "airport_coupled_v1" ||
        !r.summary.coupled_kpis ||
        r.summary.energy_world_hash !== expectedHash ||
        r.model_pack_snapshot.calibration_meta.coupled_world.world_hash !== expectedHash ||
        r.request.seed !== baseline.request.seed ||
        r.model_pack_snapshot.calibration_meta.flight_plan_snapshot.content_sha256 !==
          baseline.model_pack_snapshot.calibration_meta.flight_plan_snapshot.content_sha256,
    )
  )
    throw new Error("Vergleich abgelehnt: keine identische, abgeschlossene Modellwelt.");
  return [baseline, priority];
}

export function modelTime(origin: string, minute: number | null): string {
  if (minute === null) return "Nicht erledigt";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(Date.parse(origin) + minute * 60000));
}

export function buildCoupledHtml(records: CoupledRecord[], expectedHash: string): string {
  const [base, priority] = coupledPair(records, expectedHash);
  const world = base.model_pack_snapshot.calibration_meta.coupled_world;
  const plan = base.model_pack_snapshot.calibration_meta.flight_plan_snapshot;
  const b = base.summary!.coupled_kpis,
    p = priority.summary!.coupled_kpis;
  const rows: [string, number | null, number | null, string][] = [
    [
      "Modellierte Abflug-Aufgabenbereitschaft",
      b.departure_readiness_pct,
      p.departure_readiness_pct,
      "%",
    ],
    ["Rechtzeitige Aufgaben", b.missions_on_time, p.missions_on_time, "Anzahl"],
    ["Nicht erledigte Aufgaben", b.missions_uncompleted, p.missions_uncompleted, "Anzahl"],
    ["Auftrag-Warteminuten: Energie", b.energy_wait_total_min, p.energy_wait_total_min, "min"],
    [
      "Auftrag-Warteminuten: Fahrzeuge",
      b.resource_wait_total_min,
      p.resource_wait_total_min,
      "min",
    ],
    [
      "Netzspitze",
      base.summary!.energy_kpis.grid_peak_kw,
      priority.summary!.energy_kpis.grid_peak_kw,
      "kW",
    ],
    [
      "Parkhaus: fehlende Ladeenergie",
      base.summary!.energy_kpis.charging_unmet_kwh,
      priority.summary!.energy_kpis.charging_unmet_kwh,
      "kWh",
    ],
    ["Trafoverluste", b.transformer_loss_kwh, p.transformer_loss_kwh, "kWh"],
    ...(b.readiness_by_task ?? []).map((row): [string, number | null, number | null, string] => [
      `Bereitschaft ${FLEET_LABELS[row.kind]} / ${row.direction === "arrival" ? "Ankunft" : "Abflug"}`,
      row.on_time_pct,
      (p.readiness_by_task ?? []).find((o) => o.kind === row.kind && o.direction === row.direction)
        ?.on_time_pct ?? null,
      "%",
    ]),
  ];
  const note = ruleDifferenceNote(b, p);
  const modelWarnings = [...new Set([...(b.model_warnings ?? []), ...(p.model_warnings ?? [])])];
  return `<!doctype html><html lang="de" data-report-theme="operations-studio"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Airport Twin Core | Gekoppelter Vergleich</title><style>${REPORT_STYLES}</style></head><body><main>
  <p>Airport Twin Core / MUC / SIL</p><h1>Flugplan → Fahrzeuge → Energie</h1>
  <p class="warning"><strong>Unkalibrierter Methodenprototyp.</strong> Planzeiten sind veröffentlicht; Aufgaben, Fahrzeuge, Verbrauch und Versorgung sind Modellannahmen. Aufgabenbereitschaft ist keine reale OTP/TOBT. Keine automatische Anlagensteuerung oder Sicherheits-/ROI-Aussage.</p>
  <p>Verkehrstag ${escape(plan.service_date)} / Datenstand ${escape(plan.source_data_date)}. ${b.published_entry_count} Flugplaneinträge; keine bestätigte Zahl physischer Flugbewegungen. ${number(b.model_horizon_hours, 1)} Modellstunden inklusive Vor-/Nachlauf.</p>
  <p>${b.mission_count} modellierte Aufgaben; ${b.modeled_departure_count} Abflugseinträge mit mindestens einer modellierten Aufgabe. Gleicher Nenner für beide Regeln.</p>
  <h2>Fairer Regelvergleich</h2><p>Gleiche Nachfrage, Start-SOC, Störungen und Versorgung; nur Laderegel und Ladepunktbelegung ändern sich. Fristenpriorität ist eine dokumentierte Heuristik, kein Optimierungsversprechen.</p>
  ${note ? `<p class="warning"><strong>${escape(note)}</strong></p>` : ""}
  ${modelWarnings.map((w) => `<p class="warning">Modellwarnung: ${escape(w)}</p>`).join("")}
  <p>Bilanzprüfung: Die Minuten-Wirkleistungsbilanz ist ein Buchführungscheck derselben Gleichung (per Konstruktion ≈0). Unabhängig geprüft werden Flotten- und Speicherenergiebilanz aus getrennt aufsummierten Größen.</p>
  <table><thead><tr><th>Modellgröße</th><th>Ungesteuert</th><th>Fristenpriorität</th><th>Delta</th></tr></thead><tbody>${rows.map(([label, x, y, unit]) => `<tr><th>${escape(label)}</th><td>${x === null ? "n/a" : `${number(x, 1)} ${unit}`}</td><td>${y === null ? "n/a" : `${number(y, 1)} ${unit}`}</td><td>${x === null || y === null ? "n/a" : deltaText(x, y)}</td></tr>`).join("")}</tbody></table>
  <h2>Nachweise</h2>${[base, priority].map((r) => `<p>${POLICY_LABELS[r.model_pack_snapshot.parameter_set.policy]} / Run <code>${escape(r.status.run_id)}</code> / Modellkriterien ${r.status.pass_fail ? "erfüllt" : "nicht erfüllt"}. <br>Execution-Commit: <code>${escape(r.build_meta.execution_backend_git_commit ?? "n/a")}</code><br>Auditformat: ${r.build_meta.result_audit_version === "coupled_evidence_v2" ? "Datenartefakte sowie JSON/PDF gehasht (v2)" : "Ältere Datenartefakte; PDF/Report-Dateien ohne ursprüngliche SHA256 (v1)"}<br>Artefakt-Hashes: <code>${escape(JSON.stringify(r.build_meta.result_artifact_hashes ?? {}))}</code></p>`).join("")}
  <p>Welt-Hash: <code>${escape(expectedHash)}</code><br>Flugplan-Hash: <code>${escape(plan.content_sha256)}</code><br>PDF-Hash: <code>${escape(plan.source_pdf_sha256)}</code></p>
  <details><summary>Eingefrorene Annahmen und Grenzen</summary><pre>${escape(JSON.stringify(world.config, null, 2))}</pre><ul>${world.warnings.map((w) => `<li>${escape(w)}</li>`).join("")}</ul></details>
  <p>Alle Energie-KPIs umfassen den kompletten Horizont. Unfertige Fristverletzungen sind Untergrenzen. Parkhaus bleibt im Vergleich sichtbar; bessere Flugzeug-Aufgabenbereitschaft darf schlechtere Ladeerfüllung nicht verdecken. Einzelnachweise in missions/departures/vehicles/parking.csv und coupled-evidence.json.</p>
  </main></body></html>`;
}
