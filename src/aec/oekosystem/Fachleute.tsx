/**
 * Fuer Fachleute: dieselbe Rechnung wie auf der Startseite, mit allem, was eine Zahl begruendet.
 * Gleiche Regler und Stellung (ueber die Adresse), vier Rechnungen nebeneinander, Kurve,
 * Kennzahlen bei Ihrem Anschluss, Annahmen, Erfolgsbedingungen, Grenzen und Quellen.
 * Messdaten-Werkzeuge und Altprojekte gehoeren nicht hierher (docs/PRODUKT.md).
 */
import "../arbeitsplatz/arbeitsplatz.css";
import "./oekosystem.css";
import "./fachleute.css";
import type { Atlas, ElectrificationComparison } from "../api/electrification";
import Link from "../Link";
import LoadChart from "../arbeitsplatz/LoadChart";
import { dec1, int } from "../model/format";
import { CurveWaiting, curveFor, REASONS, type Rechnung } from "./kurve";
import Levers from "./Levers";
import { AirportModel, AirportPicker, FLEET_NAMES, fleetTotal } from "./Steckbrief";
import {
  ANSCHLUSS,
  answer,
  atlasKey,
  kw,
  lineFor,
  RESERVE,
  type Line,
  type Settings,
  type Stage,
} from "./stufen";
import { useOekosystem } from "./useOekosystem";

