import { useEffect, useMemo, useRef, useState } from "react";
import { request, url } from "./api";
import { number } from "./config";
import { flightDate } from "./flightplanTypes";
import type { FlightPlanInfo, FlightPlanSnapshot } from "./flightplanTypes";
import "./FlightPlanPanel.css";

const SOURCE = "https://www.munich-airport.de/saisonflugplan";
const PAGE_SIZE = 50;

export default function FlightPlanPanel({
  selected,
  onSelect,
  onBusyChange,
  disabled = false,
}: {
  selected: FlightPlanSnapshot | null;
  onSelect: (plan: FlightPlanSnapshot | null) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [plans, setPlans] = useState<FlightPlanInfo[]>([]);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Berlin",
    }),
  );
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [direction, setDirection] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void request<FlightPlanInfo[]>("/munich/flight-plans", { signal: controller.signal })
      .then((list) => {
        if (!controller.signal.aborted) setPlans(list);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    onBusyChange?.(loading);
    return () => onBusyChange?.(false);
  }, [loading, onBusyChange]);

  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("de-DE");
    return (
      selected?.rows.filter(
        (r) =>
          (direction === "all" || r.direction === direction) &&
          [r.flight_number, r.airline, r.counterpart_iata, r.terminal].some((value) =>
            value.toLocaleLowerCase("de-DE").includes(search),
          ),
      ) ?? []
    );
  }, [selected, direction, query]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const maxHourly = Math.max(
    1,
    ...(selected?.hourly_counts.map((h) => Math.max(h.arrivals, h.departures)) ?? []),
  );

  async function choose(id: string) {
    active.current?.abort();
    if (!id) {
      onSelect(null);
      setError("");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const plan = await request<FlightPlanSnapshot>(`/munich/flight-plans/${id}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        onSelect(plan);
        setPage(0);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function upload() {
    if (!file) return;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const plan = await request<FlightPlanSnapshot>(
        `/munich/flight-plans?service_date=${encodeURIComponent(date)}`,
        {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/pdf" },
          signal: controller.signal,
        },
        45000,
      );
      if (!controller.signal.aborted) {
        setPlans((list) => [plan, ...list.filter((p) => p.snapshot_id !== plan.snapshot_id)]);
        onSelect(plan);
        setPage(0);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Import fehlgeschlagen");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section className="muc-panel muc-flightplan" aria-labelledby="muc-flightplan-title">
      <div className="muc-section-title">
        <h2 id="muc-flightplan-title">Münchner Flugplan</h2>
        <span>Manueller Snapshot / kein Live-Feed</span>
      </div>
      <p className="muc-small">
        Echte veröffentlichte Planzeiten statt erfundener Flugwellen. Den{" "}
        <a href={SOURCE} target="_blank" rel="noreferrer">
          offiziellen Saisonflugplan herunterladen
        </a>
        , dann PDF und Verkehrstag auswählen. Kein automatischer Abruf.
      </p>
      <form
        className="muc-flightplan__import"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <label className="muc-field">
          Verkehrstag
          <input
            type="date"
            value={date}
            required
            disabled={disabled || loading}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="muc-field">
          Saisonflugplan-PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={disabled || loading}
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setError("");
              if (next && (next.size > 6 * 1024 * 1024 || !/\.pdf$/i.test(next.name))) {
                setFile(null);
                setError("Bitte eine PDF-Datei mit maximal 6 MiB auswählen.");
              } else setFile(next);
            }}
          />
        </label>
        <button type="submit" disabled={disabled || loading || !file || !date}>
          {loading ? "Flugplan wird geladen…" : "PDF importieren"}
        </button>
      </form>
      {error && (
        <div className="muc-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError("");
              setReload((v) => v + 1);
            }}
          >
            Liste erneut laden
          </button>
        </div>
      )}
      <label className="muc-field muc-flightplan__selector">
        Gespeicherter Flugplantag
        <select
          value={selected?.snapshot_id ?? ""}
          disabled={disabled || loading}
          onChange={(e) => {
            void choose(e.target.value);
          }}
        >
          <option value="">Kein Flugplan-Kontext</option>
          {plans.map((p) => (
            <option key={p.snapshot_id} value={p.snapshot_id}>
              {flightDate(p.service_date)} / Stand {flightDate(p.source_data_date)} /{" "}
              {p.snapshot_id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <aside className="muc-flightplan__boundary">
        <strong>Flugplan-Kontext für den nächsten Vergleich.</strong> Der Import ändert noch keine
        Ladebedarfe oder Verspätungen. Dafür fehlen Fahrzeugaufträge, Energieprofile und
        Flugzeugumläufe. Die Energie-v1-Simulation bleibt synthetisch.
      </aside>
      {selected ? (
        <>
          <div className="muc-flightplan__stats">
            <div>
              <span>Verkehrstag</span>
              <strong>{flightDate(selected.service_date)}</strong>
            </div>
            <div>
              <span>Ankunftseinträge</span>
              <strong>{number(selected.arrival_entry_count)}</strong>
            </div>
            <div>
              <span>Abflugseinträge</span>
              <strong>{number(selected.departure_entry_count)}</strong>
            </div>
            <div>
              <span>Ungeklärte Mehrfachgruppen</span>
              <strong>{selected.possible_shared_flight_groups}</strong>
            </div>
          </div>
          <p className="muc-small">
            Datenstand: {flightDate(selected.source_data_date)} / Europe/Berlin. Geplante Einträge,
            keine bestätigte Anzahl physischer Flugbewegungen.
          </p>
          <div
            className="muc-flightplan__histogram"
            role="img"
            aria-label="Geplante Flugplaneinträge pro Stunde, Ankünfte und Abflüge"
          >
            {selected.hourly_counts.map((h) => (
              <div
                className="muc-flightplan__hour"
                key={h.hour}
                title={`${String(h.hour).padStart(2, "0")}:00 / ${h.arrivals} Ankünfte, ${h.departures} Abflüge`}
              >
                <div className="muc-flightplan__bars">
                  <i style={{ height: `${(h.arrivals / maxHourly) * 100}%` }} />
                  <i style={{ height: `${(h.departures / maxHourly) * 100}%` }} />
                </div>
                <small>{h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}</small>
              </div>
            ))}
          </div>
          <div className="muc-flightplan__legend">
            <span>Ankünfte</span>
            <span>Abflüge</span>
            <small>00–24 Uhr / Planzeit München</small>
          </div>
          <div className="muc-table-controls">
            <label>
              Flugrichtung
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Alle Einträge</option>
                <option value="arrival">Ankünfte</option>
                <option value="departure">Abflüge</option>
              </select>
            </label>
            <label>
              Flüge suchen
              <input
                type="search"
                value={query}
                placeholder="Flug, Airline, IATA, Terminal"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <span>{rows.length} Einträge</span>
          </div>
          <div className="muc-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>MUC-Zeit</th>
                  <th>Richtung</th>
                  <th>Flug / Airline</th>
                  <th>Von / Nach</th>
                  <th>Terminal</th>
                  <th>PDF-Seite</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((r) => (
                  <tr key={r.entry_id}>
                    <td>
                      <code>{r.scheduled_local.slice(11, 16)}</code>
                    </td>
                    <td>{r.direction === "arrival" ? "Ankunft" : "Abflug"}</td>
                    <td>
                      <strong>{r.flight_number}</strong>
                      <small className="muc-flightplan__airline">{r.airline}</small>
                      {r.possible_shared_group && (
                        <small className="muc-warn">Mehrfachgruppe, ungeklärt</small>
                      )}
                    </td>
                    <td>{r.counterpart_iata}</td>
                    <td>{r.terminal}</td>
                    <td>{r.source_pages.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p>Keine passenden Einträge.</p>}
          <div className="muc-flightplan__pagination">
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Zurück
            </button>
            <span>
              Seite {currentPage + 1} / {pageCount}
            </span>
            <button
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Weiter
            </button>
          </div>
          <details className="muc-details">
            <summary>Flugplan-Provenienz &amp; Grenzen</summary>
            <ul>
              {selected.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p className="muc-small">Parser: {selected.parser_version} / Original-PDF-SHA256</p>
            <code className="muc-hash">{selected.source_pdf_sha256}</code>
            <p className="muc-small">Snapshot-ID / Inhalts-Hash</p>
            <code className="muc-hash">{selected.content_sha256}</code>
            <p className="muc-small">
              Import: {selected.imported_at}. Quelle ist keine digitale Signatur.
              Wiederveröffentlichung und dauerhafter Datenfeed benötigen geklärte Nutzungsrechte.
            </p>
          </details>
          <div className="muc-downloads">
            <a href={url(`/munich/flight-plans/${selected.snapshot_id}/export.csv`)}>
              Flugplan CSV
            </a>
            <a
              href={url(`/munich/flight-plans/${selected.snapshot_id}`)}
              target="_blank"
              rel="noreferrer"
            >
              Snapshot JSON
            </a>
          </div>
        </>
      ) : (
        <p className="muc-small">
          Noch kein Flugplantag ausgewählt. Bestehende Energievergleiche funktionieren weiterhin
          ohne Flugplan-Kontext.
        </p>
      )}
    </section>
  );
}
