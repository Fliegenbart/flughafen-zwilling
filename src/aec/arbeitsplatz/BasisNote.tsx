/** Worauf die Zahlen beruhen: heutiger Stand in einem Satz, Datenlage und Annahme zum Krisenfall. */
import type { Preview } from "../api/preview";
import { dec1, powerText } from "../model/format";
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
      ? `Batteriespeicher ${dec1(p.batteryCapacityKwh / 1000)} MWh`
      : "kein Batteriespeicher",
    p.pvCapacityKwp ? `Photovoltaik ${dec1(p.pvCapacityKwp / 1000)} MWp` : "keine Photovoltaik",
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
          ? "Ein erfundener Beispieltag mit Standardwerten, nichts davon stammt von einem Flughafen."
          : status
            ? `${status.real} von ${status.total} Datenquellen sind mit Quelle belegt, für den Rest gelten Annahmen.`
            : ""}{" "}
        Das Modell ist nicht an Messungen kalibriert.
      </p>
      {crisis ? (
        <p>
          Annahme zu „{crisis.name}“: {crisis.assumption}
        </p>
      ) : null}
    </details>
  );
}
