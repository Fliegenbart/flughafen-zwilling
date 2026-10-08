/** Laderegeln des Modells: Typ und Beschriftung an einer Stelle (ohne Satzzeichen am Ende). */
export type ChargingPolicy = "uncontrolled" | "mission_priority";

export const POLICY_LABEL: Record<ChargingPolicy, string> = {
  uncontrolled: "Jedes Fahrzeug lädt, sobald es steckt",
  mission_priority: "Wer zuerst los muss, lädt zuerst",
};

export const isPolicy = (v: unknown): v is ChargingPolicy =>
  v === "uncontrolled" || v === "mission_priority";
