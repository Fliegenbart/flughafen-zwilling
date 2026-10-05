import { useState } from "react";
import type { CoupledRecord } from "../munich/coupledTypes";
import "./PilotStudio.css";
export function gridCost(importKwh: number, exportKwh: number, buy: number, sell: number) {
  if (![importKwh, exportKwh, buy, sell].every(Number.isFinite) || importKwh < 0 || exportKwh < 0)
    throw new Error("Ungültige Energie-/Tarifwerte");
  return importKwh * buy - exportKwh * sell;
}
export default function CostWorksheet({
  baseline,
  recommended,
}: {
  baseline: CoupledRecord;
  recommended: CoupledRecord;
}) {
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [source, setSource] = useState("");
  const base = baseline.summary?.energy_kpis;
  const next = recommended.summary?.energy_kpis;
  const valid =
    !!base &&
    !!next &&
    source.trim().length > 0 &&
    buy.trim() !== "" &&
    sell.trim() !== "" &&
    [
      Number(buy),
      Number(sell),
      base.grid_import_kwh,
      base.grid_export_kwh,
      next.grid_import_kwh,
      next.grid_export_kwh,
    ].every(Number.isFinite);
  const baseCost = valid
    ? gridCost(base!.grid_import_kwh, base!.grid_export_kwh, Number(buy), Number(sell))
    : null;
  const nextCost = valid
    ? gridCost(next!.grid_import_kwh, next!.grid_export_kwh, Number(buy), Number(sell))
    : null;
  const euro = (n: number | null) =>
    n === null ? "n/a" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  function download() {
    if (!valid) return;
    const payload = {
      version: "airport_cost_component_v1",
      scope: "grid_energy_only_simulated_horizon",
      source_note: source,
      import_eur_per_kwh: Number(buy),
      export_eur_per_kwh: Number(sell),
      baseline_run_id: baseline.status.run_id,
      comparison_run_id: recommended.status.run_id,
      world_hash: baseline.summary!.energy_world_hash,
      baseline_grid_energy_eur: baseCost,
      comparison_grid_energy_eur: nextCost,
      delta_eur: nextCost! - baseCost!,
      excluded: ["CHP fuel", "demand charges", "CAPEX", "storage wear", "taxes", "outage costs"],
      annual_extrapolation: false,
      empirically_validated: false,
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `netzkosten-${baseline.status.run_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <section className="pilot-studio" aria-label="Kostenannahmen">
      <span className="pilot-studio__eyebrow">
        Ein Kostenbaustein, keine Investitionsempfehlung
      </span>
      <h3>Netzenergie mit eigenen Tarifen bewerten</h3>
      <p>
        Gleicher simulierter Zeitraum, eingefrorene Runs. Keine Jahreshochrechnung. BHKW-Brennstoff,
        Leistungspreise, Investitionen, Steuern und Ausfallkosten sind nicht enthalten. Gleicher
        End-SOC und erbrachte Aufgaben müssen zusätzlich beurteilt werden.
      </p>
      <div className="pilot-studio__split">
        <label>
          Bezugspreis (EUR/kWh)
          <input type="number" step="any" value={buy} onChange={(e) => setBuy(e.target.value)} />
        </label>
        <label>
          Einspeiseerlös (EUR/kWh)
          <input type="number" step="any" value={sell} onChange={(e) => setSell(e.target.value)} />
        </label>
      </div>
      <label>
        Quelle / Freigabestand der Tarifannahmen
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={1000}
          placeholder="Vertrag, Gültigkeitszeitraum oder ausdrücklich hypothetisch"
        />
      </label>
      <dl className="pilot-studio__split">
        <div>
          <dt>Ungesteuert</dt>
          <dd>{euro(baseCost)}</dd>
        </div>
        <div>
          <dt>Fristenpriorität</dt>
          <dd>{euro(nextCost)}</dd>
        </div>
      </dl>
      <p>
        Differenz: <strong>{euro(valid ? nextCost! - baseCost! : null)}</strong> (negativ =
        geringerer Netzenergie-Kostenbaustein).
      </p>
      <button onClick={download} disabled={!valid}>
        Kostenannahmen mit Run-Bezug exportieren
      </button>
    </section>
  );
}
