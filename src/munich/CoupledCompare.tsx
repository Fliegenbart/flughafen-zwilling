import type { CoupledRecord } from "./coupledTypes";
import { ResultCard, Delta } from "./CoupledViews";
import { number } from "./config";
import { FLEET_LABELS, ruleDifferenceNote } from "./coupledReport";

type Props = { baseline: CoupledRecord; priority: CoupledRecord; reportsHashed: boolean };

function hashes(record: CoupledRecord) {
  const count = Object.keys(record.build_meta.result_artifact_hashes ?? {}).length;
  return count ? `${count} Dateien` : "n/a";
}

export default function CoupledCompare({ baseline, priority, reportsHashed }: Props) {
  const a = baseline.summary!.coupled_kpis;
  const b = priority.summary!.coupled_kpis;
  const equal =
    a.departure_readiness_pct !== null &&
    b.departure_readiness_pct !== null &&
    Math.round((b.departure_readiness_pct - a.departure_readiness_pct) * 10) === 0;
  const world = baseline.model_pack_snapshot.calibration_meta.coupled_world;
  const note = ruleDifferenceNote(a, b);
  const priorityTasks = new Map(
    (b.readiness_by_task ?? []).map((row) => [`${row.kind}/${row.direction}`, row]),
  );

  return (
    <div className="studio-compare">
      <div className="studio-compare-band">
        <ResultCard record={baseline} />
        <div className="studio-primary-delta">
          <Delta
            label="Aufgabenbereitschaft"
            base={a.departure_readiness_pct}
            value={b.departure_readiness_pct}
            unit="pp"
            higherBetter
          />
          {equal && !note && <span>Kein modellierter Vorteil</span>}
          {note && <span className="muc-warn">{note}</span>}
        </div>
        <ResultCard record={priority} />
      </div>
      <div className="studio-evidence-strip">
        <span>{number(a.mission_count, 0)} Serviceaufträge / Baseline</span>
        <span>{number(a.missions_on_time, 0)} fristgerecht / Baseline</span>
        <span>Gleiche Welt / Seed {world.seed}</span>
      </div>
      {(a.readiness_by_task ?? []).length > 0 && (
        <table aria-label="Bereitschaft je Klasse und Aufgabentyp" className="studio-audit-table">
          <caption>
            Aufgabenbereitschaft je Fahrzeugklasse/Aufgabentyp und Wartegrund (Modell, keine OTP)
          </caption>
          <thead>
            <tr>
              <th scope="col">Klasse / Aufgabe</th>
              <th scope="col">Ungesteuert</th>
              <th scope="col">Fristenpriorität</th>
              <th scope="col">Anteil Energie-Wartezeit</th>
            </tr>
          </thead>
          <tbody>
            {(a.readiness_by_task ?? []).map((row) => {
              const other = priorityTasks.get(`${row.kind}/${row.direction}`);
              const pct = (value: number | null | undefined) =>
                value === null || value === undefined ? "n/a" : `${number(value, 1)} %`;
              return (
                <tr key={`${row.kind}/${row.direction}`}>
                  <th scope="row">
                    {FLEET_LABELS[row.kind]} / {row.direction === "arrival" ? "Ankunft" : "Abflug"}
                  </th>
                  <td>
                    {row.missions_on_time} / {row.mission_count} ({pct(row.on_time_pct)})
                  </td>
                  <td>
                    {other
                      ? `${other.missions_on_time} / ${other.mission_count} (${pct(other.on_time_pct)})`
                      : "n/a"}
                  </td>
                  <td>
                    {pct(row.energy_wait_share_pct)} / {pct(other?.energy_wait_share_pct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <details className="studio-supply" open>
        <summary>Versorgung &amp; Ladebereiche</summary>
        <p className="muc-small">
          Schema, kein FMG-Netzplan. Parallele Quellen und Lastbereiche, keine elektrische
          Serienschaltung.
        </p>
        <div className="studio-supply-sources">
          <span>Netz · {number(world.config.power.grid_import_limit_kw, 0)} kW Importgrenze</span>
          <span>PV · {number(world.config.power.pv_capacity_kwp, 0)} kWp Modellfläche</span>
          <span>BHKW · {number(world.config.power.chp_output_kw, 0)} kW Fahrplan</span>
        </div>
        <div className="studio-supply-bus">Gemeinsame Wirkleistungsbilanz</div>
        <div className="studio-supply-loads">
          <span>
            Flotte · {world.config.fleets.reduce((sum, fleet) => sum + fleet.vehicles, 0)}{" "}
            angenommene Fahrzeuge
          </span>
          <span>Parkhaus · {world.config.power.parking_sessions} angenommene Ladeaufträge</span>
          <span>
            Speicher · {number(world.config.power.battery_capacity_kwh, 0)} kWh, hypothetisch
          </span>
        </div>
      </details>
      <div
        className="studio-audit-scroll"
        role="region"
        aria-label="Prüfnachweise, scrollbare Tabelle"
        tabIndex={0}
      >
        <table aria-label="Prüfnachweise" className="studio-audit-table">
          <caption>Prüfnachweise: technische Integrität, keine empirische Validierung</caption>
          <thead>
            <tr>
              <th scope="col">Nachweis</th>
              <th scope="col">Baseline</th>
              <th scope="col">Fristenpriorität</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Welt &amp; Seed</th>
              <td>Identisch</td>
              <td>Identisch</td>
            </tr>
            <tr>
              <th scope="row">Artefakt-Hashes</th>
              <td>{hashes(baseline)}</td>
              <td>{hashes(priority)}</td>
            </tr>
            <tr>
              <th scope="row">Modellkriterien</th>
              {[baseline, priority].map((record) => (
                <td
                  key={record.status.run_id}
                  className={record.status.pass_fail ? "muc-ok" : "muc-warn"}
                >
                  {record.status.pass_fail ? "Erfüllt" : "Nicht erfüllt"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {!reportsHashed && (
        <p className="muc-warn">Ältere Runs: PDF/Report-Dateien ohne ursprüngliche SHA256.</p>
      )}
    </div>
  );
}
