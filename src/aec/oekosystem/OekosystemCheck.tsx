/**
 * Startseite fuer den Kundentermin (docs/PRODUKT.md): Reicht der Anschluss, wenn das Vorfeld
 * elektrisch faehrt, und was bringt jeder Baustein? Die Treppe kommt sofort aus vorab
 * gerechneten Werten, die Tageskurve rechnet der Server nach einer kurzen Pause genau.
 */
import "../arbeitsplatz/arbeitsplatz.css";
import "./oekosystem.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareElectrification,
  getAtlas,
  type Atlas,
  type ElectrificationComparison,
} from "../api/electrification";
import Link from "../Link";
import { resultFromExact, type LiveBasis } from "../model/livePower";
import LoadChart from "../arbeitsplatz/LoadChart";
import Levers from "./Levers";
import Treppe from "./Treppe";
import { answer, kw, START, stagesFor, type Settings, type StageId } from "./stufen";
import { usePresentation } from "./usePresentation";
import Weiter from "./Weiter";

const SETTLE_MS = 400;
const REASONS: Record<string, string> = {
  service_deadlines: "nicht alle Einsätze werden rechtzeitig fertig",
  parking_deadlines: "im Parkhaus werden nicht alle Autos voll",
  background_supply: "der übrige Flughafen bekommt nicht genug Strom",
  vehicle_recharge: "die Fahrzeuge sind am Ende nicht wieder geladen",
  storage_recharge: "der Speicher ist am Ende nicht wieder geladen",
  energy_balance: "die Energiebilanz geht nicht auf",
};
const sameSettings = (a: Settings, b: Settings) =>
  (Object.keys(a) as (keyof Settings)[]).every((k) => a[k] === b[k]);

/** Ohne Steuerung bremst nichts: was ueber dem Anschluss liegt, ist Ueberlast (rot im Diagramm). */
function againstConnection(basis: LiveBasis, connectionKw: number) {
  const load = basis.gridImportKw ?? [];
  return resultFromExact({
    ...basis,
    gridCapKw: load.map(() => connectionKw),
    gridImportKw: load.map((v) => Math.min(v, connectionKw)),
    requestedKw: load.map((v) => Math.max(0, v - connectionKw)),
    deliveredKw: load.map(() => 0),
    batteryKw: load.map(() => 0),
  });
}

export default function OekosystemCheck() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings>(START);
  const [selected, setSelected] = useState<StageId>("uncontrolled");
  const [curves, setCurves] = useState<{ for: Settings; data: ElectrificationComparison } | null>(
    null,
  );
  const [curveError, setCurveError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { presenting, setPresenting, toggleRef } = usePresentation();

  useEffect(() => {
    const controller = new AbortController();
    getAtlas(controller.signal)
      .then(setAtlas)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(e instanceof Error ? e.message : "Die Werte ließen sich nicht laden.");
      });
    return () => controller.abort();
  }, []);

  // Tageskurven genau nachrechnen, sobald die Regler kurz ruhen.
  useEffect(() => {
    const controller = new AbortController();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCurveError("");
      compareElectrification(settings, controller.signal)
        .then((data) => setCurves({ for: settings, data }))
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setCurveError(e instanceof Error ? e.message : "Die Kurve ließ sich nicht rechnen.");
        });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer.current);
      controller.abort();
    };
  }, [settings]);

  const stages = useMemo(() => (atlas ? stagesFor(atlas, settings) : null), [atlas, settings]);
  const sentence =
    stages && atlas ? answer(stages, settings.grid_import_limit_kw, atlas.gridMaxKw) : "";
  // Wird die gewaehlte Stufe abgeschaltet (kein Speicher, kein Vorteil), zeigt die Kurve Stufe 2.
  const current: StageId = stages?.find((s) => s.id === selected)?.inactive ? "managed" : selected;
  const fresh = curves && sameSettings(curves.for, settings) ? curves.data : null;
  const connection = settings.grid_import_limit_kw;
  const uncontrolled = fresh?.uncontrolled;
  const variant =
    current === "uncontrolled" ? null : fresh?.variants.find((v) => v.solution === current);
  const shown = current === "uncontrolled" ? uncontrolled : variant;
  const stageTitle = stages?.find((s) => s.id === current)?.title.replace("+\u00a0", "mit ");
  const base = useMemo(
    () => (uncontrolled ? againstConnection(uncontrolled.basis, connection) : null),
    [uncontrolled, connection],
  );
  const shownResult =
    current === "uncontrolled" ? base : variant ? resultFromExact(variant.basis) : null;
  const note =
    current === "uncontrolled"
      ? base?.shortfalls.length
        ? {
            tone: "stop" as const,
            text: "Ohne Steuerung liegen die Ladespitzen über Ihrem Anschluss. Das wäre Überlast.",
          }
        : { tone: "ok" as const, text: "Der Anschluss trägt auch ungesteuertes Laden." }
      : !variant
        ? undefined
        : variant.checks.feasible
          ? {
              tone: "ok" as const,
              text: shownResult?.shortfalls.length
                ? "Ladespitzen über dem Anschluss werden verschoben, alle Einsätze bleiben pünktlich."
                : "Der Anschluss reicht an allen drei Tagen.",
            }
          : {
              tone: "stop" as const,
              text: `Hier reicht der Anschluss nicht: ${REASONS[variant.checks.reasons[0] ?? ""] ?? "das Modell findet keine Lösung"}.`,
            };

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
                {shown && base && shownResult ? (
                  <LoadChart
                    note={note}
                    formatCap={kw}
                    result={shownResult}
                    today={base}
                    departures={shown.departures}
                    changed={current !== "uncontrolled"}
                  />
                ) : (
                  <p className="oe-loading" role="status">
                    {curveError ||
                      (fresh && !uncontrolled
                        ? "Der Server liefert noch keine Kurve ohne Steuerung."
                        : "Die Kurve wird gerechnet …")}
                  </p>
                )}
                {shown ? (
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
        {fresh ? (
          <details>
            <summary>Annahmen und Quellen</summary>
            <ul>
              {fresh.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ul>
              {fresh.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <Link to={{ page: "fachleute" }} className="oe-foot__expert">
          Ausführlicher Vergleich für Fachleute
        </Link>
      </footer>
    </div>
  );
}
