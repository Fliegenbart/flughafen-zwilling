/**
 * Praesentationsmodus fuer den Beamer: groessere Schrift, nur das Noetige, Vollbild wo der Browser
 * es erlaubt. Taste P schaltet um, Esc beendet. Ein Flughafenwechsel baut die Seite neu auf;
 * Modus und Vollbild gehen dabei mit (keepPresentationAcrossSwitch).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) &&
  !(el instanceof HTMLInputElement && el.type === "range");

// Ueber den Neuaufbau beim Flughafenwechsel hinweg (AirportEnergyCheck setzt den Flughafen als key).
let lastOn = false;
let switching = false;

/** Vor einem Flughafenwechsel: Praesentationsmodus und Vollbild in die neue Seite mitnehmen. */
export function keepPresentationAcrossSwitch() {
  switching = true;
}

export function usePresentation() {
  // Nicht hier zuruecksetzen: Die alte Seite raeumt erst nach diesem Render auf.
  const [on, setOn] = useState(() => switching && lastOn);
  /** Der Schalter bleibt im Modus sichtbar; dorthin geht der Fokus, wenn sein Ort verschwindet. */
  const toggleRef = useRef<HTMLButtonElement>(null);

  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    } catch {
      /* ohne Vollbild: die Darstellung wechselt trotzdem */
    }
  }, []);

  useEffect(() => {
    // Beendet der Nutzer das Vollbild selbst (Esc), endet auch der Modus.
    const sync = () => {
      if (!document.fullscreenElement) setOn(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "p" || e.key === "P") set(!on);
      else if (e.key === "Escape" && on) set(false);
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("keydown", key);
    };
  }, [on, set]);

  // Blendet der Modus das fokussierte Element aus (Schieber, Schrittleiste, Zurueck), ginge der
  // Fokus an die Seite verloren und die Tastatur stuende im Leeren.
  useEffect(() => {
    if (!on) return;
    const el = document.activeElement;
    if (!el || el === document.body || el.getClientRects().length === 0) toggleRef.current?.focus();
  }, [on]);

  useEffect(() => {
    lastOn = on;
  }, [on]);

  // Laeuft nach dem Aufraeumen der alten Seite: Der Wechsel ist abgeschlossen.
  useEffect(() => {
    switching = false;
  }, []);

  // Beim Verlassen der Seite kein Vollbild zuruecklassen, ausser beim Flughafenwechsel.
  useEffect(
    () => () => {
      if (!switching && document.fullscreenElement)
        void document.exitFullscreen?.().catch(() => undefined);
    },
    [],
  );

  return { presenting: on, setPresenting: set, toggleRef };
}
