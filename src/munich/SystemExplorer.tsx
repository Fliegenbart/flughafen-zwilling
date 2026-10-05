import { useMemo, useState } from "react";
import type { FlightPlanSnapshot } from "./flightplanTypes";
import type { CoupledConfig, CoupledRecord, FleetKind, PowerConfig } from "./coupledTypes";
import "./SystemExplorer.css";

type ViewMode = "map" | "energy";
type NodeId =
  | "flightplan"
  | "missions"
  | "fleet"
  | "readiness"
  | "grid"
  | "pv"
  | "chp"
  | "storage"
  | "sharedbus"
  | "aprontrafo"
  | "parkingtrafo"
  | "parking"
  | "background";

type Control =
  | { kind: "power"; key: keyof PowerConfig; label: string; unit: string; step: number }
  | { kind: "fleet"; fleet: FleetKind; label: string; unit: string; step: number };

type NodeSpec = {
  label: string;
  valueLabel: string;
  description: string;
  path: readonly NodeId[];
  control?: Control;
};

const NODES: Record<NodeId, NodeSpec> = {
  flightplan: {
    label: "Flugplan",
    valueLabel: "Manueller Snapshot",
    description:
      "Veröffentlichte Planzeiten begrenzen den Modelltag. Sie sind keine Ist-Flugbewegungen.",
    path: ["flightplan", "missions", "fleet", "readiness"],
  },
  missions: {
    label: "Serviceaufträge",
    valueLabel: "modelliert",
    description:
      "Aus Planeinträgen entstehen modellierte Aufgaben. Fahrzeugbedarf und Fristen bleiben Annahmen.",
    path: ["missions", "fleet", "readiness"],
  },
  fleet: {
    label: "Fahrzeugflotte",
    valueLabel: "Flotte & SOC",
    description:
      "Fahrzeuganzahl, Ladepunkte, SOC und Einsatzenergie sind frei prüfbare Modellannahmen.",
    path: ["fleet", "readiness"],
    control: { kind: "fleet", fleet: "bus", label: "Vorfeldbusse", unit: "Anzahl", step: 1 },
  },
  readiness: {
    label: "Aufgabenbereitschaft",
    valueLabel: "nur aus Run",
    description:
      "Abflugbereitschaft ist ein modelliertes Ergebnis. Sie ist weder reale Flug-OTP noch empirische Validierung.",
    path: ["missions", "fleet", "readiness"],
  },
  grid: {
    label: "Netzanschluss",
    valueLabel: "Importgrenze",
    description:
      "Begrenzt den Netzbezug der Modellbilanz. Die Ansicht stellt keine verifizierte Flughafen-Netztopologie dar.",
    path: ["grid", "sharedbus", "aprontrafo", "fleet", "readiness"],
    control: {
      kind: "power",
      key: "grid_import_limit_kw",
      label: "Netzimportgrenze",
      unit: "kW",
      step: 1,
    },
  },
  pv: {
    label: "Photovoltaik",
    valueLabel: "Modellkapazität",
    description:
      "Kapazität und Profilfaktor erzeugen einen synthetischen Tagesverlauf, keine gemessene Wetter- oder Erzeugungskurve.",
    path: ["pv", "sharedbus", "aprontrafo", "fleet"],
    control: {
      kind: "power",
      key: "pv_capacity_kwp",
      label: "PV, gesamte Modellfläche",
      unit: "kWp",
      step: 1,
    },
  },
  chp: {
    label: "BHKW",
    valueLabel: "exogener Fahrplan",
    description:
      "Die elektrische BHKW-Leistung ist eine exogene Annahme; Wärme, Optimierung und reale Fahrweise sind nicht abgebildet.",
    path: ["chp", "sharedbus", "aprontrafo", "fleet"],
    control: { kind: "power", key: "chp_output_kw", label: "BHKW, exogen", unit: "kW", step: 1 },
  },
  storage: {
    label: "Batteriespeicher",
    valueLabel: "optional",
    description:
      "Kapazität, Leistung, Reserve und Wirkungsgrad bleiben eigene Annahmen. Die Richtung ergibt sich erst im Simulationslauf.",
    path: ["storage", "sharedbus", "aprontrafo", "fleet"],
    control: {
      kind: "power",
      key: "battery_capacity_kwh",
      label: "Speicherkapazität",
      unit: "kWh",
      step: 1,
    },
  },
  sharedbus: {
    label: "Gemeinsame Leistungsbilanz",
    valueLabel: "Modellbus",
    description:
      "Netz, PV, BHKW und Speicher treffen in einer Wirkleistungsbilanz zusammen. Dies ist kein Stromlaufplan.",
    path: ["sharedbus", "background", "aprontrafo", "parkingtrafo", "fleet", "parking"],
  },
  aprontrafo: {
    label: "Vorfeld-Ladeabgang",
    valueLabel: "Scheinleistung",
    description:
      "Der modellierte Vorfeldabgang begrenzt Ladeleistung für die Flotte zusammen mit Leistungsfaktor und Wirkungsgrad.",
    path: ["aprontrafo", "fleet", "readiness"],
    control: {
      kind: "power",
      key: "apron_transformer_kva",
      label: "Trafo Vorfeld",
      unit: "kVA",
      step: 1,
    },
  },
  parkingtrafo: {
    label: "Parkhaus-Ladeabgang",
    valueLabel: "Scheinleistung",
    description:
      "Der separate Parkhausabgang teilt sich das Modellbudget mit Vorfeld und Grundlast. Keine reale Anlagenmessung.",
    path: ["parkingtrafo", "parking", "sharedbus"],
    control: {
      kind: "power",
      key: "parking_transformer_kva",
      label: "Trafo Parkhaus",
      unit: "kVA",
      step: 1,
    },
  },
  parking: {
    label: "Parkhaus-Laden",
    valueLabel: "modellierte Aufträge",
    description:
      "Ladeaufträge und Fristen sind synthetische Modellparameter, keine beobachteten Kunden-Ladevorgänge.",
    path: ["parking", "parkingtrafo", "sharedbus", "aprontrafo", "fleet"],
    control: {
      kind: "power",
      key: "parking_sessions",
      label: "Parkhaus-Ladeaufträge",
      unit: "Anzahl",
      step: 1,
    },
  },
  background: {
    label: "Campus-Grundlast",
    valueLabel: "Referenzprofil",
    description:
      "Die Grundlast wird im Modell zuerst bedient. Sie ist kein gemessenes Terminal-Lastprofil.",
    path: ["background", "sharedbus", "aprontrafo", "fleet"],
    control: {
      kind: "power",
      key: "background_load_kw",
      label: "Grundlastprofil",
      unit: "kW",
      step: 1,
    },
  },
};

