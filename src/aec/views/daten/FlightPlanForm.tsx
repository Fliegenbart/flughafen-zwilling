/** a) Flugplan einlesen oder einen schon eingelesenen verwenden. */
import { useEffect, useState, type FormEvent } from "react";
import type { FlightPlanInfo } from "../../../munich/flightplanTypes";
import { importFlightPlan, linkFlightPlan, listFlightPlans } from "../../api/data";
import { deDate } from "../../model/dataStatus";
import { errorText, Format, Result, type FormProps } from "./shared";

const FLIGHT_PLAN_SOURCE = "https://www.munich-airport.de/saisonflugplan";

export default function FlightPlanForm({ project, reload, disabled }: FormProps) {
  const [plans, setPlans] = useState<FlightPlanInfo[]>([]);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
  );
  const [file, setFile] = useState<File | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    void listFlightPlans()
      .then((list) => alive && setPlans(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [disabled]);

  async function link(plan: FlightPlanInfo, imported: boolean) {
    await linkFlightPlan(project, plan.snapshot_id);
    const groups = plan.possible_shared_flight_groups;
    setOk(
      `Flugplan vom ${deDate(plan.service_date)} mit ${plan.departure_entry_count} Abflügen ${imported ? "eingelesen und " : ""}übernommen.${
        groups
          ? ` ${groups} Flüge stehen eventuell doppelt drin (Codeshares) und müssen unter „Anlagenplan und Flugplan“ auf der Seite Tag geklärt werden.`
          : ""
      }`,
    );
    await reload();
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!file) return setError("Kein PDF ausgewählt.");
    if (!/\.pdf$/i.test(file.name) || file.size > 6 * 1024 * 1024)
      return setError("Das PDF darf höchstens 6 MB groß sein.");
    if (!date) return setError("Kein Tag ausgewählt.");
    setBusy(true);
    try {
      const plan = await importFlightPlan(date, file);
      await link(plan, true);
    } catch (err) {
      setError(flightPlanError(errorText(err, "Das Einlesen hat nicht geklappt.")));
    } finally {
      setBusy(false);
    }
  }

  async function choose(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    const plan = plans.find((p) => p.snapshot_id === pick);
    if (!plan) return setError("Bitte einen importierten Flugplan wählen.");
    setBusy(true);
    try {
      await link(plan, false);
    } catch (err) {
      setError(errorText(err, "Das Zuordnen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aec-dform">
      <Format files={[]}>
        das PDF des offiziellen Saisonflugplans (
        <a href={FLIGHT_PLAN_SOURCE} target="_blank" rel="noreferrer">
          munich-airport.de/saisonflugplan
        </a>
        ), höchstens 6 MB, dazu ein Tag, für den der Plan gilt. Gelesen werden die Planzeiten.
        Codeshares, die doppelt drinstehen könnten, werden markiert und nicht zusammengelegt.
      </Format>
      <form className="aec-dgrid" onSubmit={upload} aria-label="Flugplan einlesen">
        <label>
          Welcher Tag?
          <input
            type="date"
            value={date}
            required
            disabled={disabled || busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="aec-dgrid__wide">
          Flugplan als PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="aec-button" disabled={disabled || busy}>
          {busy ? "Wird gelesen …" : "Flugplan einlesen"}
        </button>
      </form>
      {plans.length ? (
        <form className="aec-dgrid" onSubmit={choose} aria-label="Vorhandenen Flugplan verwenden">
          <label className="aec-dgrid__wide">
            Oder einen schon eingelesenen Flugplan verwenden
            <select
              value={pick}
              disabled={disabled || busy}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Flugplan wählen …</option>
              {plans.map((p) => (
                <option key={p.snapshot_id} value={p.snapshot_id}>
                  {deDate(p.service_date)} · Stand {deDate(p.source_data_date)} ·{" "}
                  {p.departure_entry_count} Abflüge
                  {p.possible_shared_flight_groups
                    ? ` · ${p.possible_shared_flight_groups} mögliche Codeshares`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="aec-button aec-button--ghost"
            disabled={disabled || busy}
          >
            Verwenden
          </button>
        </form>
      ) : null}
      <Result error={error} ok={ok} />
    </div>
  );
}

/** Flugplan-Backend meldet teils englisch bzw. ohne Umlaute; hier in klare Saetze. */
export function flightPlanError(detail: string): string {
  if (/application\/pdf/.test(detail)) return "Das ist kein PDF.";
  if (/laeuft bereits/.test(detail))
    return "Es wird schon ein Flugplan eingelesen, danach geht es weiter.";
  if (/Zeitlimit/.test(detail)) return "Das Hochladen hat zu lange gedauert und wurde abgebrochen.";
  if (/6 MiB/.test(detail)) return "Das PDF ist größer als 6 MB.";
  if (/^API-Fehler 422|Layout|layout|unlesbar|Flugzeile/i.test(detail))
    return `Wir konnten das PDF nicht als Saisonflugplan lesen. ${detail.startsWith("API-Fehler") ? "" : detail}`.trim();
  return detail;
}
