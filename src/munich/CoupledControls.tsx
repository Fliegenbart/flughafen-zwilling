import type { CoupledConfig, FleetKind, FleetSpec, PowerConfig } from "./coupledTypes";
import { FLEET_LABELS } from "./coupledReport";

const POWER_FIELDS: [keyof PowerConfig, string, string][] = [
  ["grid_import_limit_kw", "Netzimportgrenze", "kW"],
  ["grid_export_limit_kw", "Netzexportgrenze", "kW"],
  ["background_load_kw", "Grundlastprofil", "kW"],
  ["chp_output_kw", "BHKW, exogen", "kW"],
  ["pv_capacity_kwp", "PV, gesamte Modellfläche", "kWp"],
  ["pv_peak_factor", "PV-Profilfaktor", "0–1"],
  ["apron_transformer_kva", "Trafo Vorfeld", "kVA"],
  ["parking_transformer_kva", "Trafo Parkhaus", "kVA"],
  ["power_factor", "Leistungsfaktor", "0–1"],
  ["transformer_efficiency", "Trafo-Wirkungsgrad", "0–1"],
  ["charging_efficiency", "Ladewirkungsgrad", "0–1"],
  ["battery_capacity_kwh", "Speicherkapazität", "kWh"],
  ["battery_power_kw", "Speicherleistung", "kW"],
  ["battery_initial_soc_pct", "Speicher Start-SOC", "%"],
  ["battery_reserve_pct", "Speicherreserve", "%"],
  ["battery_efficiency", "Speicherwirkungsgrad", "0–1"],
  ["parking_sessions", "Parkhaus-Ladeaufträge", "Anzahl"],
  ["parking_charger_kw", "Parkhaus je Ladepunkt", "kW"],
];
const CORE_POWER_KEYS: (keyof PowerConfig)[] = [
  "grid_import_limit_kw",
  "chp_output_kw",
  "background_load_kw",
];
const FLEET_FIELDS: [Exclude<keyof FleetSpec, "kind">, string, string][] = [
  ["vehicles", "Fahrzeuge", "Anzahl"],
  ["chargers", "Ladepunkte", "Anzahl"],
  ["battery_capacity_kwh", "Batterie je Fahrzeug", "kWh"],
  ["initial_soc_pct", "Start-SOC", "%"],
  ["reserve_soc_pct", "Reserve", "%"],
  ["charge_target_soc_pct", "Ladeziel", "%"],
  ["charger_kw", "Ladeleistung", "kW"],
  ["mission_energy_kwh", "Energie je Einsatz inkl. Rückfahrt", "kWh"],
  ["service_duration_min", "Servicezeit", "min"],
  ["return_min", "Rückfahrt", "min"],
  ["departure_lead_min", "Abflug-Vorlauf", "min"],
  ["departure_buffer_min", "Abflug-Puffer", "min"],
  ["arrival_allowance_min", "Ankunftsfrist", "min"],
  ["coverage_pct", "Einsatzabdeckung", "%"],
];
function Numeric({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="muc-field">
      {label}
      <span>{unit}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={unit === "0–1" ? 0.01 : 1}
        min={0}
        required
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}

export default function CoupledControls({
  config,
  setConfig,
  seed,
  setSeed,
}: {
  config: CoupledConfig;
  setConfig: (c: CoupledConfig) => void;
  seed: number;
  setSeed: (s: number) => void;
}) {
  return (
    <>
      <div id="coupled-energy" className="studio-core-fields">
        {POWER_FIELDS.filter(([key]) => CORE_POWER_KEYS.includes(key)).map(([key, label, unit]) => (
          <Numeric
            key={key}
            label={label}
            unit={unit}
            value={config.power[key]}
            onChange={(v) => setConfig({ ...config, power: { ...config.power, [key]: v } })}
          />
        ))}
      </div>
      <details className="coupled-assumptions">
        <summary>Weitere Modellannahmen</summary>
        <p>
          Alle Werte sind frei prüfbare Annahmen. Zero-Fleet lässt Nachfrage bestehen; kein
          vorgetäuschtes PASS. Anfangs-SOC gilt vor dem Vorlauf.
        </p>
        <div className="coupled-form">
          <Numeric label="Kopplungs-Seed" unit="Ganzzahl" value={seed} onChange={setSeed} />
          <Numeric
            label="Vorlauf"
            unit="min"
            value={config.warmup_min}
            onChange={(v) => setConfig({ ...config, warmup_min: v })}
          />
          <Numeric
            label="Nachlauf"
            unit="min"
            value={config.drain_min}
            onChange={(v) => setConfig({ ...config, drain_min: v })}
          />
        </div>
        <details>
          <summary>Versorgung, PV, Speicher und Parkhaus</summary>
          <div className="coupled-form">
            {POWER_FIELDS.filter(([key]) => !CORE_POWER_KEYS.includes(key)).map(
              ([key, label, unit]) => (
                <Numeric
                  key={key}
                  label={label}
                  unit={unit}
                  value={config.power[key]}
                  onChange={(v) => setConfig({ ...config, power: { ...config.power, [key]: v } })}
                />
              ),
            )}
          </div>
        </details>
        <div id="coupled-fleet">
          {config.fleets.map((fleet, i) => (
            <details key={fleet.kind}>
              <summary>
                {FLEET_LABELS[fleet.kind]} / {fleet.vehicles} Fahrzeuge, {fleet.chargers} Ladepunkte
              </summary>
              <div className="coupled-form">
                {FLEET_FIELDS.map(([key, label, unit]) => (
                  <Numeric
                    key={key}
                    label={`${FLEET_LABELS[fleet.kind]} / ${label}`}
                    unit={unit}
                    value={fleet[key]}
                    onChange={(v) =>
                      setConfig({
                        ...config,
                        fleets: config.fleets.map((f, j) => (j === i ? { ...f, [key]: v } : f)),
                      })
                    }
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
        <label className="coupled-ack">
          <input
            type="checkbox"
            checked={config.stress_events.length > 0}
            onChange={(e) =>
              setConfig({
                ...config,
                stress_events: e.target.checked
                  ? [
                      {
                        start_min: 360,
                        end_min: 540,
                        grid_import_limit_kw: 0,
                        fleet_kind: null,
                        offline_chargers: 0,
                      },
                    ]
                  : [],
              })
            }
          />
          Zeitlich begrenzten Netz-/Ladepunktengpass prüfen
        </label>
        {config.stress_events[0] && (
          <div className="coupled-form">
            {(
              [
                ["start_min", "Beginn ab Verkehrstagstart", "min"],
                ["end_min", "Ende ab Verkehrstagstart", "min"],
                ["grid_import_limit_kw", "Netzlimit während Störung", "kW"],
              ] as const
            ).map(([key, label, unit]) => (
              <Numeric
                key={key}
                label={label}
                unit={unit}
                value={config.stress_events[0]![key] ?? 0}
                onChange={(v) =>
                  setConfig({
                    ...config,
                    stress_events: [{ ...config.stress_events[0]!, [key]: v }],
                  })
                }
              />
            ))}
            <label className="muc-field">
              Ladepunktausfall / Fahrzeugklasse
              <select
                value={config.stress_events[0].fleet_kind ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    stress_events: [
                      {
                        ...config.stress_events[0]!,
                        fleet_kind: (e.target.value || null) as FleetKind | null,
                        offline_chargers: e.target.value ? 1 : 0,
                      },
                    ],
                  })
                }
              >
                <option value="">Kein Ladepunktausfall</option>
                {config.fleets.map((fleet) => (
                  <option key={fleet.kind} value={fleet.kind}>
                    {FLEET_LABELS[fleet.kind]}
                  </option>
                ))}
              </select>
            </label>
            {config.stress_events[0].fleet_kind && (
              <Numeric
                label="Ausgefallene Ladepunkte"
                unit="Anzahl"
                value={config.stress_events[0].offline_chargers}
                onChange={(v) =>
                  setConfig({
                    ...config,
                    stress_events: [{ ...config.stress_events[0]!, offline_chargers: v }],
                  })
                }
              />
            )}
          </div>
        )}
      </details>
    </>
  );
}
