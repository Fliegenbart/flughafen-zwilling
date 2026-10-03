import { FIELDS, number } from "./config";
import type { EnergyRecord } from "./types";

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );

function sourceUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) ? escape(parsed.href) : "#";
  } catch {
    return "#";
  }
}

export function assertComparable(base: EnergyRecord, priority: EnergyRecord): void {
  if (
    !base.summary ||
    !priority.summary ||
    base.status.state !== "completed" ||
    priority.status.state !== "completed" ||
    base.scenario_snapshot.domain !== "airport_energy_v1" ||
    priority.scenario_snapshot.domain !== "airport_energy_v1" ||
    base.summary.energy_world_hash !== priority.summary.energy_world_hash ||
    base.request.seed !== priority.request.seed ||
    base.scenario_snapshot.metadata.comparison_id !==
      priority.scenario_snapshot.metadata.comparison_id ||
    base.scenario_snapshot.metadata.policy !== "uncontrolled" ||
    priority.scenario_snapshot.metadata.policy !== "bus_priority"
  ) {
    throw new Error("Vergleich nicht zulässig: identische, abgeschlossene Eingabewelten fehlen.");
  }
}

export function buildCompareHtml(base: EnergyRecord, priority: EnergyRecord): string {
  assertComparable(base, priority);
  const a = base.summary!.energy_kpis;
  const b = priority.summary!.energy_kpis;
  const delta = b.bus_ready_count - a.bus_ready_count;
  const metrics: [string, number, number, string][] = [
    ["Bus-Ladefristen erfüllt", a.bus_ready_count, b.bus_ready_count, `von ${a.bus_session_count}`],
    [
      "Parkhaus-Ladefristen erfüllt",
      a.parking_ready_count,
      b.parking_ready_count,
      `von ${a.parking_session_count}`,
    ],
    ["Netzspitze", a.grid_peak_kw, b.grid_peak_kw, "kW"],
    ["Fehlende Ladeenergie", a.charging_unmet_kwh, b.charging_unmet_kwh, "kWh"],
    ["Nicht versorgte Grundlast", a.background_unserved_kwh, b.background_unserved_kwh, "kWh"],
    ["PV-Erzeugung", a.pv_generated_kwh, b.pv_generated_kwh, "kWh"],
    ["PV-Nutzung inkl. Speicherladung", a.pv_used_kwh, b.pv_used_kwh, "kWh"],
    ["PV-Abregelung", a.pv_curtailed_kwh, b.pv_curtailed_kwh, "kWh"],
    ["Nicht absetzbare BHKW-Erzeugung", a.chp_unabsorbed_kwh, b.chp_unabsorbed_kwh, "kWh"],
    ["Speicherverluste", a.battery_loss_kwh, b.battery_loss_kwh, "kWh"],
  ];
  const meta = base.model_pack_snapshot.calibration_meta;
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>München / Vergleichsreport</title><style>
  body{margin:0;background:#081829;color:#ecf4fa;font:15px Sora,"Trebuchet MS",sans-serif;line-height:1.6}
  main{max-width:1050px;margin:40px auto;padding:28px}h1{font-size:38px;line-height:1.2}h2{margin-top:36px}
  .notice{border-left:4px solid #ffcb79;padding:18px;background:#1d2936}.delta{font-size:24px;color:#5ee3d6}
  table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:12px 10px;border-bottom:1px solid #30465b;text-align:left}
  th{color:#93adbf}code{font:12px "IBM Plex Mono",monospace;overflow-wrap:anywhere}a{color:#6fe8df}
  @media print{body{background:white;color:#102333}.notice{background:#eef4f6}a,.delta{color:#07596a}main{margin:0;padding:0}}
  </style><main><h1>Flughafen München<br>Elektrifizierung als Systemtest</h1>
  <div class="notice"><strong>Nicht kalibriert. Synthetischer Referenztest.</strong><br>
  Keine FMG-Betriebsdaten, Anlagensteuerung oder Flughafenpartnerschaft. Keine reale CO2-/Kosten-, OTP- oder Netzsicherheits-Aussage.</div>
  <h2>Ungesteuert vs. Buspriorität</h2><p>24 Modellstunden, 5-Minuten-Intervalle. Dieselben Aufträge, Profile, Grenzen und derselbe Seed ${base.request.seed}.</p>
  <p class="delta">${delta === 0 ? "Kein Vorteil bei Bus-Ladefristen" : `${delta > 0 ? "+" : ""}${delta} Bus-Ladefristen`}</p>
  <table><thead><tr><th>Kriterium</th><th>Ungesteuert</th><th>Buspriorität</th><th>Einheit</th></tr></thead><tbody>
  ${metrics.map(([label, first, second, unit]) => `<tr><td>${escape(label)}</td><td>${number(first, 2)}</td><td>${number(second, 2)}</td><td>${escape(unit)}</td></tr>`).join("")}</tbody></table>
  <p>Baselinerule: sofort laden, bei Engpässen proportional teilen. Buspriorität: Busse zuerst, dann früheste Frist.
  Beide Regeln begrenzen Leistung physikalisch. Das ist keine global optimale Strategie; Parkhausfristen können sich verschlechtern.</p>
  <h2>Eingefrorene Annahmen</h2><table>${FIELDS.map(({ key, label, unit }) => `<tr><td>${escape(label)}</td><td>${number(meta.munich_assumptions[key], 2)} ${escape(unit)}</td></tr>`).join("")}</table>
  <p>PV: 3 MWp P43/P44 sind Teil der 7 MWp Campus-Referenz (2025), keine Addition. Der Tagesverlauf ist synthetisch.
  BHKW: exogener Fahrplan; keine Wärme-/Kälteoptimierung. PV-Nutzung: bilanzielle Restlast nach BHKW, einschließlich Speicherladung;
  Anfangsenergie im hypothetischen Speicher hat unbekannte Herkunft. Keine Grünstromquote.
  kVA × angenommener Leistungsfaktor begrenzt Ladeabgänge; kein realer Netzplan, keine AC-/Schutzrechnung.</p>
  <h2>Nachweise</h2>${[base, priority]
    .map(
      (
        r,
      ) => `<p>${escape(r.scenario_snapshot.metadata.policy)}<br>Run-ID: <code>${escape(r.status.run_id)}</code><br>Audit: <code>${escape(r.summary!.audit_fingerprint_sha256)}</code><br>
  Modellkriterien: ${r.status.pass_fail ? "erfüllt" : "nicht erfüllt"}; keine empirische Validierung.</p>`,
    )
    .join("")}
  <p>Gemeinsamer Welt-Hash: <code>${escape(base.summary!.energy_world_hash)}</code></p>
  <h2>Öffentliche Quellen</h2><p>Recherche: ${escape(meta.reference_dossier.researched_at)}. Berichtsstände bleiben getrennt von Annahmen.</p>
  ${meta.reference_dossier.sources.map((s) => `<p><a href="${sourceUrl(s.url)}">${escape(s.title)}</a></p>`).join("")}
  <p>München besitzt bereits einen Energiezwilling. Zusätzlicher TestingLab-Nutzen muss mit FMG vereinbart und mit echten Daten separat validiert werden.</p></main></html>`;
}
