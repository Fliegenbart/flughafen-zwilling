/**
 * Startseite fuer den Kundentermin (docs/PRODUKT.md): Reicht der Anschluss, wenn das Vorfeld
 * elektrisch faehrt, und was bringt jeder Baustein? Die Treppe kommt sofort aus vorab
 * gerechneten Werten, die Tageskurve rechnet der Server nach einer kurzen Pause genau.
 */
import "../arbeitsplatz/arbeitsplatz.css";
import "./oekosystem.css";
import Link from "../Link";
import LoadChart from "../arbeitsplatz/LoadChart";
import { CurveWaiting, curveFor } from "./kurve";
import Levers from "./Levers";
import Treppe from "./Treppe";
import { answer, changedFromStart, kw, type StageId } from "./stufen";
import { useOekosystem } from "./useOekosystem";
import { usePresentation } from "./usePresentation";
import Weiter from "./Weiter";

export default function OekosystemCheck() {
  const {
    atlas,
    loadError,
    settings,
    setSettings,
    stages,
    fresh,
    curveError,
    retry,
    selected,
    setSelected,
  } = useOekosystem("start");
  const { presenting, setPresenting, toggleRef } = usePresentation();

  const sentence =
    stages && atlas ? answer(stages, settings.grid_import_limit_kw, atlas.gridMaxKw) : "";
  // Wird die gewaehlte Stufe abgeschaltet (kein Speicher, kein Vorteil), zeigt die Kurve Stufe 2.
  // Die einfache Leistungsbegrenzung gibt es nur auf der Fachleute-Seite.
  const chosen: StageId = selected === "direct" ? "managed" : selected;
  const current: StageId = stages?.find((s) => s.id === chosen)?.inactive ? "managed" : chosen;
  const stageTitle = stages?.find((s) => s.id === current)?.title.replace("+\u00a0", "mit ");
  const curve = curveFor(fresh, current, settings.grid_import_limit_kw);
  const einstellung = changedFromStart(settings);

  return (
    <div className="ap oe" data-presenting={presenting || undefined}>
      <header className="oe-head">
        <p className="oe-brand">
          Airport Energy Check <span>Beispielflughafen, erfunden</span>
        </p>
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
        {atlas ? (
          <Levers settings={settings} atlas={atlas} onChange={setSettings} />
        ) : (
          <div className="oe-levers" />
        )}
        <section className="oe-main" aria-labelledby="oe-question">
          <h1 id="oe-question">Reicht der Anschluss, wenn das Vorfeld elektrisch fährt?</h1>
          {loadError ? (
            <p className="oe-error" role="alert">
              {loadError}
            </p>
          ) : !stages ? (
            <p className="oe-loading" role="status">
              {atlas
                ? "Für diese Einstellung liegt noch keine Rechnung vor."
                : "Die Werte werden geladen …"}
            </p>
          ) : (
            <>
              <p className="oe-answer">{sentence}</p>
              <Treppe
                stages={stages}
                connectionKw={settings.grid_import_limit_kw}
                storageKwh={settings.storage_kwh}
                selected={current}
                onSelect={setSelected}
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
                    Schwarz: was das Vorfeld, das Parkhaus und der übrige Flughafen aus dem Netz
                    brauchen
                    {current !== "uncontrolled" ? ", grau zum Vergleich ohne Steuerung" : ""}. Rote
                    Linie: Ihr Anschluss.
                  </p>
                ) : null}
              </section>
            </>
          )}
        </section>
      </div>

      <Weiter onPrint={() => window.print()} disabled={!stages} />

      <footer className="oe-foot">
        <p>
          Beispielflughafen, erfunden: 100 Fahrzeuge im Vorfeld, 180 Abflüge am Tag, drei Tage
          gerechnet. Die Werte stammen aus Literatur und Annahmen, das Modell ist nicht an Messungen
          kalibriert.
        </p>
        <Link
          to={einstellung ? { page: "fachleute", einstellung } : { page: "fachleute" }}
          className="oe-foot__expert"
        >
          Ausführlicher Vergleich für Fachleute
        </Link>
        <p className="oe-foot__hint">Annahmen, Rechenweg und Quellen zu dieser Einstellung.</p>
      </footer>
    </div>
  );
}
