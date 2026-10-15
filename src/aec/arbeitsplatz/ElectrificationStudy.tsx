import "./arbeitsplatz.css";
import "./electrification.css";
import { useEffect, useRef, useState } from "react";
import {
  compareElectrification,
  type ElectrificationComparison,
  type ElectrificationInputs,
  type Solution,
} from "../api/electrification";
import { int, powerText } from "../model/format";
import { resultFromExact } from "../model/livePower";
import { SAMPLE_PROJECT } from "../sample";
import Link from "../Link";
import LoadChart from "./LoadChart";
import MeasurementHandoff from "./MeasurementHandoff";

const DEFAULTS: ElectrificationInputs = {
  electric_share_pct: 50,
  grid_import_limit_kw: 1500,
  storage_kwh: 2000,
};
const OPTIONS = [
  {
    id: "direct",
    title: "Direkt laden",
    description: "Freie Fahrzeuge laden ohne Einsatzpriorität.",
  },
  {
    id: "managed",
    title: "Gesteuert laden",
    description: "Ladeleistung wird nach anstehenden Einsatzfristen verteilt.",
  },
  {
    id: "managed_storage",
    title: "Gesteuert + Speicher",
    description: "Gleiche Laderegel, ergänzt um den gewählten Batteriespeicher.",
  },
] as const;
const FLEET_NAMES: Record<string, string> = {
  bus: "Busse",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Flugzeugschlepper",
  gpu: "Bodenstromgeräte",
};
const CHECK_REASONS: Record<string, string> = {
  service_deadlines: "Nicht alle Abfertigungsaufträge rechtzeitig",
  parking_deadlines: "Parkhaus-Ladeziele nicht vollständig erreicht",
  background_supply: "Grundlast nicht vollständig versorgt",
  vehicle_recharge: "Fahrzeugladung am Ende nicht wiederhergestellt",
  storage_recharge: "Speicherladung am Ende nicht wiederhergestellt",
  energy_balance: "Energiebilanz nicht erfüllt",
};
const same = (a: ElectrificationInputs, b: ElectrificationInputs) =>
  a.electric_share_pct === b.electric_share_pct &&
  a.grid_import_limit_kw === b.grid_import_limit_kw &&
  a.storage_kwh === b.storage_kwh;

