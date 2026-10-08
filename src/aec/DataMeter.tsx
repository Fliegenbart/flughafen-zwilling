import Link from "./Link";
import { splitAnswer, STATE_LABEL, type DataStatus } from "./model/dataStatus";

/** Datenstand im Projektkopf: N von 4 echt, Mini-Leiste, fuehrt zum Schritt Daten. */
export default function DataMeter({
  status,
  projekt,
}: {
  status: DataStatus | null;
  projekt: string;
}) {
  // Der Name beginnt mit dem sichtbaren Text, danach folgt, was fehlt.
  const label = status
    ? [`Belegt: ${status.real} von 4.`, splitAnswer(status.answer).detail, "Zu Ihren Daten."]
        .filter(Boolean)
        .join(" ")
    : "Datenstand wird geladen. Zu Ihren Daten.";
  return (
    <Link to={{ page: "projekt", projekt, frage: "daten" }} className="aec-dmeter" label={label}>
      <span className="aec-dmeter__text" aria-hidden="true">
        Belegt: <strong>{status ? `${status.real} von 4` : "…"}</strong>
      </span>
      <span className="aec-dmeter__bar" aria-hidden="true">
        {(status?.items ?? []).map((i) => (
          <i key={i.id} data-state={i.state} title={`${i.title}: ${STATE_LABEL[i.state]}`} />
        ))}
      </span>
    </Link>
  );
}
