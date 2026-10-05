import { useEffect, useState, type ReactNode } from "react";
import { request } from "../munich/api";
import "./PilotStudio.css";
type Session = {
  enabled: boolean;
  authenticated: boolean;
  user?: string | { username: string; role: string } | null;
  role?: string;
};
const ERROR_TEXTS: Record<string, string> = {
  invalid_credentials: "Benutzername oder Passwort ist falsch.",
  too_many_login_attempts:
    "Zu viele Fehlversuche. Bitte kurz warten (wenige Sekunden bis Minuten) und erneut versuchen.",
  csrf_origin_rejected:
    "Die Anmeldung wurde aus Sicherheitsgründen abgelehnt. Bitte die Seite neu laden.",
  invalid_login_payload: "Bitte Benutzername und Passwort eingeben.",
  login_payload_too_large: "Die Eingabe ist zu lang.",
  auth_disabled: "Für diese Instanz ist keine Anmeldung eingerichtet.",
  authentication_required: "Die Sitzung ist abgelaufen. Bitte erneut anmelden.",
};

function describeError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError")
    return "Der Server antwortet nicht rechtzeitig. Bitte später erneut versuchen.";
  if (e instanceof TypeError) return "Der Server ist nicht erreichbar. Bitte Verbindung prüfen.";
  const raw = (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "").trim();
  if (ERROR_TEXTS[raw]) return ERROR_TEXTS[raw];
  if (/^API-Fehler 5\d\d$/.test(raw))
    return "Der Server meldet einen Fehler. Bitte später erneut versuchen.";
  if (/^API-Fehler 4\d\d$/.test(raw)) return "Die Anfrage wurde abgelehnt. Bitte erneut anmelden.";
  return "Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.";
}

export default function AccessGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try {
      setSession(await request<Session>("/auth/session"));
    } catch (e) {
      setError(describeError(e));
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    request<Session>("/auth/session", { signal: controller.signal })
      .then(setSession)
      .catch((e) => {
        if (!controller.signal.aborted) setError(describeError(e));
      });
    return () => controller.abort();
  }, []);
  if (session && (!session.enabled || session.authenticated))
    return (
      <>
        {session.enabled && (
          <div className="pilot-access-bar">
            <span>
              Persönlicher Zugang ·{" "}
              {typeof session.user === "string" ? session.user : session.user?.username} ·{" "}
              {session.role ?? (typeof session.user === "object" ? session.user?.role : "")}
            </span>
            <button
              onClick={() => {
                void request("/auth/logout", { method: "POST" })
                  .then(() => {
                    window.location.reload();
                  })
                  .catch((e) => setError(describeError(e)));
              }}
            >
              Abmelden
            </button>
            {error && <span role="alert">{error}</span>}
          </div>
        )}
        {children}
      </>
    );
  return (
    <main className="pilot-access">
      <section className="pilot-studio">
        <span className="pilot-studio__eyebrow">Airport Twin Core / geschützter Pilot</span>
        <h2>{session ? "Persönlich anmelden" : "Zugang prüfen"}</h2>
        <p>Eine dedizierte Kundeninstanz. Keine automatische Anlagensteuerung.</p>
        {error && (
          <p className="pilot-studio__error" role="alert">
            {error}
          </p>
        )}
        {!session ? (
          <button onClick={() => void load()}>Erneut prüfen</button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              void request("/auth/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
              })
                .then(async () => {
                  setPassword("");
                  await load();
                })
                .catch((e) => setError(describeError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Benutzername
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              Anmelden
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
