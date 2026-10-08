import Link from "./Link";
import type { DataStatus } from "./model/dataStatus";

/** Datenstand im Projektkopf: N von 4 echt, Mini-Leiste, fuehrt zum Schritt Daten. */
export default function DataMeter({
  status,
  projekt,
}: {
  status: DataStatus | null;
  projekt: string;
}) {
  const label = status
    ? `${status.real} von 4 Datenquellen belegt. ${status.answer} Zu Ihren Daten.`
    : "Datenstand wird geladen. Zu Ihren Daten.";
  return (
    <Link to={{ page: "projekt", projekt, frage: "daten" }} className="aec-dmeter" label={label}>
      <span className="aec-dmeter__text" aria-hidden="true">
        Belegt: <strong>{status ? `${status.real} von 4` : "…"}</strong>
      </span>
      <span className="aec-dmeter__bar" aria-hidden="true">
        {(status?.items ?? []).map((i) => (
          <i key={i.id} data-state={i.state} title={`${i.title}: ${i.state}`} />
        ))}
      </span>
    </Link>
  );
}
