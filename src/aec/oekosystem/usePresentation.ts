/**
 * Praesentationsmodus fuer den Beamer: groessere Schrift, nur das Noetige, Vollbild wo der Browser
 * es erlaubt. Taste P schaltet um, Esc beendet. Der Zustand haengt nur an dieser Seite.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) &&
  !(el instanceof HTMLInputElement && el.type === "range");

export function usePresentation() {
  const [on, setOn] = useState(false);
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

  // Beim Verlassen der Seite kein Vollbild zuruecklassen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    },
    [],
  );

  return { presenting: on, setPresenting: set, toggleRef };
}
