/**
 * Zustand der Startseite und der Seite fuer Fachleute: Flughafen, vorab gerechnete Tabelle,
 * Reglerstellung (auch in der Adresse) und die genaue Serverrechnung, sobald die Regler ruhen.
 * Tabellen, Steckbriefe, Rechnungen und die gewaehlte Stufe bleiben beim Seitenwechsel erhalten.
 * Ein anderer Flughafen baut die Seite neu auf (AirportEnergyCheck setzt den Flughafen als key).
 */
import { useEffect, useMemo, useState } from "react";
import {
  compareElectrification,
  getAirports,
  getAtlas,
  type AirportProfile,
  type Atlas,
  type ElectrificationComparison,
} from "../api/electrification";
import { useNav } from "../context";
import type { Route } from "../routes";
import type { Rechnung } from "./kurve";
import {
  baseFor,
  changedFrom,
  effectiveConnection,
  inputsFor,
  snap,
  START,
  stagesFor,
  type Settings,
} from "./stufen";

const SETTLE_MS = 400;
const BUSY_RETRY_MS = 3000;
const KEEP = 24;
const sameSettings = (a: Settings, b: Settings) =>
  (Object.keys(a) as (keyof Settings)[]).every((k) => a[k] === b[k]);
const keyOf = (body: object) => JSON.stringify(body);
const atlasId = (airport: string | null) => airport ?? "";

// Ueber den Seitenwechsel hinweg: dieselbe Stellung wird nicht zweimal gerechnet.
const shared: {
  atlases: Map<string, Atlas>;
  airports: AirportProfile[] | null;
  results: Map<string, ElectrificationComparison>;
  last: Map<string, ElectrificationComparison>;
  selected: Rechnung;
} = {
  atlases: new Map(),
  airports: null,
  results: new Map(),
  last: new Map(),
  selected: "uncontrolled",
};

function remember(key: string, airport: string | null, data: ElectrificationComparison) {
  shared.results.delete(key);
  shared.results.set(key, data);
  shared.last.set(atlasId(airport), data);
  if (shared.results.size > KEEP) shared.results.delete(shared.results.keys().next().value!);
}

/** Nur fuer Tests: gemeinsamen Zwischenspeicher leeren. */
export function forgetShared() {
  shared.atlases.clear();
  shared.airports = null;
  shared.results.clear();
  shared.last.clear();
  shared.selected = "uncontrolled";
}

type Page = "start" | "fachleute";
const airportOf = (route: Route, page: Page) =>
  route.page === page && "flughafen" in route ? (route.flughafen ?? null) : null;
const wantedOf = (route: Route, page: Page): Partial<Settings> =>
  route.page === page && "einstellung" in route && route.einstellung ? route.einstellung : {};

