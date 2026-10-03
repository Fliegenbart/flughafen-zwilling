export type FlightEntry = {
  entry_id: string;
  direction: "arrival" | "departure";
  flight_number: string;
  airline: string;
  counterpart_iata: string;
  terminal: string;
  scheduled_local: string;
  scheduled_utc: string;
  source_pages: number[];
  possible_shared_group: string | null;
};

export type FlightPlanSnapshot = {
  snapshot_id: string;
  content_sha256: string;
  source_pdf_sha256: string;
  source_url: string;
  import_method: "manual_user_upload";
  parser_version: string;
  evidence_level: "published_schedule_not_actual";
  timezone: "Europe/Berlin";
  source_data_date: string;
  service_date: string;
  imported_at: string;
  parsed_schedule_rows: number;
  arrival_entry_count: number;
  departure_entry_count: number;
  duplicate_rows_removed: number;
  possible_shared_flight_groups: number;
  rows: FlightEntry[];
  hourly_counts: { hour: number; arrivals: number; departures: number }[];
  warnings: string[];
};

export type FlightPlanInfo = Omit<FlightPlanSnapshot, "rows" | "hourly_counts">;
export const flightDate = (value: string) => value.split("-").reverse().join(".");
