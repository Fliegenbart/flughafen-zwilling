import { useEffect, useState, type ReactNode } from "react";
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./designSystem.css";
import "./operationsStudio.css";

type Props = {
  workspace: "airport" | "munich";
  basePath: string;
  children: ReactNode;
};

const links = [
  {
    id: "airport",
    text: "Flughafen",
    label: "Flughafen Airport Twin Core",
    path: "M12 3l2 7 7 3v2l-7-2v5l3 2v1l-5-1-5 1v-1l3-2v-5l-7 2v-2l7-3z",
  },
  {
    id: "munich",
    text: "München",
    label: "Flughafen / Energiepilot München Referenz",
    path: "M12 21s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12z M9 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  },
  {
    id: "flexlab",
    text: "FlexLab",
    label: "Messdaten / Zusatzwerkzeug FlexLab Workbench",
    path: "M9 3h6 M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3 M7 16h10",
  },
] as const;

type Theme = "system" | "light" | "dark";
const THEME_KEY = "airport.theme";
const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Hell", dark: "Dunkel" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export default function AirportWorkspaceShell({ workspace, basePath, children }: Props) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ohne Speicher gilt die Wahl nur fuer diese Sitzung */
    }
  }, [theme]);
  return (
    <div
      className="studio-workspace"
      data-studio={workspace}
      data-theme={theme === "system" ? undefined : theme}
    >
      <a className="studio-skip" href="#studio-main">
        Zum Arbeitsbereich
      </a>
      <aside className="studio-rail">
        <a className="studio-brand" href={`${basePath}?workspace=airport`}>
          Airport Twin Core
        </a>
        <nav aria-label="Arbeitsbereich wählen">
          {links.map((link) => (
            <a
              key={link.id}
              href={`${basePath}?workspace=${link.id}`}
              aria-label={link.label}
              aria-current={link.id === workspace ? "page" : undefined}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={link.path} />
              </svg>
              <span>{link.text}</span>
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="studio-theme-toggle"
          aria-label={`Farbschema: ${THEME_LABEL[theme]}. Wechseln zu ${THEME_LABEL[NEXT[theme]]}`}
          onClick={() => setTheme(NEXT[theme])}
        >
          Schema: {THEME_LABEL[theme]}
        </button>
        <p className="studio-rail-note">Methodenprototyp · SIL · nicht validiert</p>
      </aside>
      <div id="studio-main" className="studio-main" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
