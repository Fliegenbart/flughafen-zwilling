/** Was die Kurve einer Stufe zeigt und welcher Satz darueber steht. */
import type { ElectrificationComparison } from "../api/electrification";
import { resultFromExact, type LiveBasis, type LiveResult } from "../model/livePower";
import { lineFor, type Line, type StageId } from "./stufen";

export const REASONS: Record<string, string> = {
  service_deadlines: "nicht alle Einsätze werden rechtzeitig fertig",
  parking_deadlines: "im Parkhaus werden nicht alle Autos voll",
  background_supply: "der übrige Flughafen bekommt nicht genug Strom",
  vehicle_recharge: "die Fahrzeuge sind am Ende nicht wieder geladen",
  storage_recharge: "der Speicher ist am Ende nicht wieder geladen",
  energy_balance: "die Energiebilanz geht nicht auf",
};

/** Ohne Steuerung bremst nichts: was ueber dem Anschluss liegt, ist Ueberlast (rot im Diagramm). */
export function againstConnection(basis: LiveBasis, connectionKw: number): LiveResult {
  const load = basis.gridImportKw ?? [];
  return resultFromExact({
    ...basis,
    gridCapKw: load.map(() => connectionKw),
    gridImportKw: load.map((v) => Math.min(v, connectionKw)),
    requestedKw: load.map((v) => Math.max(0, v - connectionKw)),
    deliveredKw: load.map(() => 0),
    batteryKw: load.map(() => 0),
  });
}

export type Rechnung = StageId | "direct";
export type Note = { text: string; tone: "ok" | "stop" | "neutral" };

/** Kurve, Vergleichslinie und Satz fuer eine Rechnung; null, solange der Server rechnet. */
export function curveFor(
  data: ElectrificationComparison | null,
  which: Rechnung,
  connectionKw: number,
  line: Line = lineFor(null, false),
): {
  result: LiveResult;
  base: LiveResult;
  departures: ElectrificationComparison["variants"][number]["departures"];
  note: Note;
} | null {
  const uncontrolled = data?.uncontrolled;
  if (!data || !uncontrolled) return null;
  const base = againstConnection(uncontrolled.basis, connectionKw);
  if (which === "uncontrolled")
    return {
      result: base,
      base,
      departures: uncontrolled.departures,
      note: base.shortfalls.length
        ? {
            // Bei offener Reserve ist die Linie nur der Bedarf mit Lademanagement: keine Ueberlast.
            tone: line.overload ? "stop" : "neutral",
            text: `Ohne Steuerung liegen die Ladespitzen über ${line.yourDat}.${line.overload ? " Das wäre Überlast." : ""}`,
          }
        : { tone: "ok", text: `${line.nom} trägt auch ungesteuertes Laden.` },
    };
  const variant = data.variants.find((v) => v.solution === which);
  if (!variant) return null;
  const result = resultFromExact(variant.basis);
  return {
    result,
    base,
    departures: variant.departures,
    note: variant.checks.feasible
      ? {
          tone: "ok",
          text: result.shortfalls.length
            ? `Ladespitzen über ${line.dat} werden verschoben, alle Einsätze bleiben pünktlich.`
            : `${line.nom} reicht an allen drei Tagen.`,
        }
      : {
          tone: "stop",
          text: `Hier reicht ${line.nomLower} nicht: ${REASONS[variant.checks.reasons[0] ?? ""] ?? "das Modell findet keine Lösung"}.`,
        },
  };
}

/** Solange keine Kurve da ist: rechnet, fehlt auf dem Server oder ist fehlgeschlagen. */
export function CurveWaiting({
  error,
  incomplete,
  onRetry,
}: {
  error: string;
  /** Rechnung da, aber ohne Kurve ohne Steuerung (aelterer Server). */
  incomplete: boolean;
  onRetry: () => void;
}) {
  if (error)
    return (
      <p className="oe-error" role="alert">
        {error}{" "}
        <button type="button" className="oe-tool" onClick={onRetry}>
          Erneut rechnen
        </button>
      </p>
    );
  return (
    <p className="oe-loading" role="status">
      {incomplete
        ? "Der Server liefert noch keine Kurve ohne Steuerung."
        : "Die Kurve wird gerechnet …"}
    </p>
  );
}