type Row = {
  id: Rechnung;
  /** Schild wie auf der Startseite; die einfache Begrenzung ist nur Vergleich. */
  sign: number | null;
  name: string;
  /** Fuer Ueberschriften: "Netzlast ueber drei Tage mit Lademanagement". */
  with: string;
  how: (s: Settings, line: Line) => string;
};
const ROWS: Row[] = [
  {
    id: "uncontrolled",
    sign: 1,
    name: "Ohne Steuerung",
    with: "ohne Steuerung",
    how: () =>
      "Jedes Fahrzeug lädt mit voller Leistung bis 85 %, sobald ein Ladepunkt frei ist, und jedes Auto im Parkhaus lädt sofort. Nichts bremst, der Bedarf ist die höchste Netzlast in drei Tagen.",
  },
  {
    id: "direct",
    sign: null,
    name: "Einfache Leistungsbegrenzung",
    with: "mit einfacher Leistungsbegrenzung",
    how: (_, line) =>
      `Wie ohne Steuerung, aber alle Ladepunkte werden gleichmäßig gedrosselt, sobald ${line.nomLower} ausgeschöpft ist. Zum Vergleich, nicht auf der Übersicht.`,
  },
  {
    id: "managed",
    sign: 2,
    name: "Lademanagement",
    with: "mit Lademanagement",
    how: () =>
      "Plant die Ladezeiten nach dem Einsatzplan und dem echten Ladestand, mit 15 % Reserve auf den Verbrauch: Wer bald fährt, lädt zuerst. Das Parkhaus lädt, wenn Leistung frei ist, und jedes Auto ist bis zur Abfahrt voll. Diesen Wert zeigt die Übersicht.",
  },
  {
    id: "managed_storage",
    sign: 3,
    name: "+\u00a0Speicher",
    with: "mit Lademanagement und Speicher",
    how: (s, line) =>
      s.storage_kwh
        ? `Lademanagement mit ${dec1(s.storage_kwh / 1000)} MWh Speicher und ${kw(s.storage_kwh / 2)} Leistung. Er lädt aus der Leistung nach, die ${line.nomLower} gerade frei lässt, und gibt sie bei Spitzen wieder ab. Bringt er nichts, bleibt er aus.`
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
  wide_mission_energy_kwh?: number;
  initial_soc_pct: number;
};
type PowerConfig = {
  background_load_kw: number;
  pv_peak_factor: number;
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
  return { kw: stage.inactive ? null : stage.needKw, off: !!stage.inactive };
}

/** Was bei Ihrem Anschluss passiert, je Rechnung (nach der Serverrechnung). */
function verdict(
  data: ElectrificationComparison | null,
  id: Rechnung,
  connectionKw: number,
  line: Line,
) {
  if (!data) return null;
  if (id === "uncontrolled") {
    const peak = data.uncontrolled?.grid_sizing.peak_kw;
    if (peak === undefined) return null;
    return peak > connectionKw
      ? {
          ok: false,
          text: `${line.overload ? "Überlast, " : "darüber, "}Spitze ${kw(Math.round(peak))}`,
        }
      : { ok: true, text: "trägt" };
  }
  const variant = data.variants.find((v) => v.solution === id);
  if (!variant) return null;
  return variant.checks.feasible
    ? { ok: true, text: "reicht" }
    : {
        ok: false,
        text: `reicht nicht, ${REASONS[variant.checks.reasons[0] ?? ""] ?? "keine Lösung"}`,
      };
}

/** Wie oft der Speicher den Bedarf nicht senkt (gleiche Regel wie stagesFor). */
function storageWithoutGain(atlas: Atlas) {
  let none = 0;
  let total = 0;
  for (const [key, [, managed, storage]] of Object.entries(atlas.entries)) {
    if (key.split("|")[1] === "0" || managed === null) continue;
    total += 1;
    if (storage === null || storage >= managed) none += 1;
  }
  return { none, total };
}

export default function Fachleute() {
  const {
    airport,
    profile,
    airports,
    airportsLoading,
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
    last,
    curveError,
    retry,
    selected,
    setSelected,
  } = useOekosystem("fachleute");
  const line = lineFor(airport, reserveOpen);
  const storageOff = !!stages?.find((s) => s.id === "managed_storage")?.inactive;
  const current: Rechnung = selected === "managed_storage" && storageOff ? "managed" : selected;
  const curve = curveFor(fresh, current, connection, line);
  const here = airport ? { flughafen: airport } : {};
  const managedNeed = stages?.find((s) => s.id === "managed")?.needKw ?? null;
  const at = !airport
    ? `Bei Ihren ${kw(connection)}`
    : reserveOpen
      ? `Bei ${kw(connection)} (mit Lademanagement nötig)`
      : `Bei Ihrer Reserve von ${kw(connection)}`;
  const entry = atlas?.entries[atlasKey(settings)];
  // Flotte, Grundlast und Quellen haengen nicht an der Stellung: letzte Rechnung genuegt.
  const config = last ? configOf(last) : null;
  const row = ROWS.find((r) => r.id === current)!;
  const pending = curveError ? "nicht gerechnet" : "wird gerechnet …";
  const noGain = atlas ? storageWithoutGain(atlas) : null;

  return (
    <div className="ap oe oe-fach">
      <header className="oe-head">
        <p className="oe-brand">Airport Energy Check</p>
        <AirportPicker
          airports={airports}
          current={airport}
          loading={airportsLoading}
          page="fachleute"
        />
        <Link
          to={{ page: "start", ...here, ...(einstellung ? { einstellung } : {}) }}
          className="oe-tool"
        >
          Zur Übersicht
        </Link>
        <button
          type="button"
          className="oe-tool"
          disabled={!stages || !fresh}
          onClick={() => window.print()}
        >
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
            {airport
              ? `Wie viel Reserve braucht das Vorfeld${profile ? ` in ${profile.name}` : ""}, und warum?`
              : "Wie viel Anschluss braucht das Vorfeld, und warum?"}
          </h1>
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
                {answer(
                  stages,
                  reserveOpen ? null : connection,
                  atlas.gridMaxKw,
                  airport ? RESERVE : ANSCHLUSS,
                  profile?.name,
                )}
              </p>

              <section aria-labelledby="oe-calc-title">
                <h2 id="oe-calc-title" className="oe-h2">
                  Vier Rechnungen mit derselben Flotte
                </h2>
                <p className="oe-lede">
                  Alle vier versorgen dieselben Fahrzeuge für dieselben Einsätze. Sie unterscheiden
                  sich darin, wann die Fahrzeuge laden und ob ein Speicher mithilft.
                </p>
                <table className="oe-calc">
                  <thead>
                    <tr>
                      <th scope="col">Rechnung</th>
                      <th scope="col">{airport ? "Benötigte Reserve" : "Benötigter Anschluss"}</th>
                      <th scope="col">{at}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((r) => {
                      const need = needOf(r, stages, entry?.[0]);
                      const said = verdict(fresh, r.id, connection, line);
                      const off = r.id === "managed_storage" && storageOff;
                      const description =
                        off && settings.storage_kwh
                          ? `${dec1(settings.storage_kwh / 1000)} MWh Speicher senken hier den Bedarf nicht.`
                          : r.how(settings, line);
                      return (
                        <tr key={r.id} data-selected={current === r.id || undefined}>
                          <th scope="row" abbr={r.name}>
                            <button
                              type="button"
                              className="oe-calc__pick"
                              aria-pressed={current === r.id}
                              aria-describedby={`oe-how-${r.id}`}
                              disabled={off}
                              onClick={() => setSelected(r.id)}
                            >
                              {r.sign ? (
                                <span className="oe-sign" aria-hidden="true">
                                  {r.sign}
                                </span>
                              ) : (
                                <span className="oe-sign oe-sign--ghost" aria-hidden="true" />
                              )}
                              <span className="oe-calc__name">{r.name}</span>
                            </button>
                            <small className="oe-calc__how" id={`oe-how-${r.id}`}>
                              {description}
                            </small>
                          </th>
                          <td
                            className="oe-calc__need"
                            data-over={(need.kw ?? 0) > connection || undefined}
                          >
                            <span className="oe-calc__label">Benötigt </span>
                            {need.off
                              ? "–"
                              : need.kw === null
                                ? `über ${kw(atlas.gridMaxKw)}`
                                : kw(need.kw)}
                          </td>
                          <td className="oe-calc__said" data-ok={said ? said.ok : undefined}>
                            <span className="oe-calc__label">{at} </span>
                            {off ? "–" : (said?.text ?? pending)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="oe-note">
                  {line.need} ist die kleinste Stufe im {int(atlas.gridStepKw)}-kW-Raster bis{" "}
                  {kw(atlas.gridMaxKw)}, bei der alle Bedingungen weiter unten erfüllt sind. Ohne
                  Steuerung ist es die höchste Netzlast, aufgerundet.
                </p>
              </section>

              <section className="oe-curve" aria-labelledby="oe-curve-title">
                <h2 id="oe-curve-title">Netzlast über drei Tage {row.with}</h2>
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
                    overflow={
                      line.overload
                        ? undefined
                        : { neutral: true, label: "über dem Bedarf mit Lademanagement" }
                    }
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
                    {current !== "uncontrolled" ? ", grau zum Vergleich ohne Steuerung" : ""}.{" "}
                    {line.overload ? "Rote Linie" : "Dunkle Linie"}: {line.chart}.
                  </p>
                ) : null}
              </section>

              {fresh ? (
                <Figures data={fresh} row={row} connectionKw={connection} line={line} at={at} />
              ) : null}
            </>
          )}
        </section>
      </div>

      <div className="oe-fach__more">
        <section aria-labelledby="oe-basis-title">
          <h2 id="oe-basis-title">Woraus der Bedarf entsteht</h2>
          {config && last ? (
            <>
              <div
                className="oe-fleet-wrap"
                role="region"
                aria-labelledby="oe-fleet-caption"
                tabIndex={0}
              >
                <table className="oe-fleet">
                  <caption id="oe-fleet-caption">
                    {profile
                      ? `Vorfeldflotte im Modell, ${profile.name}`
                      : "Vorfeldflotte des Beispielflughafens"}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Fahrzeugart</th>
                      <th scope="col">Anzahl</th>
                      <th scope="col">davon elektrisch</th>
                      <th scope="col">Akku</th>
                      <th scope="col">Energie je Einsatz</th>
                      <th scope="col">Ladepunkte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.fleets.map((f) => {
                      const counted = fresh?.comparison_contract.fleet.find(
                        (c) => c.kind === f.kind,
                      );
                      return (
                        <tr key={f.kind}>
                          <th scope="row">{FLEET_NAMES[f.kind] ?? f.kind}</th>
                          <td>{int(f.vehicles)}</td>
                          <td>{counted ? int(counted.electric) : "…"}</td>
                          <td>{int(f.battery_capacity_kwh)} kWh</td>
                          <td>
                            {dec1(f.mission_energy_kwh)} kWh
                            {profile?.widebody_share_pct && f.wide_mission_energy_kwh
                              ? `, Großraum ${dec1(f.wide_mission_energy_kwh)} kWh`
                              : ""}
                          </td>
                          <td>
                            {int(f.chargers)} × {kw(f.charger_kw)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {profile ? <AirportModel profile={profile} /> : null}
              <ul className="oe-list">
                {profile ? (
                  <li>
                    Reserve: die Leistung, die das Flughafennetz für das Laden auf dem Vorfeld und
                    im Parkhaus bereitstellt. Übrige Last und Photovoltaik des Flughafens stecken
                    schon darin, das Modell rechnet sie nicht noch einmal.
                  </li>
                ) : (
                  <li>
                    Flugplan: je 60 Abflüge zwischen 6 und 9, 12 und 15 sowie 18 und 21 Uhr, also{" "}
                    {int(last.variants[0]!.metrics.departures_total / 3)} am Tag, dazu ebenso viele
                    Ankünfte. Gerechnet werden drei gleiche Tage hintereinander.
                  </li>
                )}
                <li>
                  Jeder Einsatz ist einem festen Fahrzeug zugeordnet. Nicht elektrische Fahrzeuge
                  fahren dieselben Einsätze, ohne zu laden.
                </li>
                {profile ? (
                  <li>
                    Akku, Energie je Einsatz und Ladeleistung wie im Beispielflughafen, dazu ein
                    Puffer an Fahrzeugen wie dort. Gerechnet werden drei gleiche Tage.
                  </li>
                ) : (
                  <>
                    <li>
                      Übriger Flughafen im Modellbereich: mittags{" "}
                      {kw(config.power.background_load_kw)}, nachts bis zu 16 % weniger.
                    </li>
                    <li>
                      Photovoltaik: {int(settings.pv_kwp)} kWp. Sie liefert mittags höchstens{" "}
                      {int(config.power.pv_peak_factor * 100)} % der Nennleistung, wie an einem
                      trüben Herbsttag.
                    </li>
                  </>
                )}
                <li>
                  Parkhaus: {int(settings.parking_sessions)} Ladevorgänge am Tag
                  {profile ? "" : `, je Auto bis zu ${kw(config.power.parking_charger_kw)}`}.
                  Reisende kommen zwei bis drei Stunden vor ihrem Abflug und laden bis zu 24
                  Stunden, Tagesgäste kommen zwei Stunden vorher und bleiben 10 bis 16 Stunden.
                  Schnelllader laden sofort mit 75 kW. Mit Lademanagement lädt das Parkhaus, wenn
                  Leistung frei ist, und jedes Auto ist bis zur Abfahrt voll.
                </li>
                <li>
                  Am ersten Tag starten die Fahrzeuge mit{" "}
                  {int(config.fleets[0]?.initial_soc_pct ?? 85)} % Ladung, der Speicher mit{" "}
                  {int(config.power.battery_initial_soc_pct)} %. Gezählt wird der mittlere Tag, wenn
                  sich der Betrieb eingependelt hat.
                </li>
              </ul>
            </>
          ) : (
            <p className="oe-loading">
              {curveError
                ? "Die Annahmen kommen mit der Rechnung, die gerade nicht durchging."
                : "Die Annahmen kommen mit der ersten Rechnung."}
            </p>
          )}
        </section>

        <section aria-labelledby="oe-pass-title">
          <h2 id="oe-pass-title">
            {airport ? "Wann eine Reserve reicht" : "Wann ein Anschluss reicht"}
          </h2>
          <ul className="oe-list">
            <li>
              Jeder Einsatz ist bis zu seiner Frist erledigt, auch wenn ein Fahrzeug vorher kurz auf
              Strom wartet.
            </li>
            <li>Jedes Auto im Parkhaus ist bis zur Abfahrt geladen.</li>
            {airport ? null : <li>Der übrige Flughafen bekommt jederzeit seinen Strom.</li>}
            <li>
              Der mittlere der drei Tage trägt sich selbst: An seinem Ende sind Fahrzeuge und
              Speicher mindestens so voll wie an seinem Anfang. Der erste Tag läuft sich ein, der
              dritte läuft normal weiter.
            </li>
          </ul>
          {atlas ? (
            <p className="oe-note">
              Wir haben jede Reglerstellung vorab mit dieser Rechnung durchgerechnet (
              {int(Object.keys(atlas.entries).length)} Stellungen). Die Kurven rechnet der Server
              für Ihre Stellung neu.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="oe-limits-title">
          <h2 id="oe-limits-title">Was das Modell nicht abbildet</h2>
          <ul className="oe-list">
            {profile ? (
              <>
                <li>
                  {profile.profile_basis.assumption
                    ? `Das Tagesprofil ist aus veröffentlichten Eckdaten gebaut, nicht aus dem echten Flugplan von ${profile.name}.`
                    : `Das Tagesprofil ist aus dem veröffentlichten Flugplan von ${profile.name} ausgezählt und auf einen typischen Tag im Spitzenmonat skaliert. Frachtflüge und Tagesschwankungen können fehlen.`}
                  {profile.profile_basis.assumption
                    ? " Das Modell rechnet einen typischen Tag im Spitzenmonat."
                    : ""}
                </li>
                <li>
                  Gerechnet werden zehn Gerätearten vom Vorfeldbus bis zum Frischwasserwagen. Crew-
                  und Kleinbusse, Pkw und Schlepps zur Parkposition fehlen, ihr Ladebedarf kommt
                  dazu.
                </li>
                <li>
                  Großraumflugzeuge rechnet das Modell mit eigenen Werten. Der Winter mit Heizung in
                  Bussen und Kälte im Akku fehlt noch.
                </li>
                <li>Nichts davon ist mit dem Flughafen abgestimmt.</li>
              </>
            ) : (
              <li>
                Der Beispielflughafen ist erfunden: ein Vorfeldabschnitt
                {atlas && fleetTotal(atlas.fleet)
                  ? ` mit ${int(fleetTotal(atlas.fleet))} Fahrzeugen`
                  : ""}
                , kein ganzer Flughafen.
              </li>
            )}
            <li>
              Energie je Einsatz stammt aus Messungen (Fraport-Busse, Vorfeldgeräte in Stuttgart),
              Herstellerangaben und Physik, nicht aus Diesel-Lastfaktoren. Wie oft Catering-,
              Toiletten- und Wasserwagen kommen, ist angenommen.
            </li>
            <li>
              Lademanagement kennt den Einsatzplan im Voraus und plant 15 % Reserve auf den
              Verbrauch ein. Größere Verspätungen und Wintertage rechnet das Modell noch nicht.
            </li>
            {noGain ? (
              <li>
                An {int(noGain.none)} von {int(noGain.total)} Stellungen senkt der Speicher den
                Bedarf nicht: Schon das Lademanagement nutzt dort die Leistung fast den ganzen Tag.
              </li>
            ) : null}
            <li>Kein Nachweis für Netzschutz oder Lastfluss, keine Kosten, kein Kraftstoff.</li>
          </ul>
        </section>

        <section aria-labelledby="oe-sources-title">
          <h2 id="oe-sources-title">Woher die Annahmen stammen</h2>
          {last ? (
            <ul className="oe-list">
              {last.sources.map((source) => (
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
            <li>der Netzanschluss des Vorfelds und sein Strombedarf in 15-Minuten-Werten</li>
            <li>Photovoltaik und Ladepunkte im Parkhaus</li>
          </ul>
          <p className="oe-note">
            Mit einer Messung an Ihrem Anschluss gleichen wir das Modell ab. Erst dann werden die
            Zahlen zu einer Zusage.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Kennzahlen der gewaehlten Rechnung bei Ihrem Anschluss. */
function Figures({
  data,
  row,
  connectionKw,
  line,
  at,
}: {
  data: ElectrificationComparison;
  row: Row;
  connectionKw: number;
  line: Line;
  /** "Bei Ihren 1.500 kW" usw., passend zu Anschluss oder Reserve. */
  at: string;
}) {
  let items: [string, string][];
  let remark = "";
  if (row.id === "uncontrolled") {
    const u = data.uncontrolled;
    if (!u) return null;
    const over = Math.max(0, u.grid_sizing.peak_kw - connectionKw);
    items = [
      ["Höchste Netzlast", kw(Math.round(u.grid_sizing.peak_kw))],
      [`Über ${line.yourDat}`, over > 0 ? `bis zu ${kw(Math.round(over))}` : "nie"],
      ["Abflüge mit allen Fahrzeugen rechtzeitig bereit", "alle, weil nichts bremst"],
    ];
  } else {
    const v = data.variants.find((x) => x.solution === row.id);
    if (!v) return null;
    const m = v.metrics;
    items = [
      ["Höchste Netzlast", kw(Math.round(m.peak_grid_kw))],
      [
        "Abflüge mit allen Fahrzeugen rechtzeitig bereit",
        `${int(m.ready_departures)} von ${int(m.departures_total)}`,
      ],
      ["Wartezeit auf Strom, alle Einsätze zusammen", `${int(m.energy_wait_min)} min`],
      [
        row.id === "managed" || row.id === "managed_storage"
          ? `Minuten, in denen ${line.nomLower} das Laden über die Planung hinaus bremste`
          : `Minuten, in denen ${line.nomLower} das Laden bremste`,
        `${int(m.restricted_charging_min)} min`,
      ],
      ["Im Vorfeld geladen", `${dec1(m.apron_charged_kwh / 1000)} MWh`],
      ["Im Parkhaus nicht geladen", `${dec1(m.parking_unmet_kwh)} kWh`],
    ];
    if (row.id === "managed_storage")
      remark =
        v.storage_mode === "off"
          ? "Hier senkt der Speicher den Bedarf nicht. Er bleibt aus, die Werte entsprechen dem Lademanagement."
          : `Der Speicher lädt nach, sobald Leistung frei ist. Die Netzlast liegt deshalb oft genau an ${line.dat}.`;
  }
  return (
    <section aria-labelledby="oe-figures-title">
      <h2 id="oe-figures-title" className="oe-h2">
        So laufen drei Tage {row.with}, {at.charAt(0).toLowerCase() + at.slice(1)}
      </h2>
      <dl className="oe-figures">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {remark ? <p className="oe-note">{remark}</p> : null}
    </section>
  );
}
