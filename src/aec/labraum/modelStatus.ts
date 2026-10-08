/** Einordnung der Austausch-Punkte und Status "Modell gegen Messung" im Lab-Raum. */
import type { Role } from "../api/role";
import type { DataInputs } from "../model/dataStatus";
import type { ExchangeItem, Party } from "../types";

export const canAct = (role: Role, party: Party) =>
  role === "admin" || (role === "airport" ? party === "flughafen" : party === "lab");

/** Drei Teilfragen zu „Stimmt das?“: was wird geprüft, was gemessen, hält das Modell. */
export const isQuestion = (i: ExchangeItem) => i.kind === "testanfrage" || i.kind === "szenario";
export const isMeasured = (i: ExchangeItem) => i.kind === "ergebnis" || i.kind === "auswertung";

/**
 * Modellabgleich ehrlich benennen: nur PASS auf Holdout-Messdaten mit vorab
 * gesperrten Kriterien zaehlt. Alles andere bleibt offen.
 */
export function modelAnswer(inp: DataInputs): { answer: string; detail: string } {
  const holdout = inp.imports.filter((i) => i.role === "holdout" && i.valid);
  if (inp.holdoutPass)
    return {
      answer: "Holdout bestanden.",
      detail:
        "Das Modell hält die vorab gesperrten Toleranzen gegen die zurückgehaltene Messreihe ein, gültig für den gemessenen Zeitraum.",
    };
  if (!inp.available)
    return {
      answer: "Noch nicht geprüft.",
      detail: "Das Beispielprojekt hat keine Messreihe, das Modell bleibt hier unkalibriert.",
    };
  if (!holdout.length)
    return {
      answer: "Noch kein Holdout vorhanden.",
      detail:
        "Eine Messreihe unter „Daten“ als Holdout einlesen. Sie wird nicht zur Kalibrierung verwendet.",
    };
  if (!inp.tolerances?.locked)
    return {
      answer: "Toleranzen noch nicht gesperrt.",
      detail: `${holdout.length === 1 ? "Ein Holdout liegt" : `${holdout.length} Holdouts liegen`} vor. Bewertet wird erst gegen gesperrte Toleranzen.`,
    };
  return {
    answer: "Holdout noch nicht bestanden.",
    detail:
      "Holdout und gesperrte Toleranzen liegen vor, eine bestandene Bewertung fehlt. Bewerten unter „Modell gegen Messung“.",
  };
}
