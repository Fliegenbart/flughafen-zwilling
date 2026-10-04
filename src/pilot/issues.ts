const labels: Record<string, string> = {
  model_provenance_not_server_verified:
    "Die Modellwerte stammen nicht aus einem serverseitig geprüften Run-Abgleich.",
  calibration_holdout_overlap: "Kalibrierung und Holdout überlappen zeitlich.",
  model_provenance_unverified:
    "Die Herkunft der Modellwerte ist nicht durch einen gespeicherten Run belegt.",
  import_quality_invalid: "Die Quelldaten erfüllen die Qualitätsanforderungen nicht.",
  model_kw_column_missing_or_incomplete: "Modellwerte fehlen oder sind unvollständig.",
  timestamp_gap: "Unregelmäßiger Zeitabstand / mögliche Messlücke.",
  duplicate_timestamp: "Doppelter Zeitstempel.",
  non_monotonic_timestamp: "Zeitstempel sind nicht aufsteigend.",
  timestamp_timezone_required: "Zeitstempel benötigen eine Zeitzone.",
  measured_kw_not_finite: "Messwert fehlt oder ist keine endliche Zahl.",
  model_kw_not_finite: "Modellwert ist keine endliche Zahl.",
  too_few_rows: "Mindestens zwei Messpunkte erforderlich.",
  measured_energy_zero: "Relative Energieabweichung ist bei Nettoenergie null nicht definiert.",
};
export const issueLabel = (issue: string) => labels[issue] ?? issue;
