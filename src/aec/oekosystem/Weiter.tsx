/** Wie es nach dem Termin weitergeht: Seite zum Mitnehmen, eigene Daten, Messung. */
export default function Weiter({
  onPrint,
  disabled,
  airport = false,
}: {
  onPrint: () => void;
  disabled: boolean;
  /** Echter Flughafen: gerechnet ist schon er, aber aus oeffentlichen Daten. */
  airport?: boolean;
}) {
  return (
    <section className="oe-weiter" aria-labelledby="oe-weiter-title">
      <h2 id="oe-weiter-title">So geht es weiter</h2>
      <ol>
        <li className="oe-weiter__screen">
          <h3>Diese Seite mitnehmen</h3>
          <p>Eine Seite mit Ihrer Einstellung, der Treppe und der Tageskurve.</p>
          <button type="button" className="oe-button" onClick={onPrint} disabled={disabled}>
            Als PDF sichern
          </button>
        </li>
        <li>
          <h3>Mit Ihren Daten rechnen</h3>
          <p>
            {airport
              ? "Ein typischer Flugplan, die Fahrzeugliste mit Ladepunkten und die freie Leistung im Flughafennetz. Dann rechnen wir mit Ihren Werten statt mit öffentlichen Daten und Annahmen."
              : "Ein typischer Flugplan, die Fahrzeugliste mit Ladepunkten und der Netzanschluss. Dann rechnen wir Ihren Flughafen statt des Beispiels."}
          </p>
        </li>
        <li>
          <h3>Mit Messung belegen</h3>
          <p>
            Wir vergleichen das Modell mit Messungen an Ihrem Anschluss. Erst dann werden die Zahlen
            zu einer Zusage.
          </p>
        </li>
      </ol>
    </section>
  );
}
