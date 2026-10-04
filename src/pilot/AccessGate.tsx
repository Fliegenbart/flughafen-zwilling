import { useEffect, useState, type ReactNode } from "react";
import { request } from "../munich/api";
import "./PilotStudio.css";
type Session = {
  enabled: boolean;
  authenticated: boolean;
  user?: string | { username: string; role: string } | null;
  role?: string;
};
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    request<Session>("/auth/session", { signal: controller.signal })
      .then(setSession)
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
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
                  .catch((e) => setError(String(e)));
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
                .catch((e) => setError(String(e)))
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
