/**
 * Zustand der Startseite und der Seite fuer Fachleute: vorab gerechnete Tabelle, Reglerstellung
 * (auch in der Adresse) und die genaue Serverrechnung, sobald die Regler ruhen. Tabelle,
 * Rechnungen und gewaehlte Stufe bleiben beim Wechsel zwischen beiden Seiten erhalten.
 */
import { useEffect, useMemo, useState } from "react";
import {
  compareElectrification,
  getAtlas,
  type Atlas,
  type ElectrificationComparison,
} from "../api/electrification";
import { useNav } from "../context";
import type { Rechnung } from "./kurve";
import { changedFromStart, snap, START, stagesFor, type Settings } from "./stufen";

const SETTLE_MS = 400;
const KEEP = 24;
const sameSettings = (a: Settings, b: Settings) =>
  (Object.keys(a) as (keyof Settings)[]).every((k) => a[k] === b[k]);
const keyOf = (s: Settings) => JSON.stringify([...Object.values(s)]);

// Ueber den Seitenwechsel hinweg: dieselbe Stellung wird nicht zweimal gerechnet.
const shared: {
  atlas: Atlas | null;
  results: Map<string, ElectrificationComparison>;
  last: ElectrificationComparison | null;
  selected: Rechnung;
} = { atlas: null, results: new Map(), last: null, selected: "uncontrolled" };

function remember(s: Settings, data: ElectrificationComparison) {
  shared.results.delete(keyOf(s));
  shared.results.set(keyOf(s), data);
  shared.last = data;
  if (shared.results.size > KEEP) shared.results.delete(shared.results.keys().next().value!);
}

/** Nur fuer Tests: gemeinsamen Zwischenspeicher leeren. */
export function forgetShared() {
  shared.atlas = null;
  shared.results.clear();
  shared.last = null;
  shared.selected = "uncontrolled";
}

function fromRoute(route: ReturnType<typeof useNav>["route"], page: string): Settings {
  return {
    ...START,
    ...(route.page === page && "einstellung" in route ? route.einstellung : undefined),
  };
}

export function useOekosystem(page: "start" | "fachleute") {
  const { route, navigate } = useNav();
  const [atlas, setAtlas] = useState<Atlas | null>(shared.atlas);
  const [settings, setSettings] = useState<Settings>(() => {
    const s = fromRoute(route, page);
    return shared.atlas ? snap(shared.atlas, s) : s;
  });
  const [loadError, setLoadError] = useState("");
  const [, setArrived] = useState(0);
  const [failure, setFailure] = useState<{ key: string; attempt: number; text: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelectedState] = useState<Rechnung>(shared.selected);
  const [seenRoute, setSeenRoute] = useState(route);

  // Browser-Zurueck auf derselben Seite: Regler folgen der Adresse (abgeleiteter Zustand).
  if (route !== seenRoute) {
    setSeenRoute(route);
    if (route.page === page) {
      const wanted = fromRoute(route, page);
      const target = atlas ? snap(atlas, wanted) : wanted;
      if (!sameSettings(target, settings)) setSettings(target);
    }
  }

  useEffect(() => {
    if (shared.atlas) return;
    const controller = new AbortController();
    getAtlas(controller.signal)
      .then((a) => {
        shared.atlas = a;
        setAtlas(a);
        // Eine Stellung aus einem Link liegt nicht immer auf den gerechneten Werten.
        setSettings((s) => {
          const snapped = snap(a, s);
          return sameSettings(s, snapped) ? s : snapped;
        });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(e instanceof Error ? e.message : "Die Werte ließen sich nicht laden.");
      });
    return () => controller.abort();
  }, []);

  // Die Stellung steht in der Adresse: Link weitergeben, Seite neu laden, Stellung bleibt.
  useEffect(() => {
    const einstellung = changedFromStart(settings);
    navigate(einstellung ? { page, einstellung } : { page }, { replace: true });
  }, [navigate, page, settings]);

  // Genau nachrechnen, sobald die Tabelle da ist und die Regler kurz ruhen. Vorher keine Anfrage:
  // erst eingerastete Stellungen treffen die vorab gerechneten Stufen auf dem Server.
  useEffect(() => {
    if (!atlas || shared.results.has(keyOf(settings))) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      compareElectrification(settings, controller.signal)
        .then((data) => {
          remember(settings, data);
          setArrived((n) => n + 1);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setFailure({
              key: keyOf(settings),
              attempt,
              text: e instanceof Error ? e.message : "Die Kurve ließ sich nicht rechnen.",
            });
        });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [atlas, settings, attempt]);

  const stages = useMemo(() => (atlas ? stagesFor(atlas, settings) : null), [atlas, settings]);
  const key = keyOf(settings);
  const fresh = shared.results.get(key) ?? null;
  return {
    atlas,
    loadError,
    settings,
    setSettings,
    stages,
    fresh,
    /** Letzte erfolgreiche Rechnung, auch fuer eine fruehere Stellung (Flotte, Quellen). */
    last: fresh ?? shared.last,
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
