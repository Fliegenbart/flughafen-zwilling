/** Kleine, typsichere Leser fuer API-Antworten. */
import type { EvidenceLevel } from "../../ui/EvidenceBadge";

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
export const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
export const enc = encodeURIComponent;

export const EVIDENCE_FROM_API: Record<string, EvidenceLevel> = {
  assumption: "assumption",
  synthetic: "synthetic",
  model_checked: "model_checked",
  empirical_open: "empirical_open",
  empirical_pass: "empirical_passed",
};
export const evidence = (v: unknown, d: EvidenceLevel = "assumption"): EvidenceLevel =>
  EVIDENCE_FROM_API[str(v)] ?? d;
