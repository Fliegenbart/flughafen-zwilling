/** Kurzbeschreibung einer festgehaltenen Loesung in Alltagssprache. */
import { FLEET_LABEL } from "../../model/fleet";
import { dec1, powerText } from "../../model/format";
import { POLICY_LABEL } from "../../model/policy";
import type { FleetKind, VariantChanges } from "../../types";

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
  if (changes.charging_policy) parts.push(POLICY_LABEL[changes.charging_policy]);
  if (changes.pv_factor !== undefined) parts.push(`Photovoltaik × ${dec1(changes.pv_factor)}`);
  return parts.join(" · ");
}
