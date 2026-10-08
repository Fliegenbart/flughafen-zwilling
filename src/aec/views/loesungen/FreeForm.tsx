/** Eigene Loesung zusammenstellen: ein Hebel je Loesung. */
import { useState } from "react";
import { FLEET_LABEL } from "../../model/fleet";
import type { FleetKind, VariantChanges } from "../../types";
import { describeChanges } from "./levers";

type Lever = "anschluss" | "speicher" | "fahrzeuge" | "laderegel" | "ausfall" | "pv";

export default function FreeForm({
  onAdd,
  busy,
}: {
  onAdd: (name: string, c: VariantChanges) => void;
  busy: boolean;
}) {
  const [lever, setLever] = useState<Lever>("fahrzeuge");
  const [name, setName] = useState("");
  const [value, setValue] = useState("3");
  const [value2, setValue2] = useState("");
  const [kind, setKind] = useState<FleetKind>("pushback_tug");
  const [policy, setPolicy] = useState<"mission_priority" | "uncontrolled">("mission_priority");

  const build = (): VariantChanges | null => {
    const n = Number(value.replace(",", "."));
    if (lever === "laderegel") return { charging_policy: policy };
    if (!Number.isFinite(n)) return null;
    if (lever === "anschluss") return { grid_import_limit_kw: n };
    if (lever === "pv") return { pv_factor: n };
    if (lever === "fahrzeuge") return { extra_vehicles: { [kind]: Math.round(n) } };
    if (lever === "ausfall") return { chargers_offline: { [kind]: Math.round(n) } };
    const kw = Number(value2.replace(",", "."));
    return value2.trim() && Number.isFinite(kw)
      ? { storage_kwh: n, storage_kw: kw }
      : { storage_kwh: n };
  };
  const label: Record<Lever, string> = {
    anschluss: "Netzanschluss (kW)",
    speicher: "Batteriespeicher (kWh)",
    fahrzeuge: "Mehr Fahrzeuge",
    laderegel: "Laderegel",
    ausfall: "Ladepunkte fallen aus",
    pv: "Photovoltaik (× heute)",
  };

  return (
    <form
      className="aec-varform"
      onSubmit={(e) => {
        e.preventDefault();
        const changes = build();
        if (!changes) return;
        onAdd(name.trim() || describeChanges(changes), changes);
        setName("");
      }}
    >
      <label>
        <span>Was ändern Sie?</span>
        <select
          value={lever}
          onChange={(e) => {
            const l = e.target.value as Lever;
            setLever(l);
            setValue(
              {
                anschluss: "4500",
                speicher: "2000",
                fahrzeuge: "3",
                laderegel: "",
                ausfall: "1",
                pv: "1,5",
              }[l],
            );
            setValue2("");
          }}
        >
          {(Object.keys(label) as Lever[]).map((l) => (
            <option key={l} value={l}>
              {label[l]}
            </option>
          ))}
        </select>
      </label>
      {lever === "fahrzeuge" || lever === "ausfall" ? (
        <label>
          <span>Fahrzeugart</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FleetKind)}>
            {(Object.keys(FLEET_LABEL) as FleetKind[]).map((k) => (
              <option key={k} value={k}>
                {FLEET_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {lever === "laderegel" ? (
        <label>
          <span>Regel</span>
          <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
            <option value="mission_priority">Wer zuerst los muss, lädt zuerst</option>
            <option value="uncontrolled">Jedes Fahrzeug lädt, sobald es steckt</option>
          </select>
        </label>
      ) : (
        <label>
          <span>{lever === "fahrzeuge" || lever === "ausfall" ? "Anzahl" : label[lever]}</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
      )}
      {lever === "speicher" ? (
        <label>
          <span>Leistung in kW (freiwillig)</span>
          <input
            inputMode="decimal"
            value={value2}
            placeholder="sonst halbe Kapazität"
            onChange={(e) => setValue2(e.target.value)}
          />
        </label>
      ) : null}
      <label className="aec-varform__name">
        <span>Eigener Name (freiwillig)</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="aec-button aec-button--ghost" disabled={busy}>
        Hinzufügen
      </button>
    </form>
  );
}
