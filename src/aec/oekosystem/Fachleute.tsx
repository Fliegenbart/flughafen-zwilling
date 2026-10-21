/**
 * Fuer Fachleute: dieselbe Rechnung wie auf der Startseite, mit allem, was eine Zahl begruendet.
 * Gleiche Regler und Stellung (ueber die Adresse), vier Rechnungen nebeneinander, Kurve,
 * Kennzahlen bei Ihrem Anschluss, Annahmen, Erfolgsbedingungen, Grenzen und Quellen.
 * Messdaten-Werkzeuge und Altprojekte gehoeren nicht hierher (docs/PRODUKT.md).
 */
import "../arbeitsplatz/arbeitsplatz.css";
import "./oekosystem.css";
import "./fachleute.css";
import { useState } from "react";
import type { ElectrificationComparison } from "../api/electrification";
import Link from "../Link";
import LoadChart from "../arbeitsplatz/LoadChart";
import { dec1, int } from "../model/format";
import { curveFor, REASONS, type Rechnung } from "./kurve";
import Levers from "./Levers";
import { answer, changedFromStart, kw, type Settings, type Stage } from "./stufen";
import { useOekosystem } from "./useOekosystem";

const FLEET_NAMES: Record<string, string> = {
  bus: "Vorfeldbusse",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Flugzeugschlepper",
  gpu: "Bodenstromgeräte",
};

type Row = {
  id: Rechnung;
  /** Schild wie auf der Startseite; die einfache Begrenzung ist nur Vergleich. */
  sign: number | null;
  name: string;
  how: (s: Settings) => string;
};
const ROWS: Row[] = [
  {
    id: "uncontrolled",
    sign: 1,
    name: "Ohne Steuerung",
    how: () =>
      "Jedes Fahrzeug lädt sofort mit voller Leistung, nichts bremst. Bedarf ist die höchste Netzlast in drei Tagen.",
  },
  {
    id: "direct",
    sign: null,
    name: "Einfache Leistungsbegrenzung",
    how: () =>
      "Alle laden sofort, werden aber gleichmäßig gedrosselt, sobald der Anschluss voll ist. Zum Vergleich, nicht auf der Übersicht.",
  },
  {
    id: "managed",
    sign: 2,
    name: "Lademanagement",
    how: () =>
      "Plant die Ladezeiten nach dem Einsatzplan: Wer bald fährt, lädt zuerst. Diesen Wert zeigt die Übersicht.",
  },
  {
    id: "managed_storage",
    sign: 3,
    name: "+ Speicher",
    how: (s) =>
      s.storage_kwh
        ? `Wie Lademanagement, dazu ${dec1(s.storage_kwh / 1000)} MWh Speicher mit ${kw(s.storage_kwh / 2)}. Er lädt aus dem Netz nach, solange weniger als 80 % des Anschlusses genutzt werden.`
        : "Kein Speicher eingestellt.",
  },
];

type FleetConfig = {
  kind: string;
  vehicles: number;
  chargers: number;
  charger_kw: number;
  battery_capacity_kwh: number;
  mission_energy_kwh: number;
  initial_soc_pct: number;
};
type PowerConfig = {
  background_load_kw: number;
  pv_capacity_kwp: number;
  pv_peak_factor: number;
  parking_sessions: number;
  parking_charger_kw: number;
  battery_initial_soc_pct: number;
};

function configOf(data: ElectrificationComparison) {
  const config = (data.variants[0]?.metadata as { config?: unknown } | undefined)?.config as
    | { fleets?: FleetConfig[]; power?: PowerConfig }
    | undefined;
  return config?.fleets && config.power ? { fleets: config.fleets, power: config.power } : null;
}

/** Benoetigter Anschluss je Rechnung aus der vorab gerechneten Tabelle. */
function needOf(row: Row, stages: Stage[], directKw: number | null | undefined) {
  if (row.id === "direct") return { kw: directKw ?? null, off: false };
  const stage = stages.find((s) => s.id === row.id)!;
  return { kw: stage.inactive ? null : stage.needKw, off: !!stage.inactive, stage };
}

