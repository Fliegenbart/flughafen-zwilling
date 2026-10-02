# COMTRADE Roadmap (Phase 2)

## Scope
In Phase 1 wird ein normierter CSV-Export bereitgestellt.
COMTRADE (IEEE C37.111) ist als naechste Interop-Stufe spezifiziert.

## Zielbild
- Export von stoerungsrelevanter Telemetrie als COMTRADE:
- Konfigurationsdatei (`.cfg`)
- Datendatei (`.dat`, ASCII/BIN)

## Kanal-Mapping (Vorschlag)
- Analogkanaele:
  - `frequency_hz`
  - `voltage_v`
  - `load_kw`
  - `battery_power_kw`
  - `diesel_power_kw`
  - `io_latency_ms`
- Digitalkanaele:
  - `grid_on`
  - `watchdog_fail_safe`

## Abtastratenstrategie
- Basisrate: `scenario.tick_ms`
- Event-Marker fuer Zustandswechsel (z. B. Grid-Off, Load-Shed, Watchdog-Timeout)
- Optional Multi-Rate fuer hochfrequente Schutzsignale

## Qualitätsregeln
- Keine Spalten-/Kanalverluste gegenueber `telemetry.jsonl`
- Deterministische Re-Exporte aus identischem Run-Record
- Run-Metadaten (`run_id`, `seed`, `model_pack_id`) als Header-Kommentar
