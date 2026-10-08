import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/inter-tight";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../ui/designSystem.css";
import "../ui/aecTokens.css";
import "./aec.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavContext, type Nav } from "./context";
import { parseRoute, STEPS, toSearch, type Route } from "./routes";
import Link from "./Link";
import { Mark } from "./parts";
import { SAMPLE_PROJECT } from "./sample";
import Home from "./Home";
import LabPage from "./LabPage";
import Library from "./Library";
import ProjectPage from "./ProjectPage";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "airport.theme";
const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Hell", dark: "Dunkel" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function titleFor(route: Route): string {
  if (route.page === "bibliothek") return "Szenario-Bibliothek · Airport Energy Check";
  if (route.page === "lab") return "Testing-Lab · Airport Energy Check";
  if (route.page === "projekt") {
    const q = STEPS.find((x) => x.id === route.frage)!;
    return `${q.label} · Airport Energy Check`;
  }
  return "Airport Energy Check";
}

export default function AirportEnergyCheck({ basePath }: { basePath: string }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.search));
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* nur fuer diese Sitzung */
    }
  }, [theme]);

  // Alte Adressen (Schritt D "Abgleich", Lab-Werkstatt im Projekt) zeigen den Lab-Raum;
  // die Adresszeile auf die neue Form bringen, damit Lesezeichen danach stimmen.
  useEffect(() => {
    const canonical = toSearch(parseRoute(window.location.search));
    if (route.page === "lab" && window.location.search !== canonical) {
      try {
        window.history.replaceState(null, "", `${basePath}${canonical}`);
      } catch {
        /* ohne Verlauf: Adresse bleibt */
      }
    }
  }, [route, basePath]);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = titleFor(route);
  }, [route]);

  const navigate = useCallback(
    (next: Route, options?: { replace?: boolean }) => {
      const url = `${basePath}${toSearch(next)}`;
      try {
        if (options?.replace) window.history.replaceState(null, "", url);
        else window.history.pushState(null, "", url);
      } catch {
        /* ohne Verlauf: nur Zustand */
      }
      setRoute(next);
      if (!options?.replace) {
        window.scrollTo?.({ top: 0 });
        // Fokus auf den Hauptbereich, damit Screenreader den Ortswechsel hoeren.
        requestAnimationFrame(() =>
          document.getElementById("aec-main")?.focus({ preventScroll: true }),
        );
      }
    },
    [basePath],
  );

  const nav = useMemo<Nav>(() => ({ basePath, route, navigate }), [basePath, route, navigate]);
  const dataTheme = theme === "system" ? undefined : theme;

  return (
    <NavContext.Provider value={nav}>
      <div className="aec" data-theme={dataTheme} data-page={route.page}>
        <a className="aec-skip" href="#aec-main">
          Zum Inhalt
        </a>
        <header className="aec-top">
          <Link
            to={{ page: "start" }}
            className="aec-brand"
            label="Airport Energy Check, Startseite"
          >
            <Mark />
            <span>
              Airport <em>Energy</em> Check
            </span>
          </Link>
          <nav className="aec-top__nav" aria-label="Hauptbereiche">
            <Link to={{ page: "start" }} current={route.page === "start" ? "page" : undefined}>
              Projekte
            </Link>
            <Link
              to={{ page: "bibliothek" }}
              current={route.page === "bibliothek" ? "page" : undefined}
            >
              Szenario-Bibliothek
            </Link>
            <Link
              to={{
                page: "lab",
                projekt:
                  route.page === "projekt" || route.page === "lab"
                    ? route.projekt
                    : SAMPLE_PROJECT.id,
              }}
              current={route.page === "lab" ? "page" : undefined}
              className="aec-top__lab"
            >
              Testing-Lab
            </Link>
          </nav>
          <button
            type="button"
            className="aec-theme"
            aria-label={`Farbschema: ${THEME_LABEL[theme]}. Wechseln zu ${THEME_LABEL[NEXT[theme]]}`}
            onClick={() => setTheme(NEXT[theme])}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
            </svg>
            <span>{THEME_LABEL[theme]}</span>
          </button>
        </header>
        <main id="aec-main" tabIndex={-1} className="aec-main">
          {route.page === "start" ? (
            <Home />
          ) : route.page === "bibliothek" ? (
            <Library theme={dataTheme} />
          ) : route.page === "lab" ? (
            <LabPage key={route.projekt} route={route} theme={dataTheme} />
          ) : (
            <ProjectPage key={route.projekt} route={route} theme={dataTheme} />
          )}
        </main>
        <footer className="aec-foot">
          <p>
            Airport Energy Check ist ein Prototyp von electrified labs. Das Modell ist nicht an
            Messungen kalibriert und steuert keine Anlagen.
          </p>
        </footer>
      </div>
    </NavContext.Provider>
  );
}
