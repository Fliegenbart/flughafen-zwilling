/** Worauf die Zahlen beruhen: heutiger Stand in einem Satz, Datenlage und Annahme zum Krisenfall. */
import type { Preview } from "../api/preview";
import { dec1, powerText, unit } from "../model/format";
import type { DataStatus } from "../model/dataStatus";
import { POLICY_LABEL } from "../model/policy";
import type { VariantBoard } from "../types";

export default function BasisNote({
  today,
  exact,
  board,
  status,
  sample,
}: {
  today: Preview;
  exact: Preview | null;
  board: VariantBoard | null;
  status: DataStatus | null;
  sample: boolean;
}) {
  const p = today.basis.power;
  const fleet = board?.base?.fleet.total;
  const standing = [
    fleet ? `${fleet} Fahrzeuge` : null,
    `Netzanschluss ${powerText(p.gridImportLimitKw)}`,
    p.batteryCapacityKwh
      ? `Batteriespeicher ${unit(dec1(p.batteryCapacityKwh / 1000), "MWh")}`
      : "kein Batteriespeicher",
    p.pvCapacityKwp
      ? `Photovoltaik ${unit(dec1(p.pvCapacityKwp / 1000), "MWp")}`
      : "keine Photovoltaik",
  ].filter(Boolean);
  const crisis = exact?.crisis;
  return (
    <details className="ap-basis">
      <summary>Worauf diese Zahlen beruhen</summary>
      <p>
        Heute: {standing.join(", ")}. {today.policy ? `${POLICY_LABEL[today.policy]}.` : ""}
      </p>
      <p>
        {sample
          ? "Ein erfundener Beispieltag mit Annahmen für die Vorführung, nichts davon stammt von einem Flughafen."
          : (status?.answer ?? "")}{" "}
        Das Modell ist nicht an Messungen kalibriert.
      </p>
      {crisis ? (
        <p>
          Annahme für „{crisis.name}“. {crisis.assumption}
        </p>
      ) : null}
    </details>
  );
}
