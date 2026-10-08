import { REPORT_STYLES } from "../ui/reportStyles";
import type { PilotAssessment, PilotImport, PilotProject } from "./types";
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function pilotReport(
  project: PilotProject,
  imports: PilotImport[],
  assessments: PilotAssessment[],
): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pilotentscheidung · ${e(project.name)}</title><style>${REPORT_STYLES}</style></head><body><main><small>AIRPORT TWIN CORE / PILOTENTSCHEIDUNG</small><h1>${e(project.name)}</h1><p class="tag">Methodenprototyp. Keine Anlagenfreigabe, keine empirische Validierung allein durch SIL oder einen CSV-Vergleich.</p><h2>Die zu treffende Entscheidung</h2><p>${e(project.decision)}</p><h2>Systemgrenze</h2><p>${e(project.scope)}</p><h2>Vorab festzulegende Abnahme</h2><p>${e(project.acceptance_note)}</p><h2>Nachweise</h2><table><thead><tr><th>Quelle / Rolle</th><th>Messgrenze</th><th>Datenqualität</th><th>Bewertungen</th></tr></thead><tbody>${imports
    .map(
      (i) =>
        `<tr><td>${e(i.filename)}<br>${e(i.role)}<br><code>${e(i.quality.sha256)}</code></td><td>${e(i.measurement_boundary)}<br>${e(i.source_note)}</td><td>${e(i.quality.state)}<br>${e(i.quality.issues.join("; "))}</td><td>${
          assessments
            .filter((a) => a.import_id === i.id)
            .map(
              (a) =>
                `${e(a.validity_status)}<br>MAE: ${e(a.metrics.time_weighted_mae_kw ?? "n/a")} kW / Grenze ${e(a.thresholds.mae_max_kw)} kW<br>Energiefehler: ${e(a.metrics.energy_error_pct ?? "n/a")} % / absolute Grenze ${e(a.thresholds.energy_error_max_pct)} %<br>${e(a.not_evaluable_reasons.join("; "))}`,
            )
            .join("<br>") || "Noch nicht bewertet"
        }</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table><h2>Nächster Entscheidungs-Gate</h2><p>Messgrenze, Datenherkunft und Fehlertoleranzen mit dem Betreiber bestätigen. Kalibrierung und unabhängigen Holdout getrennt beurteilen. Versuchsvorschrift, Sicherheitsgrenzen und reale Gerätefreigabe liegen beim TestingLab. Wirtschaftlichkeit nur mit freigegebenen Kosten- und Tarifdaten bewerten.</p><p>Projekt-ID: <code>${e(project.id)}</code>. Exportiert: ${e(new Date().toISOString())}. Originalquellen und maschinenlesbare Bewertungen liegen im Testpaket.</p></main></body></html>`;
}