/** Was bei Ihrem Anschluss passiert, in einem Satz je Rechnung (nach der Serverrechnung). */
function verdict(data: ElectrificationComparison | null, id: Rechnung, connectionKw: number) {
  if (!data) return null;
  if (id === "uncontrolled") {
    const peak = data.uncontrolled?.grid_sizing.peak_kw;
    if (peak === undefined) return null;
    return peak > connectionKw
      ? { ok: false, text: `Überlast, Spitze ${kw(Math.round(peak))}` }
      : { ok: true, text: "trägt" };
  }
  const variant = data.variants.find((v) => v.solution === id);
  if (!variant) return null;
  return variant.checks.feasible
    ? { ok: true, text: "reicht" }
    : {
        ok: false,
        text: `reicht nicht: ${REASONS[variant.checks.reasons[0] ?? ""] ?? "keine Lösung"}`,
      };
}

export default function Fachleute() {
  const { atlas, loadError, settings, setSettings, stages, fresh, curveError } =
    useOekosystem("fachleute");
  const [selected, setSelected] = useState<Rechnung>("uncontrolled");
  const connection = settings.grid_import_limit_kw;
  const storageOff = !!stages?.find((s) => s.id === "managed_storage")?.inactive;
  const current: Rechnung = selected === "managed_storage" && storageOff ? "managed" : selected;
  const curve = curveFor(fresh, current, connection);
  const einstellung = changedFromStart(settings);
  const entry =
    atlas?.entries[
      `${settings.electric_share_pct}|${settings.storage_kwh}|${settings.pv_kwp}|${settings.parking_sessions}`
    ];
  const config = fresh ? configOf(fresh) : null;
  const row = ROWS.find((r) => r.id === current)!;

  return (
    <div className="ap oe oe-fach">
      <header className="oe-head">
        <p className="oe-brand">
          Airport Energy Check <span>Beispielflughafen, erfunden</span>
        </p>
        <Link
          to={einstellung ? { page: "start", einstellung } : { page: "start" }}
          className="oe-tool"
        >
          Zur Übersicht
        </Link>
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
          <h1 id="oe-question">Der Vergleich im Detail</h1>
          {loadError ? (
            <p className="oe-error" role="alert">
              {loadError}
            </p>
          ) : !stages || !atlas ? (
            <p className="oe-loading" role="status">
              {atlas
                ? "Für diese Einstellung liegt noch keine Rechnung vor."
                : "Die Werte werden geladen …"}
            </p>
          ) : (
            <>
              <p className="oe-answer oe-answer--small">
                {answer(stages, connection, atlas.gridMaxKw)}
              </p>

              <section aria-labelledby="oe-calc-title">
                <h2 id="oe-calc-title" className="oe-h2">
                  Vier Rechnungen mit derselben Flotte
                </h2>
                <p className="oe-lede">
                  Alle vier versorgen dieselben Fahrzeuge für dieselben Einsätze. Sie unterscheiden
                  sich nur darin, wann und wie schnell geladen wird.
                </p>
                <table className="oe-calc">
                  <thead>
                    <tr>
                      <th scope="col">Rechnung</th>
                      <th scope="col">Benötigter Anschluss</th>
                      <th scope="col">Bei Ihren {kw(connection)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((r) => {
                      const need = needOf(r, stages, entry?.[0]);
                      const said = verdict(fresh, r.id, connection);
                      const disabled = r.id === "managed_storage" && storageOff;
                      return (
                        <tr key={r.id} data-selected={current === r.id || undefined}>
                          <th scope="row">
                            <button
                              type="button"
                              className="oe-calc__pick"
                              aria-pressed={current === r.id}
                              disabled={disabled}
                              onClick={() => setSelected(r.id)}
                            >
                              {r.sign ? (
                                <span className="oe-sign" aria-hidden="true">
                                  {r.sign}
                                </span>
                              ) : (
                                <span className="oe-sign oe-sign--ghost" aria-hidden="true" />
                              )}
                              <span className="oe-calc__name">
                                {r.name}
                                <small>{r.how(settings)}</small>
                              </span>
                            </button>
                          </th>
                          <td
                            className="oe-calc__need"
                            data-over={(need.kw ?? 0) > connection || undefined}
                          >
                            {need.off
                              ? settings.storage_kwh
                                ? "senkt hier den Bedarf nicht"
                                : "–"
                              : need.kw === null
                                ? `über ${kw(atlas.gridMaxKw)}`
                                : kw(need.kw)}
                          </td>
                          <td className="oe-calc__said" data-ok={said ? said.ok : undefined}>
                            {disabled ? "–" : (said?.text ?? "wird gerechnet …")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="oe-note">
                  Benötigter Anschluss ist die kleinste Stufe im 25-kW-Raster bis{" "}
                  {kw(atlas.gridMaxKw)}, bei der alle Bedingungen weiter unten erfüllt sind.
                </p>
              </section>

              <section className="oe-curve" aria-labelledby="oe-curve-title">
                <h2 id="oe-curve-title">Netzlast über drei Tage, {row.name}</h2>
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
                  <p className="oe-loading" role="status">
                    {curveError ||
                      (fresh && !fresh.uncontrolled
                        ? "Der Server liefert noch keine Kurve ohne Steuerung."
                        : "Die Kurve wird gerechnet …")}
                  </p>
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

              {fresh ? <Figures data={fresh} id={current} connectionKw={connection} /> : null}
            </>
          )}
        </section>
      </div>

      <div className="oe-fach__more">
        <section aria-labelledby="oe-basis-title">
          <h2 id="oe-basis-title">Woraus der Bedarf entsteht</h2>
          {config && fresh ? (
            <>
              <table className="oe-fleet">
                <caption>Vorfeldflotte des Beispielflughafens</caption>
                <thead>
                  <tr>
                    <th scope="col">Fahrzeug</th>
                    <th scope="col">Fahrzeuge</th>
                    <th scope="col">davon elektrisch</th>
                    <th scope="col">Akku</th>
                    <th scope="col">Energie je Einsatz</th>
                    <th scope="col">Ladepunkte</th>
                  </tr>
                </thead>
                <tbody>
                  {config.fleets.map((f) => {
                    const counted = fresh.comparison_contract.fleet.find((c) => c.kind === f.kind);
                    return (
                      <tr key={f.kind}>
                        <th scope="row">{FLEET_NAMES[f.kind] ?? f.kind}</th>
                        <td>{int(f.vehicles)}</td>
                        <td>{int(counted?.electric ?? 0)}</td>
                        <td>{int(f.battery_capacity_kwh)} kWh</td>
                        <td>{dec1(f.mission_energy_kwh)} kWh</td>
                        <td>
                          {int(f.chargers)} × {kw(f.charger_kw)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="oe-list">
                <li>
                  Flugplan: {int(fresh.variants[0]!.metrics.departures_total / 3)} Abflüge am Tag in
                  drei Wellen um 6, 12 und 18 Uhr, dazu ebenso viele Ankünfte. Gerechnet werden drei
                  gleiche Tage hintereinander.
                </li>
                <li>
                  Jeder Einsatz ist einem festen Fahrzeug zugeordnet. Nicht elektrische Fahrzeuge
                  fahren dieselben Einsätze, ohne zu laden.
                </li>
                <li>
                  Übriger Flughafen im Modellbereich: {kw(config.power.background_load_kw)}{" "}
                  Grundlast, über den Tag um bis zu 8 % schwankend.
                </li>
                <li>
                  Photovoltaik: {int(config.power.pv_capacity_kwp)} kWp. Sie liefert mittags
                  höchstens {int(config.power.pv_peak_factor * 100)} % der Nennleistung, wie an
                  einem trüben Herbsttag.
                </li>
                <li>
                  Parkhaus: {int(config.power.parking_sessions)} Ladevorgänge am Tag mit je{" "}
                  {kw(config.power.parking_charger_kw)}, ungesteuert.
                </li>
                <li>
                  Die Fahrzeuge starten mit {int(config.fleets[0]?.initial_soc_pct ?? 85)} % Ladung,
                  der Speicher mit {int(config.power.battery_initial_soc_pct)} %.
                </li>
              </ul>
            </>
          ) : (
            <p className="oe-loading">Die Annahmen kommen mit der ersten Rechnung.</p>
          )}
        </section>

        <section aria-labelledby="oe-pass-title">
          <h2 id="oe-pass-title">Wann ein Anschluss reicht</h2>
          <ul className="oe-list">
            <li>Jeder Einsatz beginnt rechtzeitig, kein Fahrzeug wartet auf Strom.</li>
            <li>Jedes Auto im Parkhaus ist bis zur Abfahrt geladen.</li>
            <li>Der übrige Flughafen bekommt jederzeit seinen Strom.</li>
            <li>
              Nach drei Tagen sind Fahrzeuge und Speicher wieder so voll wie am Anfang. Niemand
              borgt sich Energie aus dem Startzustand.
            </li>
          </ul>
          <p className="oe-note">
            Jede Reglerstellung ist vorab mit genau dieser Rechnung durchgerechnet (
            {int(Object.keys(atlas?.entries ?? {}).length)} Stellungen). Die Kurven rechnet der
            Server für Ihre Stellung neu.
          </p>
        </section>

        <section aria-labelledby="oe-limits-title">
          <h2 id="oe-limits-title">Was das Modell nicht abbildet</h2>
          <ul className="oe-list">
            <li>
              Der Beispielflughafen ist erfunden: ein Vorfeldabschnitt mit 100 Fahrzeugen, kein
              ganzer Flughafen.
            </li>
            <li>Akkus und Energie je Einsatz stammen aus der Literatur, nicht aus Ihrer Flotte.</li>
            <li>
              Lademanagement kennt den Einsatzplan vollständig. Verspätungen im echten Betrieb sind
              nicht gerechnet.
            </li>
            <li>
              Der Speicher folgt einer einfachen Regel. Bei viel Parkhaus senkt er den Bedarf im
              Modell manchmal nicht.
            </li>
            <li>Das Parkhaus lädt ungesteuert, nicht gemeinsam mit dem Vorfeld.</li>
            <li>Kein Nachweis für Netzschutz oder Lastfluss, keine Kosten, kein Kraftstoff.</li>
          </ul>
        </section>

        <section aria-labelledby="oe-sources-title">
          <h2 id="oe-sources-title">Quellen</h2>
          {fresh ? (
            <ul className="oe-list">
              {fresh.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="oe-loading">Die Quellen kommen mit der ersten Rechnung.</p>
          )}
        </section>

        <section aria-labelledby="oe-data-title">
          <h2 id="oe-data-title">Mit Ihren Daten wird daraus Ihr Flughafen</h2>
          <ul className="oe-list">
            <li>ein typischer Flugplan, am besten ein Tag mit Spitzen</li>
            <li>die Fahrzeugliste mit Typ, Anzahl, Akkugröße, Ladeleistung und Ladepunkten</li>
            <li>der Netzanschluss des Vorfelds und ein Lastgang in 15-Minuten-Werten</li>
            <li>Photovoltaik und Ladepunkte im Parkhaus</li>
          </ul>
          <p className="oe-note">
            Mit einer Messung an Ihrem Anschluss gleichen wir das Modell ab. Erst dann werden die
            Zahlen zu einer Zusage.
          </p>
        </section>
      </div>

      <footer className="oe-foot">
        <p>
          Beispielflughafen, erfunden. Die Werte stammen aus Literatur und Annahmen, das Modell ist
          nicht an Messungen kalibriert.
        </p>
      </footer>
    </div>
  );
}

/** Kennzahlen der gewaehlten Rechnung bei Ihrem Anschluss. */
function Figures({
  data,
  id,
  connectionKw,
}: {
  data: ElectrificationComparison;
  id: Rechnung;
  connectionKw: number;
}) {
  const name = ROWS.find((r) => r.id === id)!.name;
  let items: [string, string][];
  if (id === "uncontrolled") {
    const u = data.uncontrolled;
    if (!u) return null;
    const over = Math.max(0, u.grid_sizing.peak_kw - connectionKw);
    items = [
      ["Höchste Netzlast", kw(Math.round(u.grid_sizing.peak_kw))],
      ["Über Ihrem Anschluss", over > 0 ? `bis zu ${kw(Math.round(over))}` : "nie"],
      ["Abflüge mit allen Fahrzeugen rechtzeitig bereit", "alle, weil nichts bremst"],
    ];
  } else {
    const v = data.variants.find((x) => x.solution === id);
    if (!v) return null;
    const m = v.metrics;
    items = [
      ["Höchste Netzlast", kw(Math.round(m.peak_grid_kw))],
      [
        "Abflüge mit allen Fahrzeugen rechtzeitig bereit",
        `${int(m.ready_departures)} von ${int(m.departures_total)}`,
      ],
      ["Wartezeit auf Strom, alle Einsätze zusammen", `${int(m.energy_wait_min)} min`],
      ["Minuten mit gedrosseltem Laden", `${int(m.restricted_charging_min)} min`],
      ["Im Vorfeld geladen", `${dec1(m.apron_charged_kwh / 1000)} MWh`],
      ["Im Parkhaus nicht geladen", `${dec1(m.parking_unmet_kwh)} kWh`],
    ];
  }
  return (
    <section aria-labelledby="oe-figures-title">
      <h2 id="oe-figures-title" className="oe-h2">
        {name} bei Ihren {kw(connectionKw)}, drei Tage
      </h2>
      <dl className="oe-figures">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