export default function ElectrificationStudy() {
  const [inputs, setInputs] = useState(DEFAULTS);
  const [result, setResult] = useState<ElectrificationComparison | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Solution>("managed");
  const active = useRef<AbortController | null>(null);
  const current = !!result && same(inputs, result.inputs) && !busy && !error;

  async function calculate(values: ElectrificationInputs) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const comparison = await compareElectrification(values, controller.signal);
      if (!controller.signal.aborted) setResult(comparison);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Berechnung fehlgeschlagen.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const initial = setTimeout(() => void calculate(DEFAULTS), 0);
    return () => {
      clearTimeout(initial);
      active.current?.abort();
    };
  }, []);

  const baseline = result?.variants[0];
  const chosen = result?.variants.find((v) => v.solution === selected);
  function download() {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "flughafen-elektrifizierung-vergleich.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="ap es">
      <header className="ap-head">
        <Link
          to={{ page: "start" }}
          className="ap-head__back"
          label="Airport Energy Check, Startseite"
        >
          AIRPORT <strong>ENERGY CHECK</strong>
        </Link>
        <span className="ap-head__title">Flughafen-Simulation</span>
        <details className="ap-tools">
          <summary>Weitere Werkzeuge</summary>
          <div>
            <Link to={{ page: "projekt", projekt: SAMPLE_PROJECT.id, frage: "daten" }}>
              Eingaben & Quellen
            </Link>
            <Link to={{ page: "arbeitsplatz", projekt: SAMPLE_PROJECT.id }}>
              Bisherige Szenario-Regler
            </Link>
            <Link to={{ page: "bibliothek" }}>Szenario-Bibliothek</Link>
            <Link to={{ page: "lab", projekt: SAMPLE_PROJECT.id }}>Messdaten-Abgleich</Link>
            <a href="?workspace=flexlab">FlexLab</a>
          </div>
        </details>
      </header>
      <section className="ap-intro">
        <p className="ap-kicker">Elektrifizierung am Flughafen</p>
        <h1>
          Flughafenflotte elektrifizieren.
          <br />
          <em>Wie viel Anschlussleistung braucht sie?</em>
        </h1>
        <p>
          Vergleichen Sie drei Ladelösungen für dieselben 100 Fahrzeuge. Wir berechnen, welche
          Anschlussleistung jeweils ausreicht, um dieselben Abfertigungsaufträge zu erfüllen. Danach
          prüfen Sie, ob Ihr vorhandener Anschluss genügt.
        </p>
        <p className="ap-study-note">
          Synthetischer Vorfeldbereich · drei Betriebstage · literaturgestützte Annahmen, nicht
          kalibriert
        </p>
        <ol className="ap-system" aria-label="Vergleichsablauf">
          <li>
            <span>01</span>
            <strong>100 Fahrzeuge</strong>
            <small>Gesamtflotte bleibt konstant</small>
          </li>
          <li>
            <span>02</span>
            <strong>Elektroanteil wählen</strong>
            <small>ersetzt nicht-elektrische Fahrzeuge</small>
          </li>
          <li>
            <span>03</span>
            <strong>Anschlussbedarf berechnen</strong>
            <small>gleiche Flotte, gleiche Einsätze</small>
          </li>
          <li>
            <span>04</span>
            <strong>Vorhandenen Anschluss prüfen</strong>
            <small>Betrieb und Wiederaufladung müssen passen</small>
          </li>
        </ol>
      </section>
      <div className="ap-body">
        <form
          className="ap-levers"
          aria-label="Elektrifizierung einstellen"
          onSubmit={(event) => {
            event.preventDefault();
            void calculate(inputs);
          }}
        >
          <div className="ap-control-heading">
            <span className="ap-kicker">1 · Ihre Annahmen</span>
            <h2>Was planen Sie?</h2>
          </div>
          <label className="ap-lever">
            <span>Elektrischer Anteil der Flotte</span>
            <output className="ap-lever__value">{inputs.electric_share_pct} %</output>
            <input
              aria-label="Elektroanteil"
              type="range"
              min="0"
              max="100"
              step="10"
              disabled={busy}
              value={inputs.electric_share_pct}
              onChange={(e) => setInputs({ ...inputs, electric_share_pct: Number(e.target.value) })}
            />
            <small>
              {inputs.electric_share_pct} elektrisch · {100 - inputs.electric_share_pct}{" "}
              nicht-elektrisch
            </small>
          </label>
          <label className="ap-lever">
            <span>Ihr vorhandener Netzanschluss</span>
            <output className="ap-lever__value">{powerText(inputs.grid_import_limit_kw)}</output>
            <input
              aria-label="Netzanschluss"
              type="range"
              min="0"
              max="8000"
              step="250"
              disabled={busy}
              value={inputs.grid_import_limit_kw}
              onChange={(e) =>
                setInputs({ ...inputs, grid_import_limit_kw: Number(e.target.value) })
              }
            />
            <small>250-kW-Schritte für den abgegrenzten Modellbereich</small>
          </label>
          <label className="ap-lever">
            <span>Speicher in Variante 3</span>
            <output className="ap-lever__value">{int(inputs.storage_kwh)} kWh</output>
            <input
              aria-label="Speicher in Variante 3"
              type="range"
              min="0"
              max="6000"
              step="250"
              disabled={busy}
              value={inputs.storage_kwh}
              onChange={(e) => setInputs({ ...inputs, storage_kwh: Number(e.target.value) })}
            />
            <small>Leistung {powerText(inputs.storage_kwh / 2)} · Start-Ladestand 50 %</small>
          </label>
          <button className="es-primary" type="submit" disabled={busy}>
            {busy
              ? "Drei Varianten werden berechnet …"
              : error
                ? "Erneut berechnen"
                : "Anschlussbedarf vergleichen"}
          </button>
          <button
            className="ap-reset"
            type="button"
            disabled={busy}
            onClick={() => {
              setInputs(DEFAULTS);
              void calculate(DEFAULTS);
            }}
          >
            Ausgangswerte laden
          </button>
        </form>
        <section className="ap-main" aria-labelledby="es-results">
          <h2 id="es-results">2 · Gleicher Betrieb. Welcher Anschluss reicht?</h2>
          <p className="ap-result-lead">
            Geprüft werden alle Abfertigungsaufträge, Parkhaus und Grundlast. Nach drei Tagen muss
            die Anfangsladung wieder erreicht sein. Kein Vorteil durch einen leer gefahrenen
            Speicher.
          </p>
          <p role="status" className="es-status">
            {busy
              ? "Der Server prüft Anschlussstufen für drei Varianten. Das kann etwa eine Minute dauern."
              : error
                ? "Vergleich nicht verfügbar."
                : !current
                  ? "Einstellungen geändert. Bitte die drei Varianten neu berechnen."
                  : `${result.comparison_contract.electric_vehicles} elektrische und ${result.comparison_contract.non_electric_vehicles} nicht-elektrische Fahrzeuge · Vergleich berechnet`}
          </p>
          {error && (
            <p role="alert" className="ap-error">
              {error}
            </p>
          )}
          <div className="es-options">
            {OPTIONS.map((option, index) => {
              const variant = result?.variants[index];
              const metrics = current ? variant?.metrics : undefined;
              const delta =
                current &&
                variant?.grid_sizing.required_grid_kw != null &&
                baseline?.grid_sizing.required_grid_kw != null
                  ? baseline.grid_sizing.required_grid_kw - variant.grid_sizing.required_grid_kw
                  : null;
              return (
                <article
                  className="es-option"
                  data-selected={selected === option.id || undefined}
                  key={option.id}
                >
                  <span className="ap-kicker">Variante {index + 1}</span>
                  <h3>{option.title}</h3>
                  <p>{option.description}</p>
                  <dl>
                    <dt>Geprüfter Anschlussbedarf</dt>
                    <dd className="es-required">
                      {!current || !variant
                        ? "–"
                        : variant.grid_sizing.required_grid_kw != null
                          ? powerText(variant.grid_sizing.required_grid_kw)
                          : variant.grid_sizing.status === "resource_infeasible"
                            ? "Fahrzeugengpass"
                            : `Nicht nachgewiesen bis ${powerText(variant.grid_sizing.max_kw)}`}
                    </dd>
                    <dt>Bei Ihrem Anschluss</dt>
                    <dd className="es-feasibility" data-ok={current && variant?.checks.feasible}>
                      {!current || !variant
                        ? "–"
                        : variant.checks.feasible
                          ? "Ausreichend im Modell"
                          : "Nicht ausreichend"}
                    </dd>
                    <dt>Abfertigungen rechtzeitig bereit</dt>
                    <dd>
                      {metrics
                        ? `${int(metrics.ready_departures)} / ${int(metrics.departures_total)}`
                        : "–"}
                    </dd>
                    <dt>Höchster Netzbezug</dt>
                    <dd>{metrics ? powerText(metrics.peak_grid_kw) : "–"}</dd>
                  </dl>
                  <p className="es-delta">
                    {!metrics
                      ? "Ergebnis nach Berechnung"
                      : delta === null
                        ? "Kein gesicherter Anschlussvergleich verfügbar"
                        : index === 0
                          ? "Vergleichsbasis: direktes Laden"
                          : delta === 0
                            ? "Gleiche Anschlussstufe wie direktes Laden"
                            : `${powerText(Math.abs(delta))} ${delta > 0 ? "weniger" : "mehr"} als direktes Laden`}
                  </p>
                  {current &&
                    variant &&
                    variant.checks.reasons.map((reason) => (
                      <p className="es-warning" key={reason}>
                        {CHECK_REASONS[reason] ?? reason}
                      </p>
                    ))}
                  <button
                    type="button"
                    className="ap-reset"
                    aria-pressed={selected === option.id}
                    disabled={!current}
                    onClick={() => setSelected(option.id)}
                  >
                    Für Detailansicht wählen
                  </button>
                </article>
              );
            })}
          </div>
          {current && result.variants.every((v) => v.checks.feasible) && (
            <p className="ap-takeaway">
              Ihr Anschluss reicht in allen drei Varianten. Gleiche Abfertigungsbereitschaft ist
              hier das Ziel: Entscheidend ist, welche Lösung dafür weniger Anschlussleistung
              benötigt.
            </p>
          )}
          <p className="ap-accuracy">
            Anschlussbedarf = kleinste erfolgreich simulierte Stufe im 250-kW-Raster bis 8 MW. Keine
            exakte Mindestleistung, reale Flugpünktlichkeit oder Anschlusszusage. Die Detailwerte
            gelten für Ihren vorhandenen Anschluss über 72 Stunden.
          </p>
          {current && chosen && baseline && (
            <details className="ap-extra">
              <summary>Drei-Tage-Verlauf der gewählten Variante</summary>
              <LoadChart
                result={resultFromExact(chosen.basis)}
                today={resultFromExact(baseline.basis)}
                departures={chosen.departures}
                changed={selected !== "direct"}
              />
            </details>
          )}
        </section>
      </div>
      <details className="ap-next">
        <summary>Annahmen, Nachweis und mit Messdaten weiterprüfen</summary>
        <section className="ap-intro">
          <h2>Was ist in diesem Vergleich festgehalten?</h2>
          {result && (
            <>
              <p>
                100 Fahrzeuge · {result.comparison_contract.mission_count} identische
                Einsatzaufträge · 180 Ankünfte und 180 Abflüge pro Tag · gleicher Startzustand je
                Fahrzeug.
              </p>
              <table className="es-fleet">
                <thead>
                  <tr>
                    <th>Fahrzeugklasse</th>
                    <th>Gesamt</th>
                    <th>Elektrisch</th>
                    <th>Ladepunkte</th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparison_contract.fleet.map((f) => (
                    <tr key={f.kind}>
                      <th>{FLEET_NAMES[f.kind]}</th>
                      <td>{f.total}</td>
                      <td>{f.electric}</td>
                      <td>{f.chargers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Letzter berechneter Elektroanteil: {result.inputs.electric_share_pct} %. Die
                Verteilung auf Fahrzeugklassen wird deterministisch gerundet.
              </p>
              <ul>
                {result.limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h3>Methodische Grundlagen</h3>
              <ul>
                {result.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="ap-accuracy">
                Vergleichs-ID: <code>{result.comparison_id}</code>
              </p>
            </>
          )}
          <button type="button" className="ap-reset" disabled={!current} onClick={download}>
            Berechneten Vergleich herunterladen
          </button>
          {chosen && (
            <MeasurementHandoff
              key={chosen.calculationId}
              demo
              projectId={SAMPLE_PROJECT.id}
              exact={chosen}
              levers={{
                gridLimitKw: inputs.grid_import_limit_kw,
                batteryKwh: selected === "managed_storage" ? inputs.storage_kwh : 0,
                pvFactor: 1,
              }}
              exactCurrent={current}
              question="Wie gut bildet die gewählte Elektrifizierungsvariante den gemessenen Leistungsverlauf ab?"
              electrification={{ ...inputs, solution: selected }}
            />
          )}
        </section>
      </details>
      <footer className="ap-footer">
        Die Demo unterstützt die Untersuchung einer Elektrifizierungsentscheidung. Reale Flotten-,
        Lade- und Betriebsdaten sind für eine belastbare Planung erforderlich.
      </footer>
    </div>
  );
}
