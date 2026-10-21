/**
 * Startseite fuer den Kundentermin (docs/PRODUKT.md): Reicht der Anschluss, wenn das Vorfeld
 * elektrisch faehrt, und was bringt jeder Baustein? Die Treppe kommt sofort aus vorab
 * gerechneten Werten, die Tageskurve rechnet der Server nach einer kurzen Pause genau.
 * Beim echten Flughafen heisst der Anschluss "Reserve fuers Vorfeld" und ist zuerst offen.
 */
import "../arbeitsplatz/arbeitsplatz.css";
import "./oekosystem.css";
import Link from "../Link";
import LoadChart from "../arbeitsplatz/LoadChart";
import { CurveWaiting, curveFor } from "./kurve";
import Levers from "./Levers";
import { int } from "../model/format";
import { AirportFacts, AirportPicker, modelFleet } from "./Steckbrief";
import Treppe from "./Treppe";
import { ANSCHLUSS, answer, kw, lineFor, RESERVE, type StageId } from "./stufen";
import { useOekosystem } from "./useOekosystem";
import { usePresentation } from "./usePresentation";
import Weiter from "./Weiter";

export default function OekosystemCheck() {
  const {
    airport,
    profile,
    airports,
    atlas,
    loadError,
    settings,
    ready,
    setSettings,
    stages,
    connection,
    reserveOpen,
    einstellung,
    fresh,
    curveError,
    retry,
    selected,
    setSelected,
  } = useOekosystem("start");
  const { presenting, setPresenting, toggleRef } = usePresentation();

  const line = lineFor(airport, reserveOpen);
  const sentence =
    stages && atlas
      ? answer(
          stages,
          reserveOpen ? null : connection,
          atlas.gridMaxKw,
          airport ? RESERVE : ANSCHLUSS,
          profile?.name,
        )
      : "";
  // Wird die gewaehlte Stufe abgeschaltet (kein Speicher, kein Vorteil), zeigt die Kurve Stufe 2.
  // Die einfache Leistungsbegrenzung gibt es nur auf der Fachleute-Seite.
  const chosen: StageId = selected === "direct" ? "managed" : selected;
  const current: StageId = stages?.find((s) => s.id === chosen)?.inactive ? "managed" : chosen;
  const stageTitle = stages?.find((s) => s.id === current)?.title.replace("+\u00a0", "mit ");
  const curve = curveFor(fresh, current, connection, line);
  const managedNeed = stages?.find((s) => s.id === "managed")?.needKw ?? null;
  const here = airport ? { flughafen: airport } : {};

  return (
    <div className="ap oe" data-presenting={presenting || undefined}>
      <header className="oe-head">
        <p className="oe-brand">Airport Energy Check</p>
        <AirportPicker airports={airports} current={airport} page="start" />
        <button
          type="button"
          ref={toggleRef}
          className="oe-tool"
          aria-pressed={presenting}
          aria-keyshortcuts="P"
          onClick={() => setPresenting(!presenting)}
        >
          Präsentieren <kbd aria-hidden="true">P</kbd>
        </button>
        <button type="button" className="oe-tool" disabled={!stages} onClick={() => window.print()}>
          Als PDF sichern
        </button>
      </header>

      <div className="oe-body">
        {atlas && ready ? (
          <Levers
            settings={settings}
            atlas={atlas}
            profile={profile}
            managedNeedKw={managedNeed}
            onChange={setSettings}
          />
        ) : (
          <div className="oe-levers" />
        )}
        <section className="oe-main" aria-labelledby="oe-question">
          <h1 id="oe-question">
            {profile
              ? `Wie viel Reserve braucht das Vorfeld in ${profile.name}, wenn es elektrisch fährt?`
              : "Reicht der Anschluss, wenn das Vorfeld elektrisch fährt?"}
          </h1>
          {loadError ? (
            <p className="oe-error" role="alert">
              {loadError}
            </p>
          ) : !stages ? (
            <p className="oe-loading" role="status">
              {atlas && ready
                ? "Für diese Einstellung liegt noch keine Rechnung vor."
                : "Die Werte werden geladen …"}
            </p>
          ) : (
            <>
              <p className="oe-answer">{sentence}</p>
              {profile ? (
                <p className="oe-scope">
                  Gerechnet sind {int(modelFleet(profile))} Busse, Schlepper und Bodenstromgeräte im
                  Modell, mit Verbrauch für Kurz- und Mittelstrecke. Weitere Geräte und
                  Großraumflugzeuge kommen im echten Betrieb dazu.
                </p>
              ) : null}
              <Treppe
                stages={stages}
                connectionKw={connection}
                storageKwh={settings.storage_kwh}
                selected={current}
                onSelect={setSelected}
                line={line}
              />
              <section className="oe-curve" aria-labelledby="oe-curve-title">
                <h2 id="oe-curve-title">
                  Netzlast über drei Tage, {stageTitle ?? "ohne Steuerung"}
                </h2>
                {curve ? (
                  <p className="oe-curve__note" data-tone={curve.note.tone} aria-hidden="true">
                    {curve.note.text}
                  </p>
                ) : null}
                {curve ? (
                  <LoadChart
                    drawNote={false}
                    note={curve.note}
                    formatCap={kw}
                    capLabel={line.chart}
                    result={curve.result}
                    today={curve.base}
                    departures={curve.departures}
                    changed={current !== "uncontrolled"}
                  />
                ) : (
                  <CurveWaiting error={curveError} incomplete={!!fresh} onRetry={retry} />
                )}
                {curve ? (
                  <p className="oe-note">
                    {airport
                      ? "Schwarz: was Vorfeld und Parkhaus zum Laden aus dem Netz brauchen"
                      : "Schwarz: was das Vorfeld, das Parkhaus und der übrige Flughafen aus dem Netz brauchen"}
                    {current !== "uncontrolled" ? ", grau zum Vergleich ohne Steuerung" : ""}. Rote
                    Linie: {line.chart}.
                  </p>
                ) : null}
              </section>
              {profile ? <AirportFacts profile={profile} /> : null}
            </>
          )}
        </section>
      </div>

      <Weiter onPrint={() => window.print()} disabled={!stages} />

      <footer className="oe-foot">
        <p>
          {profile
            ? `Modellrechnung aus öffentlichen Daten: das ganze Vorfeld von ${profile.name} an einem typischen Tag im Spitzenmonat, drei Tage gerechnet. Nicht mit dem Flughafen abgestimmt und nicht an Messungen abgeglichen.`
            : "Beispielflughafen, erfunden: 100 Fahrzeuge im Vorfeld, 180 Abflüge am Tag, drei Tage gerechnet. Die Werte stammen aus Literatur und Annahmen, das Modell ist nicht an Messungen kalibriert."}
        </p>
        <Link
          to={{ page: "fachleute", ...here, ...(einstellung ? { einstellung } : {}) }}
          className="oe-foot__expert"
        >
          Ausführlicher Vergleich für Fachleute
        </Link>
        <p className="oe-foot__hint">Annahmen, Rechenweg und Quellen zu dieser Einstellung.</p>
      </footer>
    </div>
  );
}
