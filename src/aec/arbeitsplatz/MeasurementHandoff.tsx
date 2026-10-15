import { useEffect, useRef, useState } from "react";
import { request } from "../api/http";
import type { Preview } from "../api/preview";
import { extraVehiclesFor } from "../api/preview";
import { useNav } from "../context";
import type { Levers } from "../model/livePower";
import Link from "../Link";
import type { ElectrificationInputs, Solution } from "../api/electrification";

type RunStatus = {
  run_id: string;
  state: "queued" | "running" | "completed" | "failed";
  error?: string | null;
};

type DemoRequest = {
  grid_import_limit_kw: number;
  storage_kwh: number;
  storage_kw?: number;
  pv_factor: number;
  extra_vehicles?: Record<string, number>;
};

const POLL_INTERVAL_MS = 250;
const MAX_POLL_ATTEMPTS = 240;

function hasSnapshotConfig(exact: Preview | null): boolean {
  const metadata = exact?.metadata;
  return !!metadata && typeof metadata.config === "object" && metadata.config !== null;
}

function requestFor(levers: Levers): DemoRequest {
  const extra = extraVehiclesFor(levers);
  return {
    grid_import_limit_kw: levers.gridLimitKw,
    storage_kwh: levers.batteryKwh,
    ...(levers.batteryKwh > 0 && levers.batteryKw ? { storage_kw: levers.batteryKw } : {}),
    pv_factor: levers.pvFactor,
    ...(extra ? { extra_vehicles: extra } : {}),
  };
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Abgebrochen", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default function MeasurementHandoff({
  demo,
  projectId,
  exact,
  levers,
  exactCurrent,
  question,
  electrification,
}: {
  demo: boolean;
  projectId: string;
  exact: Preview | null;
  levers: Levers | null;
  exactCurrent: boolean;
  question: string;
  electrification?: ElectrificationInputs & { solution: Solution };
}) {
  const nav = useNav();
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const creationAttempted = useRef(false);
  const runId = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "polling" | "failed">("idle");
  const [message, setMessage] = useState("");
  const ready = demo && exactCurrent && !!levers && hasSnapshotConfig(exact);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  function finish(run: string) {
    try {
      sessionStorage.setItem(`aec.measurement-question.${run}`, question);
    } catch {
      /* Die Navigation bleibt auch ohne Sitzungs-Storage möglich. */
    }
    nav.navigate({ page: "lab", projekt: projectId, run });
  }

  async function monitor(run: string) {
    if (busy.current) return;
    busy.current = true;
    setState("polling");
    setMessage("");
    const signal = new AbortController();
    controller.current = signal;
    try {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        const status = await request<RunStatus>(`/runs/${encodeURIComponent(run)}`, {
          signal: signal.signal,
        });
        if (signal.signal.aborted) return;
        if (status.state === "completed") {
          finish(run);
          return;
        }
        if (status.state === "failed") {
          setState("failed");
          setMessage(status.error || "Der gespeicherte SIL-Lauf ist fehlgeschlagen.");
          return;
        }
        await pause(POLL_INTERVAL_MS, signal.signal);
      }
      setState("failed");
      setMessage("Zeitüberschreitung beim Statusabruf. Der Lauf wurde nicht erneut angelegt.");
    } catch (error) {
      if (signal.signal.aborted) return;
      setState("failed");
      setMessage(error instanceof Error ? error.message : "Status konnte nicht geladen werden.");
    } finally {
      busy.current = false;
    }
  }

  async function start() {
    if (!ready || !levers || busy.current || runId.current || creationAttempted.current) return;
    creationAttempted.current = true;
    busy.current = true;
    setState("creating");
    setMessage("");
    const signal = new AbortController();
    controller.current = signal;
    try {
      const status = await request<RunStatus>(
        electrification ? "/demo/electrification/runs" : "/demo/simulation/runs",
        {
          method: "POST",
          body: JSON.stringify(electrification ?? requestFor(levers)),
          signal: signal.signal,
        },
        { timeoutMs: 60000 },
      );
      if (signal.signal.aborted) return;
      runId.current = status.run_id;
      try {
        sessionStorage.setItem(`aec.measurement-question.${status.run_id}`, question);
      } catch {
        /* Die Frage wird nicht erfunden, falls Storage nicht verfügbar ist. */
      }
      busy.current = false;
      if (status.state === "completed") {
        finish(status.run_id);
        return;
      }
      if (status.state === "failed") {
        setState("failed");
        setMessage(status.error || "Der gespeicherte SIL-Lauf ist fehlgeschlagen.");
        return;
      }
      void monitor(status.run_id);
    } catch (error) {
      if (signal.signal.aborted) return;
      setState("failed");
      setMessage(
        `Der SIL-Lauf konnte nicht bestätigt werden. Es wurde kein zweiter Lauf angelegt: ${
          error instanceof Error ? error.message : "unbekannter Fehler"
        }`,
      );
      busy.current = false;
    }
  }

  if (!demo)
    return (
      <p>
        <Link to={{ page: "lab", projekt: projectId }} className="ap-head__link">
          Gespeicherte Berechnung auswählen
        </Link>
      </p>
    );

  return (
    <div>
      <p>
        Ein unveränderlicher SIL-Lauf speichert die exakten Eingaben dieser Berechnung. Er steuert
        keine Hardware und ersetzt keine Messung.
      </p>
      <button
        className="ap-reset"
        type="button"
        disabled={
          !ready || state === "creating" || state === "polling" || creationAttempted.current
        }
        onClick={() => void start()}
      >
        {state === "creating" || state === "polling"
          ? "SIL-Lauf wird gespeichert …"
          : "Mit Messdaten überprüfen"}
      </button>
      {!ready ? (
        <p>Erst die präzise aktuelle Berechnung abwarten; Näherungen werden nicht gespeichert.</p>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
      {runId.current && state === "failed" ? (
        <button className="ap-reset" type="button" onClick={() => void monitor(runId.current!)}>
          Status erneut prüfen
        </button>
      ) : null}
    </div>
  );
}
