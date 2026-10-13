/**
 * Arbeitsbildschirm fuer den Kundentermin: Regler links, Tageskurve rechts, Vergleich darunter.
 * Ersetzt nach Abnahme die Seiten Tag, Engpass und Loesungen (?ansicht=neu).
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./arbeitsplatz.css";
import { useEffect, useState } from "react";
import { getProject } from "../api/projects";
import Link from "../Link";
import type { Route } from "../routes";
import type { Project } from "../types";
import LeverPanel from "./LeverPanel";
import LoadChart from "./LoadChart";
import MeasurementHandoff from "./MeasurementHandoff";
import Outcome from "./Outcome";
import { useLiveScenario } from "./useLiveScenario";
import { SAMPLE_PROJECT } from "../sample";

type ArbeitsplatzRoute = Extract<Route, { page: "arbeitsplatz" }>;

export default function Arbeitsplatz({ route }: { route: ArbeitsplatzRoute }) {
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    let alive = true;
    void getProject(route.projekt).then((p) => alive && setProject(p));
    return () => {
      alive = false;
    };
  }, [route.projekt]);
  const s = useLiveScenario(project);
  const demo = route.projekt === SAMPLE_PROJECT.id;
  const [question, setQuestion] = useState(
    "Reicht das Ladefenster aus, damit die Fahrzeuge ihren nächsten Einsatz erreichen?",
  );
  function downloadSketch(format: "html" | "json" = "html") {
    if (!s.exact || !s.today || !s.levers || !s.result) return;
    const receipt = {
      title: "Flughafen-Simulation: Prüfskizze",
      question,
      notice:
        "Simulationsvorschau auf angenommenen Eingaben, keine Messung oder Handlungsempfehlung. Kein Prüfauftrag erteilt. Keine Hardwareanbindung.",
      inputs: s.levers,
      baseline: {
        metadata: s.today.metadata,
        calculation_id: s.today.calculationId,
        input_hash: s.today.inputHash,
        kpis: s.todayResult,
        delayed_departures: s.today.delayedDepartures,
      },
      variant: {
        metadata: s.exact.metadata,
        calculation_id: s.exact.calculationId,
        input_hash: s.exact.inputHash,
        engine: s.exact.engineVersion,
        kpis: s.result,
        delayed_departures: s.exact.delayedDepartures,
        departures_total: s.exact.departuresTotal,
      },
      next_step:
        "Ladeleistungsverlauf, Energiebedarf und Einsatzzeiten erfassen. Datenqualität, Prüfkriterien und Geltungsbereich vor einem unabhängigen Messdatenvergleich festlegen.",
    };
    const escape = (value: unknown) =>
      String(value ?? "nicht vorhanden").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );
    const row = (label: string, base: unknown, variant: unknown) =>
      `<tr><th>${escape(label)}</th><td>${escape(base)}</td><td>${escape(variant)}</td></tr>`;
    const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Flughafen-Simulation · Prüfskizze</title><style>body{font:16px/1.6 sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#16232d}h1{font-size:32px}table{border-collapse:collapse;width:100%}th,td{padding:12px;border-bottom:1px solid #ccd4d9;text-align:left}code{overflow-wrap:anywhere}aside{background:#fff4cf;padding:16px}pre{white-space:pre-wrap}</style><h1>Flughafen-Simulation: Prüfskizze</h1><aside>${escape(receipt.notice)}</aside><h2>Fragestellung</h2><p>${escape(question)}</p><h2>Ihre Einstellungen</h2><p>Netzanschluss: ${escape(s.levers.gridLimitKw)} kW · Speicher: ${escape(s.levers.batteryKwh)} kWh · PV: ${escape(s.levers.pvFactor * 100)} % der Ausgangslage · zusätzliche Fahrzeuge: ${escape(s.levers.extraVehicles ?? 0)}</p><h2>Berechneter Vergleich</h2><table><tr><th>Kennzahl</th><th>Ausgangslage</th><th>Variante</th></tr>${row("Fehlende Ladeleistung Spitze (kW)", s.todayResult?.maxMissingKw, s.result.maxMissingKw)}${row("Anschluss am Limit (Minuten)", s.todayResult?.minutesAtLimit, s.result.minutesAtLimit)}${row("Abfertigungen im Modell nicht rechtzeitig bereit", s.today.delayedDepartures, s.exact.delayedDepartures)}${row("Höchster Netzbezug (kW)", s.todayResult?.peakImportKw, s.result.peakImportKw)}</table><p>Keine reale Flug-OTP. Fahrzeug- und Energieannahmen sind nicht empirisch validiert.</p><h2>Nächster Prüfschritt</h2><p>${escape(receipt.next_step)}</p><h2>Berechnungsnachweis</h2><p>Engine: ${escape(s.exact.engineVersion)}<br>Ausgangslage: <code>${escape(s.today.calculationId)}</code><br>Variante: <code>${escape(s.exact.calculationId)}</code><br>Eingabe-Hash: <code>${escape(s.exact.inputHash)}</code></p></html>`;
    const url = URL.createObjectURL(
      new Blob([format === "html" ? html : JSON.stringify(receipt, null, 2)], {
        type: format === "html" ? "text/html;charset=utf-8" : "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `flughafen-pruefskizze.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const changed =
    !!s.levers &&
    !!s.todayLevers &&
    (s.levers.gridLimitKw !== s.todayLevers.gridLimitKw ||
      s.levers.batteryKwh !== s.todayLevers.batteryKwh ||
      s.levers.pvFactor !== s.todayLevers.pvFactor ||
      (s.levers.extraVehicles ?? 0) > 0);

  return (
    <div className="ap">
      <header className="ap-head">
        <Link to={{ page: "start" }} className="ap-head__back" label="Zurück zu allen Projekten">
          Startseite
        </Link>
        <h1 className="ap-head__title">
          {demo
            ? "Flughafen-Simulation selbst ausprobieren"
            : (project?.name ?? "Projekt wird geladen …")}
        </h1>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "daten" }}
          className="ap-head__link"
        >
          Eingaben & Quellen
        </Link>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "lage" }}
          className="ap-head__link"
        >
          Weitere Projektansichten
        </Link>
      </header>
      <section className="ap-intro">
        <p className="ap-step">
          1 · Flughafentag verstehen → 2 · Engpass erkennen → 3 · Variante berechnen → 4 ·
          Prüfskizze mitnehmen
        </p>
        <h2>Was verändert sich, wenn Fahrzeuge laden müssen, während der Flughafen weiterläuft?</h2>
        <p>
          Verändern Sie Netzleistung, Batteriespeicher, PV oder Fahrzeugzahl. Nach einer kurzen
          Pause berechnet der Server den Verkehrstag neu und vergleicht Ihre Variante mit derselben
          Ausgangslage.
        </p>
        <p>
          <strong>{demo ? "Synthetischer Demonstrationstag" : "Projektbasierte Simulation"}</strong>{" "}
          · Keine Live-Hardwareanbindung · Keine validierte Flughafenplanung
        </p>
      </section>

      {s.accuracy === "fehler" && !s.today ? (
        <p className="ap-error" role="alert">
          {s.error}{" "}
          {demo
            ? "Der Simulationsserver ist nicht verfügbar. Bitte laden Sie die Seite erneut. Es werden keine Beispielergebnisse als Ersatz angezeigt."
            : "Für eine Kurve braucht das Projekt einen Flugplan unter „Eingaben & Quellen“."}
        </p>
      ) : !s.today || !s.levers || !s.todayLevers || !s.result || !s.todayResult ? (
        <p className="ap-loading" role="status">
          Der Tag wird gerechnet …
        </p>
      ) : (
        <div className="ap-body">
          <LeverPanel
            levers={s.levers}
            today={s.todayLevers}
            onChange={s.setLevers}
            onReset={s.reset}
          />
          <div className="ap-main">
            <LoadChart
              result={s.result}
              today={s.todayResult}
              departures={(s.exact ?? s.today).departures}
              changed={changed}
            />
            <Outcome
              today={s.todayResult}
              todayPreview={s.today}
              result={s.result}
              exact={s.exact}
              accuracy={s.accuracy}
              changed={changed}
              sample={s.sample}
            />
            {s.error && s.today ? (
              <p className="ap-error" role="alert">
                {s.error}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {s.today ? (
        <section className="ap-intro" aria-labelledby="ap-sketch-title">
          <h2 id="ap-sketch-title">Welche Annahme wollen Sie als Nächstes überprüfen?</h2>
          <p>
            Mehr Fahrzeuge können die Einsatzbereitschaft verbessern und gleichzeitig den Anschluss
            stärker belasten. Vergleichen Sie beide Seiten, statt nur einen Gewinner zu wählen.
          </p>
          <label>
            Ihre Prüffrage
            <textarea
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <p>
            Ein nächster Schritt wäre ein unabhängiger Vergleich mit Ladeleistung, Energiebedarf und
            Einsatzzeiten. Grenzen und Messbedingungen werden vorher festgelegt. Hier wird kein
            Versuch beauftragt.
          </p>
          <button
            className="ap-reset"
            type="button"
            disabled={s.accuracy !== "genau" || !s.exact}
            onClick={() => downloadSketch()}
          >
            Prüfskizze herunterladen
          </button>{" "}
          <button
            className="ap-reset"
            type="button"
            disabled={s.accuracy !== "genau" || !s.exact}
            onClick={() => downloadSketch("json")}
          >
            Berechnungsdaten als JSON
          </button>
          <MeasurementHandoff
            demo={demo}
            projectId={route.projekt}
            exact={s.exact}
            levers={s.levers}
            exactCurrent={s.accuracy === "genau" && !!s.exact}
            question={question}
          />
          <p>
            Lesbare HTML-Zusammenfassung zum Weitergeben und Drucken; JSON für die Detailprüfung.
            Die Vorschau wird nicht als dauerhafter Projektlauf gespeichert.
          </p>
        </section>
      ) : null}
    </div>
  );
}
