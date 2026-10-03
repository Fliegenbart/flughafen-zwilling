import type { Assumptions } from "./types";

export const DEFAULTS: Assumptions = {
  grid_import_limit_kw: 3500,
  grid_export_limit_kw: 2000,
  background_load_kw: 22000,
  chp_output_kw: 18000,
  parking_transformer_kva: 2500,
  bus_transformer_kva: 4500,
  power_factor: 0.95,
  pv_peak_factor: 0.55,
  parking_sessions: 200,
  bus_sessions: 50,
  parking_charger_kw: 11,
  bus_charger_kw: 80,
  charging_efficiency: 0.92,
  battery_capacity_kwh: 0,
  battery_power_kw: 1000,
  battery_initial_soc_pct: 50,
  battery_reserve_pct: 10,
  battery_efficiency: 0.95,
};

export const PRESETS = [
  {
    id: "reference",
    name: "Referenztag",
    note: "Ein synthetischer Sommertag. Ein Vorteil der Priorisierung ist nicht garantiert.",
    values: {},
  },
  {
    id: "constraint",
    name: "Anschluss-Engpass",
    note: "Hypothetisch: 2.500 kW Importgrenze. Kein Nachweis eines Engpasses in München.",
    values: { grid_import_limit_kw: 2500 },
  },
  {
    id: "winter",
    name: "Wenig Solarertrag",
    note: "Hypothetisch: schwaches PV-Profil und 3.000 kW Importgrenze. Kein Wetterdatensatz.",
    values: { grid_import_limit_kw: 3000, pv_peak_factor: 0.15 },
  },
  {
    id: "storage",
    name: "Speicheroption",
    note: "Anschluss-Engpass mit angenommener 2.000-kWh-Batterie. Beide Regeln erhalten denselben Speicher.",
    values: { grid_import_limit_kw: 2500, battery_capacity_kwh: 2000 },
  },
] satisfies { id: string; name: string; note: string; values: Partial<Assumptions> }[];

export const FIELDS: {
  key: keyof Assumptions;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  advanced?: boolean;
}[] = [
  {
    key: "grid_import_limit_kw",
    label: "Netz-Importgrenze",
    unit: "kW",
    min: 0,
    max: 100000,
    step: 100,
  },
  {
    key: "background_load_kw",
    label: "Campus-Grundlast",
    unit: "kW",
    min: 0,
    max: 100000,
    step: 100,
  },
  {
    key: "chp_output_kw",
    label: "BHKW-Fahrplan, konstant",
    unit: "kW",
    min: 0,
    max: 100000,
    step: 100,
  },
  { key: "pv_peak_factor", label: "PV-Profilfaktor", unit: "0–1", min: 0, max: 1, step: 0.05 },
  {
    key: "parking_transformer_kva",
    label: "Ladeabgang Parkhaus",
    unit: "kVA",
    min: 1,
    max: 20000,
    step: 1,
  },
  {
    key: "bus_transformer_kva",
    label: "Ladeabgang Busdepot",
    unit: "kVA",
    min: 1,
    max: 20000,
    step: 1,
  },
  {
    key: "battery_capacity_kwh",
    label: "Optionale Batterie",
    unit: "kWh; 0 = aus",
    min: 0,
    max: 50000,
    step: 500,
  },
  {
    key: "battery_power_kw",
    label: "Batterie-Leistungsgrenze",
    unit: "kW",
    min: 0,
    max: 20000,
    step: 100,
  },
  {
    key: "parking_sessions",
    label: "Parkhaus-Ladeaufträge",
    unit: "max. 275",
    min: 0,
    max: 275,
    step: 1,
    advanced: true,
  },
  {
    key: "bus_sessions",
    label: "Bus-Ladeaufträge",
    unit: "max. 50",
    min: 0,
    max: 50,
    step: 1,
    advanced: true,
  },
  {
    key: "parking_charger_kw",
    label: "Parkhaus je Ladepunkt",
    unit: "kW, angenommen",
    min: 1,
    max: 150,
    step: 1,
    advanced: true,
  },
  {
    key: "bus_charger_kw",
    label: "Bus je Ladepunkt",
    unit: "kW, angenommen",
    min: 1,
    max: 500,
    step: 1,
    advanced: true,
  },
  {
    key: "power_factor",
    label: "Leistungsfaktor",
    unit: "0–1",
    min: 0.01,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: "grid_export_limit_kw",
    label: "Netz-Exportgrenze",
    unit: "kW",
    min: 0,
    max: 100000,
    step: 100,
    advanced: true,
  },
  {
    key: "charging_efficiency",
    label: "Ladewirkungsgrad",
    unit: "0–1",
    min: 0.01,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: "battery_efficiency",
    label: "Speicherwirkungsgrad je Richtung",
    unit: "0–1",
    min: 0.01,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: "battery_initial_soc_pct",
    label: "Speicher-Start-SOC",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    advanced: true,
  },
  {
    key: "battery_reserve_pct",
    label: "Speicherreserve",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    advanced: true,
  },
];

export const number = (value: number, digits = 0) =>
  value.toLocaleString("de-DE", { maximumFractionDigits: digits });
export const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
