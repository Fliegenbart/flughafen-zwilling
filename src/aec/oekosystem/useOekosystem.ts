/**
 * Gemeinsamer Zustand der Startseite und der Seite fuer Fachleute: vorab gerechnete Tabelle,
 * Reglerstellung (auch in der Adresse) und die genaue Serverrechnung, sobald die Regler ruhen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareElectrification,
  getAtlas,
  type Atlas,
  type ElectrificationComparison,
} from "../api/electrification";
import { useNav } from "../context";
import { changedFromStart, snap, START, stagesFor, type Settings } from "./stufen";

const SETTLE_MS = 400;
const sameSettings = (a: Settings, b: Settings) =>
  (Object.keys(a) as (keyof Settings)[]).every((k) => a[k] === b[k]);

export function useOekosystem(page: "start" | "fachleute") {
  const { route, navigate } = useNav();
  const [settings, setSettings] = useState<Settings>(() => ({
    ...START,
    ...(route.page === page ? route.einstellung : undefined),
  }));
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [loadError, setLoadError] = useState("");
  const [curves, setCurves] = useState<{ for: Settings; data: ElectrificationComparison } | null>(
    null,
  );
  const [curveError, setCurveError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getAtlas(controller.signal)
      .then((a) => {
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
  const fresh = curves && sameSettings(curves.for, settings) ? curves.data : null;
  return { atlas, loadError, settings, setSettings, stages, fresh, curveError };
}
