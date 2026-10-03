import type { CoupledRecord, FleetKind } from "./coupledTypes";
import { number } from "./config";

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
  ];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Airport Twin Core | Gekoppelter Vergleich</title><style>
  body{margin:0;padding:40px;background:#0b1b2a;color:#eaf2f6;font:15px Sora,sans-serif}main{max-width:1100px;margin:auto}h1{font-size:32px}h2{margin-top:32px;color:#5ee3d6}.warning{border-left:4px solid #ffca78;padding:16px;background:#182c3c}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #31495c}code{font:12px 'IBM Plex Mono',monospace;overflow-wrap:anywhere}details{padding:16px;border:1px solid #31495c}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){body{padding:16px}th,td{padding:7px;font-size:12px}}@media print{body{background:white;color:#142633;padding:0}h2{color:#142633}.warning{background:#f4f6f7}table,details{break-inside:avoid}}</style></head><body><main>
  <p>Airport Twin Core / MUC / SIL</p><h1>Flugplan → Fahrzeuge → Energie</h1>
  <p class="warning"><strong>Unkalibrierter Methodenprototyp.</strong> Planzeiten sind veröffentlicht; Aufgaben, Fahrzeuge, Verbrauch und Versorgung sind Modellannahmen. Aufgabenbereitschaft ist keine reale OTP/TOBT. Keine automatische Anlagensteuerung oder Sicherheits-/ROI-Aussage.</p>
  <p>Verkehrstag ${escape(plan.service_date)} / Datenstand ${escape(plan.source_data_date)}. ${b.published_entry_count} Flugplaneinträge; keine bestätigte Zahl physischer Flugbewegungen. ${number(b.model_horizon_hours, 1)} Modellstunden inklusive Vor-/Nachlauf.</p>
  <p>${b.mission_count} modellierte Aufgaben; ${b.modeled_departure_count} Abflugseinträge mit mindestens einer modellierten Aufgabe. Gleicher Nenner für beide Regeln.</p>
  <h2>Fairer Regelvergleich</h2><p>Gleiche Nachfrage, Start-SOC, Störungen und Versorgung; nur Laderegel und Ladepunktbelegung ändern sich. Fristenpriorität ist eine dokumentierte Heuristik, kein Optimierungsversprechen.</p>
  <table><thead><tr><th>Modellgröße</th><th>Ungesteuert</th><th>Fristenpriorität</th><th>Delta</th></tr></thead><tbody>${rows.map(([label, x, y, unit]) => `<tr><th>${escape(label)}</th><td>${x === null ? "n/a" : `${number(x, 1)} ${unit}`}</td><td>${y === null ? "n/a" : `${number(y, 1)} ${unit}`}</td><td>${x === null || y === null ? "n/a" : deltaText(x, y)}</td></tr>`).join("")}</tbody></table>
  <h2>Nachweise</h2>${[base, priority].map((r) => `<p>${POLICY_LABELS[r.model_pack_snapshot.parameter_set.policy]} / Run <code>${escape(r.status.run_id)}</code> / Modellkriterien ${r.status.pass_fail ? "erfüllt" : "nicht erfüllt"}. <br>Execution-Commit: <code>${escape(r.build_meta.execution_backend_git_commit ?? "n/a")}</code><br>Artefakt-Hashes: <code>${escape(JSON.stringify(r.build_meta.result_artifact_hashes ?? {}))}</code></p>`).join("")}
  <p>Welt-Hash: <code>${escape(expectedHash)}</code><br>Flugplan-Hash: <code>${escape(plan.content_sha256)}</code><br>PDF-Hash: <code>${escape(plan.source_pdf_sha256)}</code></p>
  <details><summary>Eingefrorene Annahmen und Grenzen</summary><pre>${escape(JSON.stringify(world.config, null, 2))}</pre><ul>${world.warnings.map((w) => `<li>${escape(w)}</li>`).join("")}</ul></details>
  <p>Alle Energie-KPIs umfassen den kompletten Horizont. Unfertige Fristverletzungen sind Untergrenzen. Parkhaus bleibt im Vergleich sichtbar; bessere Flugzeug-Aufgabenbereitschaft darf schlechtere Ladeerfüllung nicht verdecken. Einzelnachweise in missions/departures/vehicles/parking.csv und coupled-evidence.json.</p>
  </main></body></html>`;
}