export function useOekosystem(page: Page) {
  const { route, navigate } = useNav();
  const [airport] = useState(() => airportOf(route, page));
  const [atlas, setAtlas] = useState<Atlas | null>(shared.atlases.get(atlasId(airport)) ?? null);
  const [airports, setAirports] = useState<AirportProfile[] | null>(shared.airports);
  const [airportsFailed, setAirportsFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const profile = airport ? (airports?.find((a) => a.id === airport) ?? null) : null;
  const base = useMemo(
    () => (atlas && (!airport || profile) ? baseFor(airport, profile, atlas) : null),
    [atlas, airport, profile],
  );
  const [settings, setSettings] = useState<Settings | null>(() =>
    base && atlas ? snap(atlas, { ...base, ...wantedOf(route, page), airport }) : null,
  );
  const [seenRoute, setSeenRoute] = useState(route);
  const [, setArrived] = useState(0);
  const [failure, setFailure] = useState<{ key: string; attempt: number; text: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelectedState] = useState<Rechnung>(shared.selected);

  // Sobald Tabelle (und Steckbrief) da sind: Startstellung plus Wuensche aus der Adresse.
  if (!settings && base && atlas)
    setSettings(snap(atlas, { ...base, ...wantedOf(route, page), airport }));
  // Browser-Zurueck auf derselben Seite: Regler folgen der Adresse (abgeleiteter Zustand).
  if (route !== seenRoute) {
    setSeenRoute(route);
    if (settings && base && atlas && route.page === page && airportOf(route, page) === airport) {
      const target = snap(atlas, { ...base, ...wantedOf(route, page), airport });
      if (!sameSettings(target, settings)) setSettings(target);
    }
  }

  useEffect(() => {
    if (shared.airports) return;
    const controller = new AbortController();
    getAirports(controller.signal)
      .then((list) => {
        shared.airports = list;
        setAirports(list);
      })
      .catch(() => {
        // Ohne Liste bleibt nur der Beispielflughafen waehlbar; ein gewaehlter Flughafen meldet das.
        if (!controller.signal.aborted) setAirportsFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (shared.atlases.has(atlasId(airport))) return;
    const controller = new AbortController();
    getAtlas(airport, controller.signal)
      .then((a) => {
        shared.atlases.set(atlasId(airport), a);
        setAtlas(a);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(e instanceof Error ? e.message : "Die Werte ließen sich nicht laden.");
      });
    return () => controller.abort();
  }, [airport]);

  const unknownAirport = !!airport && !!airports && !profile;
  const listError =
    !!airport && airportsFailed ? "Die Liste der Flughäfen ließ sich nicht laden." : "";

  // Die Stellung steht in der Adresse: Link weitergeben, Seite neu laden, Stellung bleibt.
  useEffect(() => {
    if (!settings || !base) return;
    const einstellung = changedFrom(base, settings);
    navigate(
      {
        page,
        ...(airport ? { flughafen: airport } : {}),
        ...(einstellung ? { einstellung } : {}),
      },
      { replace: true },
    );
  }, [navigate, page, airport, settings, base]);

  const stages = useMemo(
    () => (atlas && settings ? stagesFor(atlas, settings) : null),
    [atlas, settings],
  );
  const connection = settings && atlas ? effectiveConnection(settings, stages, atlas) : null;
  const body = useMemo(
    () => (settings && connection !== null ? inputsFor(settings, connection) : null),
    [settings, connection],
  );
  const key = body ? keyOf(body) : "";

  // Genau nachrechnen, sobald die Tabelle da ist und die Regler kurz ruhen.
  useEffect(() => {
    if (!body || !atlas || shared.results.has(key)) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      compareElectrification(body, controller.signal)
        .then((data) => {
          remember(key, airport, data);
          setArrived((n) => n + 1);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          // Server rechnet gerade eine andere Stellung: kurz warten und selbst erneut fragen.
          if ((e as { status?: number }).status === 429) {
            retryTimer = setTimeout(() => setAttempt((n) => n + 1), BUSY_RETRY_MS);
            return;
          }
          setFailure({
            key,
            attempt,
            text: e instanceof Error ? e.message : "Die Kurve ließ sich nicht rechnen.",
          });
        });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [atlas, body, key, attempt, airport]);

  const fresh = key ? (shared.results.get(key) ?? null) : null;
  return {
    /** Was von der Startstellung abweicht (fuer Links zwischen den Seiten). */
    einstellung: settings && base ? changedFrom(base, settings) : undefined,
    airport,
    profile,
    airports: airports ?? [],
    atlas,
    loadError: unknownAirport
      ? "Diesen Flughafen gibt es hier noch nicht."
      : listError || loadError,
    /** Liste noch unterwegs: Kopf und Ueberschrift sagen dann nichts ueber das Beispiel. */
    airportsLoading: airports === null && !airportsFailed,
    /** Vor dem Laden die Startstellung des Beispiels; Seiten zeigen dann "wird geladen". */
    settings: settings ?? { ...START, airport },
    ready: !!settings,
    setSettings: (next: Settings) => setSettings(next),
    stages,
    /** Anschluss fuer Kurve und Rechnung (bei offener Reserve: Bedarf mit Lademanagement). */
    connection: connection ?? 0,
    reserveOpen: !!settings && settings.grid_import_limit_kw === null,
    fresh,
    /** Letzte erfolgreiche Rechnung dieses Flughafens, auch fuer eine fruehere Stellung. */
    last: fresh ?? shared.last.get(atlasId(airport)) ?? null,
    /** Fehler gilt nur fuer die Stellung und den Versuch, bei dem er auftrat. */
    curveError: failure && failure.key === key && failure.attempt === attempt ? failure.text : "",
    retry: () => setAttempt((n) => n + 1),
    selected,
    setSelected: (r: Rechnung) => {
      shared.selected = r;
      setSelectedState(r);
    },
  };
}