const MAP_POSITIONS: Record<NodeId, { left: string; top: string }> = {
  flightplan: { left: "12%", top: "12%" },
  missions: { left: "37%", top: "12%" },
  fleet: { left: "62%", top: "12%" },
  readiness: { left: "87%", top: "12%" },
  grid: { left: "11%", top: "41%" },
  pv: { left: "11%", top: "57%" },
  chp: { left: "11%", top: "73%" },
  storage: { left: "11%", top: "89%" },
  sharedbus: { left: "39%", top: "65%" },
  background: { left: "61%", top: "42%" },
  aprontrafo: { left: "61%", top: "60%" },
  parkingtrafo: { left: "61%", top: "83%" },
  parking: { left: "87%", top: "83%" },
};

const ENERGY_POSITIONS: Record<NodeId, { left: string; top: string }> = {
  flightplan: { left: "12%", top: "10%" },
  missions: { left: "36%", top: "10%" },
  readiness: { left: "87%", top: "10%" },
  grid: { left: "11%", top: "34%" },
  pv: { left: "11%", top: "48%" },
  chp: { left: "11%", top: "62%" },
  storage: { left: "11%", top: "78%" },
  sharedbus: { left: "40%", top: "56%" },
  background: { left: "64%", top: "34%" },
  aprontrafo: { left: "64%", top: "52%" },
  parkingtrafo: { left: "64%", top: "76%" },
  fleet: { left: "87%", top: "52%" },
  parking: { left: "87%", top: "76%" },
};

const CONNECTIONS: { from: NodeId; to: NodeId; demand?: boolean }[] = [
  { from: "flightplan", to: "missions", demand: true },
  { from: "missions", to: "fleet", demand: true },
  { from: "fleet", to: "readiness", demand: true },
  { from: "grid", to: "sharedbus" },
  { from: "pv", to: "sharedbus" },
  { from: "chp", to: "sharedbus" },
  { from: "storage", to: "sharedbus" },
  { from: "sharedbus", to: "background" },
  { from: "sharedbus", to: "aprontrafo" },
  { from: "sharedbus", to: "parkingtrafo" },
  { from: "aprontrafo", to: "fleet" },
  { from: "parkingtrafo", to: "parking" },
];
function connectionPath(positions: typeof MAP_POSITIONS, from: NodeId, to: NodeId) {
  const x1 = parseFloat(positions[from].left) * 9.4;
  const y1 = parseFloat(positions[from].top) * 5.6;
  const x2 = parseFloat(positions[to].left) * 9.4;
  const y2 = parseFloat(positions[to].top) * 5.6;
  const middle = (x1 + x2) / 2;
  return `M${x1} ${y1}H${middle}V${y2}H${x2}`;
}

