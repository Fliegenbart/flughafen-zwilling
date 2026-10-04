/**
 * Verstaendliche Erklaerungen fuer Qualitaets- und NOT_EVALUABLE-Gruende.
 * Schluessel sind die stabilen Backend-Codes; unbekannte Codes werden roh angezeigt.
 */
const labels: Record<string, string> = {
  // Bewertungsrahmen
  tolerances_not_frozen:
    "Für dieses Projekt wurden vor der Bewertung keine Abnahmekriterien festgelegt. Ohne vorab vereinbarte Grenzen ist kein PASS möglich.",
  tolerances_not_locked:
    "Die Abnahmekriterien sind nur als Entwurf gespeichert und noch nicht gesperrt.",
  tolerances_set_after_import:
    "Die Abnahmekriterien wurden erst nach dem Import dieser Messdaten festgelegt. Grenzen müssen vor dem Blick auf die Daten stehen.",
  role_not_holdout:
    "Nur ein unabhängiger Holdout-Datensatz kann PASS ergeben. Kalibrier- und Labordaten dienen der Anpassung bzw. Diagnose.",
  calibration_holdout_overlap:
    "Kalibrier- und Holdout-Zeitraum überlappen. Der Holdout ist dann nicht unabhängig.",
  overlap_unverifiable:
    "Ob Kalibrier- und Holdout-Zeitraum überlappen, ließ sich nicht prüfen; deshalb kein Urteil.",
  insufficient_rows: "Zu wenige Messpunkte für die vorab festgelegte Mindestzahl.",
  insufficient_coverage:
    "Der gemeinsam abgedeckte Zeitraum von Messung und Modell ist kürzer als die vorab festgelegte Mindestabdeckung.",
  tolerance_mae_too_loose_for_measurement:
    "Die MAE-Grenze ist größer als die Hälfte der mittleren Messleistung und damit zu weit, um etwas zu prüfen.",
  circular:
    "Messreihe und Modellreihe sind identisch (zirkulär). Das Modell wird mit sich selbst verglichen; kein unabhängiger Nachweis.",
  unit_suspect:
    "Einheitenverdacht: Werte sind unplausibel groß oder um Größenordnungen gegeneinander verschoben (z. B. W statt kW).",
  metric_overflow: "Die Kennzahlen sind numerisch nicht berechenbar (Überlauf).",
  measured_energy_zero: "Relative Energieabweichung ist bei Nettoenergie null nicht definiert.",
  measured_energy_signed_cancellation:
    "Bezug und Rückspeisung heben sich fast auf; der relative Energiefehler wäre nicht aussagekräftig.",
  too_few_paired_rows: "Weniger als zwei gemeinsame Mess-/Modellpunkte.",
  paired_coverage_missing: "Kein gemeinsam abgedeckter Zeitraum von Messung und Modell.",
  paired_timestamps_not_monotonic: "Zeitstempel der Paarung sind nicht aufsteigend.",
  interval_end_mean_requires_regular_intervals:
    "Intervallmittel verlangen gleichmäßige Zeitabstände.",
  sample_semantics_unknown: "Unbekannter Zeitbezug der Messwerte.",
  // Herkunft
  model_provenance_not_server_verified:
    "Die Modellwerte stammen nicht aus einem serverseitig geprüften Run-Abgleich.",
  model_provenance_unverified:
    "Die Herkunft der Modellwerte ist nicht durch einen gespeicherten Run belegt.",
  model_kw_column_missing_or_incomplete: "Modellwerte fehlen oder sind unvollständig.",
  // Quelldatei
  import_quality_invalid: "Die Quelldaten erfüllen die Qualitätsanforderungen nicht.",
  source_raw_missing: "Die gespeicherte Originaldatei fehlt.",
  source_raw_hash_mismatch: "Die Originaldatei wurde nach dem Import verändert (Hash weicht ab).",
  source_raw_not_utf8: "Die Originaldatei ist nicht als UTF-8 lesbar.",
  source_revalidation_failed: "Die erneute Prüfung der Originaldatei ist fehlgeschlagen.",
  csv_header_missing: "Kopfzeile der CSV fehlt.",
  csv_parse_error: "CSV konnte nicht gelesen werden.",
  duplicate_column: "Spaltenname doppelt.",
  unexpected_column: "Unerwartete Spalte.",
  unexpected_column_value: "Zeile mit zusätzlichen Werten.",
  required_column_missing: "Pflichtspalte fehlt (timestamp, measured_kw).",
  too_many_rows: "Mehr als 100.000 Zeilen.",
  timestamp_gap: "Unregelmäßiger Zeitabstand / mögliche Messlücke.",
  duplicate_timestamp: "Doppelter Zeitstempel.",
  non_monotonic_timestamp: "Zeitstempel sind nicht aufsteigend.",
  timestamp_timezone_required: "Zeitstempel benötigen eine Zeitzone.",
  measured_kw_not_finite: "Messwert fehlt oder ist keine endliche Zahl.",
  model_kw_not_finite: "Modellwert ist keine endliche Zahl.",
  too_few_rows: "Mindestens zwei Messpunkte erforderlich.",
};
export const issueLabel = (issue: string) => labels[issue] ?? issue;
export const hasIssueLabel = (issue: string) => issue in labels;

/** Kurzfassung des Bewertungsstatus in Klartext. */
export function statusLabel(status: string): string {
  if (status === "PASS") return "Bestanden: Abweichung innerhalb der vorab gesperrten Grenzen";
  if (status === "FAIL") return "Nicht bestanden: Abweichung außerhalb der gesperrten Grenzen";
  return "Nicht auswertbar: Voraussetzungen für ein Urteil fehlen";
}
