/** Vorschlaege und Kurzbeschreibung einer Loesung relativ zum heutigen Stand. */
import { FLEET_LABEL } from "../../model/fleet";
import { dec1, powerText } from "../../model/format";
import type { FleetKind, VariantBoard, VariantChanges } from "../../types";

/** Vorschlaege relativ zur Projekt-Basis; nur gueltige Aenderungen werden angeboten. */
export function suggestions(board: VariantBoard): { name: string; changes: VariantChanges }[] {
  const base = board.base;
  if (!base) return [];
  const list: { name: string; changes: VariantChanges }[] = [
    { name: "5 Schlepper mehr", changes: { extra_vehicles: { pushback_tug: 5 } } },
    { name: "Batteriespeicher 2 MWh", changes: { storage_kwh: 2000, storage_kw: 1000 } },
    {
      name: "1 MW mehr Anschluss",
      changes: { grid_import_limit_kw: base.gridLimitKw + 1000 },
    },
  ];
  if (base.policy !== "mission_priority")
    list.push({
      name: "Wer zuerst los muss, lädt zuerst",
      changes: { charging_policy: "mission_priority" },
    });
  const taken = new Set(board.definitions.map((d) => d.name.toLowerCase()));
  return list.filter((s) => !taken.has(s.name.toLowerCase()));
}

export function describeChanges(changes: VariantChanges): string {
  const parts: string[] = [];
  if (changes.grid_import_limit_kw !== undefined)
    parts.push(`Netzanschluss ${powerText(changes.grid_import_limit_kw)}`);
  if (changes.storage_kwh)
    parts.push(
      `Batteriespeicher ${dec1(changes.storage_kwh / 1000)} MWh mit ${powerText(changes.storage_kw ?? changes.storage_kwh / 2)}`,
    );
  for (const [k, n] of Object.entries(changes.extra_vehicles ?? {}))
    parts.push(`${n} ${FLEET_LABEL[k as FleetKind] ?? k} mehr`);
  for (const [k, n] of Object.entries(changes.chargers_offline ?? {}))
    parts.push(`${n} Ladepunkte für ${FLEET_LABEL[k as FleetKind] ?? k} ausgefallen`);
  if (changes.charging_policy)
    parts.push(
      changes.charging_policy === "mission_priority"
        ? "Wer zuerst los muss, lädt zuerst"
        : "Jedes Fahrzeug lädt, sobald es steckt",
    );
  if (changes.pv_factor !== undefined) parts.push(`Photovoltaik × ${dec1(changes.pv_factor)}`);
  return parts.join(" · ");
}