function format(value: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return value.split("-").reverse().join(".");
}

function getControlValue(config: CoupledConfig, control: Control) {
  if (control.kind === "power") return config.power[control.key];
  return config.fleets.find((fleet) => fleet.kind === control.fleet)?.vehicles ?? 0;
}

function updateControl(config: CoupledConfig, control: Control, value: number): CoupledConfig {
  if (control.kind === "power") {
    return { ...config, power: { ...config.power, [control.key]: value } };
  }
  return {
    ...config,
    fleets: config.fleets.map((fleet) =>
      fleet.kind === control.fleet ? { ...fleet, vehicles: value } : fleet,
    ),
  };
}

function frozenRecord(records: readonly CoupledRecord[] | null | undefined) {
  if (!records || records.length !== 2 || records.some((record) => !record.summary)) return null;
  const hashes = new Set(
    records.map((record) => record.model_pack_snapshot.calibration_meta.coupled_world.world_hash),
  );
  if (hashes.size !== 1 || records.some((record) => record.status.state !== "completed"))
    return null;
  return (
    records.find((record) => record.model_pack_snapshot.parameter_set.policy === "uncontrolled") ??
    records[0]
  );
}

export default function SystemExplorer({
  config,
  setConfig,
  plan,
  records,
  startControlId,
}: {
  config: CoupledConfig;
  setConfig: (config: CoupledConfig) => void;
  plan?: FlightPlanSnapshot | null;
  records?: readonly CoupledRecord[] | null;
  startControlId?: string;
}) {
  const [mode, setMode] = useState<ViewMode>("map");
  const [selected, setSelected] = useState<NodeId>("grid");
  const [highlightPath, setHighlightPath] = useState(false);
  const record = useMemo(() => frozenRecord(records), [records]);
  const spec = NODES[selected];
  const referenceConfig = record?.model_pack_snapshot.calibration_meta.coupled_world.config;
  const frozenPlan = record?.model_pack_snapshot.calibration_meta.flight_plan_snapshot;
  const contextMismatch = Boolean(
    frozenPlan && (!plan || plan.snapshot_id !== frozenPlan.snapshot_id),
  );
  const currentValue = spec.control ? getControlValue(config, spec.control) : null;
  const referenceValue =
    spec.control && referenceConfig ? getControlValue(referenceConfig, spec.control) : null;
  const delta =
    currentValue !== null && referenceValue !== null ? currentValue - referenceValue : null;
  const changed = delta !== null && delta !== 0;
  const activePath = highlightPath ? new Set(spec.path) : new Set<NodeId>();
  const totalFleet = config.fleets.reduce((sum, fleet) => sum + fleet.vehicles, 0);
  const evidence = record?.summary;
  const positions = mode === "map" ? MAP_POSITIONS : ENERGY_POSITIONS;

  function nodeValue(id: NodeId) {
    if (id === "flightplan")
      return plan ? `${plan.parsed_schedule_rows} Plan-Einträge` : "Plan auswählen";
    if (id === "missions")
      return evidence
        ? `${evidence.coupled_kpis.mission_count} Modellaufträge`
        : "Run erforderlich";
    if (id === "fleet") return `${totalFleet} Fahrzeuge`;
    if (id === "readiness")
      return evidence?.coupled_kpis.departure_readiness_pct === null || !evidence
        ? "n/a"
        : `${format(evidence.coupled_kpis.departure_readiness_pct)} %`;
    const control = NODES[id].control;
    return control
      ? `${format(getControlValue(config, control))} ${control.unit}`
      : NODES[id].valueLabel;
  }

  function nodeNote(id: NodeId) {
    if (id === "flightplan" && frozenPlan && contextMismatch)
      return `Nachweisplan ${formatDate(frozenPlan.service_date)}`;
    if ((id === "missions" || id === "readiness") && record)
      return `eingefrorener Run ${record.status.run_id.slice(0, 8)}`;
    return NODES[id].valueLabel;
  }

  function scrollToStart() {
    const target = startControlId ? document.getElementById(startControlId) : null;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }

  return (
    <section className="system-explorer" aria-labelledby="system-explorer-title">
      <header className="system-explorer__header">
        <div>
          <p className="system-explorer__kicker">Systemzusammenhänge verstehen</p>
          <h2 id="system-explorer-title">Airport System Explorer</h2>
          <p>
            Flugplan, Fahrzeugaufträge und Energieannahmen als prüfbares Modellbild. Knoten
            auswählen, Annahmen ändern, Wirkungspfade einordnen.
          </p>
        </div>
        <span className={changed ? "system-explorer__draft is-changed" : "system-explorer__draft"}>
          {changed ? "Entwurf geändert" : "Aktuelle Entwurfsannahmen"}
        </span>
      </header>

      <div className="system-explorer__tabs" role="tablist" aria-label="Systemansicht">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "map"}
          aria-controls="system-explorer-canvas"
          onClick={() => setMode("map")}
        >
          <strong>Systemlandkarte</strong>
          <small>Einstieg und Wirkungskette</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "energy"}
          aria-controls="system-explorer-canvas"
          onClick={() => setMode("energy")}
        >
          <strong>Energiefluss</strong>
          <small>Quellen, Modellbus, Abgänge</small>
        </button>
      </div>

      <p className="system-explorer__boundary">
        <strong>Methodenprototyp.</strong> Die Karte zeigt Modellbeziehungen, keine bestätigte
        elektrische Topologie. Änderungen sind nur Entwurfswerte: Sie starten weder Hardware noch
        ändern sie vorhandene Ergebnisse.
      </p>

      <div className="system-explorer__workspace">
        <section className="system-explorer__card" aria-labelledby="system-explorer-map-title">
          <div className="system-explorer__map-head">
            <div>
              <h3 id="system-explorer-map-title">
                {mode === "map"
                  ? "Ein Flughafen, zwei gekoppelte Modellketten"
                  : "Quellen, gemeinsames Budget und Ladeabgänge"}
              </h3>
              <p>
                {mode === "map"
                  ? "Auftragskette oben, Energiefluss unten."
                  : "Technische Modellansicht, kein Netzplan."}
              </p>
            </div>
            <span>
              {changed ? "Änderung noch nicht berechnet" : "Kein neuer Vergleich gestartet"}
            </span>
          </div>
          <div
            className="system-explorer__diagram-scroll"
            role="region"
            aria-label={
              mode === "map" ? "Interaktive Systemgrafik" : "Technische Energieflussgrafik"
            }
            tabIndex={0}
          >
            <div
              id="system-explorer-canvas"
              className={`system-explorer__diagram ${mode === "energy" ? "is-technical" : ""}`}
              role="tabpanel"
            >
              <svg
                className="system-explorer__edges"
                viewBox="0 0 940 560"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {CONNECTIONS.map(({ from, to, demand }) => (
                  <path
                    key={from + to}
                    d={connectionPath(positions, from, to)}
                    vectorEffect="non-scaling-stroke"
                    className={`${demand ? "is-demand" : ""} ${activePath.has(from) && activePath.has(to) ? "is-affected" : ""}`}
                  />
                ))}
              </svg>
              {(Object.keys(NODES) as NodeId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`system-explorer__node ${id === selected ? "is-selected" : ""} ${
                    activePath.has(id) ? "is-affected" : ""
                  } ${id === "sharedbus" ? "is-hub" : ""}`}
                  style={positions[id]}
                  aria-pressed={id === selected}
                  aria-label={`${NODES[id].label} untersuchen`}
                  onClick={() => {
                    setSelected(id);
                    setHighlightPath(false);
                  }}
                >
                  <span>{NODES[id].label}</span>
                  <strong>{nodeValue(id)}</strong>
                  <small>{nodeNote(id)}</small>
                </button>
              ))}
            </div>
          </div>
          <footer className="system-explorer__legend">
            <span>
              <i className="is-demand" />
              Auftragskopplung
            </span>
            <span>
              <i />
              Energie-/Leistungsmodell
            </span>
            <span>
              <i className="is-affected" />
              qualitativ hervorgehobener Pfad
            </span>
            <span>Schema, keine verifizierte elektrische Topologie</span>
          </footer>
        </section>

        <aside
          className="system-explorer__inspector"
          aria-labelledby="system-explorer-inspector-title"
        >
          <div>
            <p className="system-explorer__kicker">Komponente untersuchen</p>
            <h3 id="system-explorer-inspector-title">{spec.label}</h3>
            <p>{spec.description}</p>
          </div>
          {spec.control ? (
            <div className="system-explorer__control">
              <label htmlFor="system-explorer-value">{spec.control.label}</label>
              <div>
                <input
                  id="system-explorer-value"
                  type="number"
                  min={0}
                  required
                  step={spec.control.step}
                  value={
                    typeof currentValue === "number" && Number.isFinite(currentValue)
                      ? currentValue
                      : ""
                  }
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(next) && next >= 0)
                      setConfig(updateControl(config, spec.control!, next));
                  }}
                />
                <span>{spec.control.unit}</span>
              </div>
              {referenceValue !== null ? (
                <dl className="system-explorer__diff">
                  <div>
                    <dt>Eingefrorener Run</dt>
                    <dd>
                      {format(referenceValue)} {spec.control.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Aktueller Entwurf</dt>
                    <dd>
                      {format(currentValue!)} {spec.control.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Differenz</dt>
                    <dd className={changed ? "is-changed" : ""}>
                      {delta === 0
                        ? "unverändert"
                        : `${delta! > 0 ? "+" : ""}${format(delta!)} ${spec.control.unit}`}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="system-explorer__small">
                  Kein eingefrorener Vergleich: Der Wert ist nur ein Entwurf.
                </p>
              )}
            </div>
          ) : (
            <p className="system-explorer__small">
              Dieser Knoten wird aus Flugplan oder Simulationsnachweis abgeleitet und hat hier
              keinen direkten Eingabewert.
            </p>
          )}
          <div className="system-explorer__impact">
            <h4>Möglicher Wirkungspfad im Modell</h4>
            <ol>
              {spec.path.map((id) => (
                <li key={id}>{NODES[id].label}</li>
              ))}
            </ol>
            <p>
              Pfeile zeigen Beziehungen. Sie sind keine berechnete Wirkung und keine
              Kausalzuschreibung.
            </p>
          </div>
          <button
            type="button"
            className="system-explorer__secondary"
            onClick={() => setHighlightPath((value) => !value)}
          >
            {highlightPath ? "Hervorhebung ausblenden" : "Wirkungspfad hervorheben"}
          </button>
          {startControlId && (
            <button type="button" className="system-explorer__start" onClick={scrollToStart}>
              Zum Vergleich starten
            </button>
          )}
        </aside>
      </div>

      {evidence ? (
        <section
          className="system-explorer__evidence"
          aria-label="Eingefrorener Simulationsnachweis"
        >
          <div>
            <span>Auditierter Simulationsnachweis</span>
            <strong>
              {evidence.coupled_kpis.departure_readiness_pct === null
                ? "n/a"
                : `${format(evidence.coupled_kpis.departure_readiness_pct)} %`}
            </strong>
            <small>
              modellierte Abflugbereitschaft · Verkehrstag {formatDate(frozenPlan!.service_date)} ·
              Run {record!.status.run_id.slice(0, 8)}
            </small>
          </div>
          <div>
            <span>Netzspitze</span>
            <strong>{format(evidence.energy_kpis.grid_peak_kw)} kW</strong>
            <small>aus eingefrorenem Modelllauf</small>
          </div>
          <div>
            <span>Engpasshinweis im Nachweis</span>
            <strong>
              {format(evidence.coupled_kpis.energy_wait_total_min)} /{" "}
              {format(evidence.coupled_kpis.resource_wait_total_min)} min
            </strong>
            <small>Energie- / Ressourcenwartezeit; keine Ursachenzuschreibung</small>
          </div>
          <p>
            Aktuelle Entwurfswerte ändern diese Nachweise nicht. Der Nachweis ist ein auditierter
            Simulationslauf, keine empirische Validierung und keine Aussage über reale
            Flughafenwirkung.
          </p>
          {contextMismatch && (
            <p>
              <strong>Kontextabweichung:</strong>{" "}
              {plan
                ? "Der aktuelle Flugplan gehört nicht zu diesem Nachweisplan."
                : "Aktueller Flugplan fehlt; die Kennzahlen gehören ausschließlich zum eingefrorenen Nachweisplan."}
            </p>
          )}
        </section>
      ) : (
        <section className="system-explorer__evidence is-empty" aria-label="Simulationsstatus">
          <p>
            Keine eingefrorenen Simulationsnachweise. Ergebnis-KPIs bleiben n/a, bis ein geprüfter
            Vergleich vorliegt.
          </p>
        </section>
      )}
    </section>
  );
}
