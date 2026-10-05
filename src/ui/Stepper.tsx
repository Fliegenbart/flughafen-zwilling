import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type StepDef = { id: string; label: string; hint: string };

/** Die fuenf Vorfuehrschritte des Airport-Arbeitsbereichs. */
export const DEMO_STEPS: StepDef[] = [
  { id: "system", label: "System verstehen", hint: "Anlagen, Flotte, Annahmen" },
  { id: "betrieb", label: "Betriebswirkung", hint: "Flugplan und Regelvergleich" },
  { id: "robustheit", label: "Robustheit", hint: "Stress-Screen, vier Varianten" },
  { id: "pilot", label: "Pilot vereinbaren", hint: "Frage, Kriterien, Messdaten" },
  { id: "nachweise", label: "Nachweise", hint: "Evidenzstatus und Exporte" },
];

type StepState = {
  steps: StepDef[];
  current: string;
  visited: ReadonlySet<string>;
  select: (id: string) => void;
};
const StepContext = createContext<StepState | null>(null);

const PARAM = "schritt";

function initialStep(steps: StepDef[]): string {
  try {
    const wanted = new URLSearchParams(window.location.search).get(PARAM);
    if (wanted && steps.some((s) => s.id === wanted)) return wanted;
  } catch {
    /* ohne URL: erster Schritt */
  }
  return steps[0]?.id ?? "";
}

export function StepProvider({ steps, children }: { steps: StepDef[]; children: ReactNode }) {
  const [current, setCurrent] = useState(() => initialStep(steps));
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([current]));
  const select = useCallback(
    (id: string) => {
      if (!steps.some((s) => s.id === id)) return;
      setCurrent(id);
      setVisited((previous) => (previous.has(id) ? previous : new Set([...previous, id])));
      try {
        const params = new URLSearchParams(window.location.search);
        params.set(PARAM, id);
        window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
      } catch {
        /* Verlauf nicht verfuegbar: Zustand bleibt lokal */
      }
    },
    [steps],
  );
  const value = useMemo(
    () => ({ steps, current, visited, select }),
    [steps, current, visited, select],
  );
  return <StepContext.Provider value={value}>{children}</StepContext.Provider>;
}

export function useStep(): StepState | null {
  return useContext(StepContext);
}

/** Sichtbarer Schritt-Navigator; Pfeiltasten, Pos1/Ende wechseln den Schritt. */
export function Stepper({ label = "Vorführschritte" }: { label?: string }) {
  const state = useStep();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!state) return null;
  const { steps, current, select } = state;
  const index = steps.findIndex((s) => s.id === current);

  function onKey(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: steps.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = ((keys[event.key] ?? at) + steps.length) % steps.length;
    const target = steps[next];
    if (!target) return;
    select(target.id);
    refs.current[next]?.focus();
  }

  return (
    <nav className="ds-stepper" aria-label={label}>
      <ol>
        {steps.map((step, at) => (
          <li key={step.id} data-state={at < index ? "done" : at === index ? "current" : "next"}>
            <button
              type="button"
              ref={(el) => {
                refs.current[at] = el;
              }}
              aria-current={at === index ? "step" : undefined}
              onClick={() => select(step.id)}
              onKeyDown={(e) => onKey(e, at)}
            >
              <span className="ds-stepper__num" aria-hidden="true">
                {at + 1}
              </span>
              <span className="ds-stepper__text">
                <strong>{step.label}</strong>
                <small>{step.hint}</small>
              </span>
              <span className="ds-visually-hidden">{`Schritt ${at + 1} von ${steps.length}`}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Weiter/Zurueck am Ende eines Schritts. */
export function StepFooter() {
  const state = useStep();
  if (!state) return null;
  const { steps, current, select } = state;
  const index = steps.findIndex((s) => s.id === current);
  const prev = steps[index - 1];
  const next = steps[index + 1];
  return (
    <div className="ds-step-footer">
      {prev ? (
        <button type="button" className="ds-button" onClick={() => select(prev.id)}>
          ← {prev.label}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={() => {
            select(next.id);
            window.scrollTo?.({ top: 0 });
          }}
        >
          Weiter: {next.label} →
        </button>
      )}
    </div>
  );
}

/**
 * Inhalt eines Schritts. Inaktive Schritte bleiben montiert (laufende Runs,
 * Formularzustand), werden aber per CSS ausgeblendet. Ohne Provider: immer sichtbar.
 */
export function StepPanel({
  step,
  children,
  lazy = false,
}: {
  step: string;
  children: ReactNode;
  /** Erst beim ersten Besuch montieren (z. B. Panels mit eigenem Laden). */
  lazy?: boolean;
}) {
  const state = useStep();
  const active = !state || state.current === step;
  const visited = !state || state.visited.has(step);
  const meta = state?.steps.find((s) => s.id === step);
  return (
    <div
      className="ds-step-panel"
      data-step-panel={step}
      data-active={active ? "true" : "false"}
      aria-label={meta ? `Schritt: ${meta.label}` : undefined}
      role={meta ? "group" : undefined}
    >
      {lazy && !visited ? null : children}
    </div>
  );
}

/** Kopf eines Schritts: Nummer, Titel, eine Zeile Zweck, optionale Evidenz-Badges. */
export function StepHead({
  step,
  children,
  badges,
}: {
  step: string;
  children: ReactNode;
  badges?: ReactNode;
}) {
  const state = useStep();
  const index = state ? state.steps.findIndex((s) => s.id === step) : -1;
  const meta = index >= 0 ? state!.steps[index] : DEMO_STEPS.find((s) => s.id === step);
  if (!meta) return null;
  return (
    <div className="ds-step-head">
      <h2>
        {index >= 0 ? `${index + 1} · ` : ""}
        {meta.label}
      </h2>
      <p>{children}</p>
      {badges && <div className="ds-answer__meta">{badges}</div>}
    </div>
  );
}
