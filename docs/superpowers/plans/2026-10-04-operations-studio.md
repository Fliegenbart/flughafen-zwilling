# Operations Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das freigegebene Design A als echte, bedienbare helle Flughafen- und Muenchen-Arbeitsflaeche umsetzen, ohne Simulation, API-Vertraege oder FlexLab umzubauen.

**Architecture:** Ein scoped Design-System und ein gemeinsamer Flughafen-Rahmen tragen beide Flughafenansichten. Muenchen priorisiert den gekoppelten Vergleich; dessen bestehende Komponente behaelt Requests, State, Validierung und Polling. Praesentationsslots, Kopf, Konfiguration, Vergleich und Nachweistabellen werden neu angeordnet; Energie-v1 bleibt separat und Frontend-HTML-Reports erhalten dieselbe visuelle Linie.

**Tech Stack:** React 18, TypeScript, Vite, Recharts, lokale Sora/IBM Plex Mono, CSS, Vitest/Testing Library, vorhandene Docker-Demo. Keine neue UI-Library, kein neuer Backend-Dienst.

---

## Freigabe, Ausgangsstand und Arbeitsregeln

- Nutzer hat Design A und den Umfang der Spezifikation bestaetigt.
- Spezifikation: `docs/superpowers/specs/2026-10-04-operations-studio-design.md`.
- Referenz: `docs/superpowers/specs/assets/2026-10-04-operations-studio.png`,
  1536 x 1024; SHA-256 `c9228498053c9e047dca4f068219434b5751324c413f15f78349564f9e0ca5ff`.
- Branch `codex/operations-studio`; Ausgangscommit fuer Implementierung
  `3432269b9777050e12121ee7209748258d356af9`.
- Am 04.10.2026 vor diesem Plan geprueft: Typecheck gruen,
  64 Frontend-Tests in 6 Dateien gruen. Das ist die Baseline, keine Abnahme
  der noch nicht umgesetzten Oberflaeche.
- Die sieben bekannten untracked ` 2`-Dateikopien nicht bearbeiten oder
  stagen. Lokale Companion-Dateien sind unter `.superpowers/` ignoriert.
- `AGENTS.md`, `docs/TIMO_PILOT.md` und die Spezifikation gelten.
- Nur Praesentationscode, zugehoerige Tests und Dokumentation aendern.
  Keine Backend-, Seed-, Adapter-, Archiv- oder Runtime-Dateien aendern.
- Fachliche Guards duerfen nicht fuer die Bildtreue geschwaecht werden.
  Dynamische Werte ersetzen Beispielzahlen, nicht umgekehrt.
- Keine globale CSS-Umfaerbung von FlexLab. Keine neuen Netzabhaengigkeiten.
- Dieser Plan umfasst lokalen Umbau und Abnahme. Ein Hetzner-Deployment
  ist ein separater kontrollierter Schritt, nicht Teil dieser Freigabe.

## Dateigrenzen

| Datei | Verantwortung |
| --- | --- |
| `src/ui/AirportWorkspaceShell.tsx` (neu) | Flughafen-Navigation, Skip-Link, Arbeitsbereich, keine Feature-States |
| `src/ui/operationsStudio.css` (neu) | Scoped Tokens, Navigation, Controls, Tabellen, Breakpoints, Fokus/Motion |
| `src/ui/StudioHeader.tsx` (neu) | Wiederverwendbarer Arbeitskopf und Workflow-Anker, nur ReactNode-Props |
| `src/ui/StudioHeader.test.tsx` (neu) | Kopfaktionen, Kontext und Semantik |
| `src/ui/chartTheme.ts` (neu) | Helle Chart-Farben, Achsen und Tooltips, keine Datenberechnung |
| `src/ui/chartTheme.test.ts` (neu) | Text-/Statuskontrast und Export der Theme-Konstanten |
| `src/ui/reportStyles.ts` (neu) | Portable gemeinsame Report-CSS-Zeichenkette |
| `src/ui/reportStyles.test.ts` (neu) | Keine externen Font-/CSS-URLs, helle Print-Regeln |
| `src/WorkspaceApp.tsx`, `src/WorkspaceApp.css`, `src/main.test.tsx` | Einbau des Flughafen-Rahmens, FlexLab-Zweig erhalten |
| `src/munich/MunichPilot.tsx`, `src/munich/MunichPilot.css` | Kopplung zuerst, statische Energie-v1 darunter, Quellen erhalten |
| `src/munich/CoupledPanel.tsx`, `src/munich/CoupledPanel.css` | Header, Konfigurations-/Ergebnislayout, bestehender Controller |
| `src/munich/CoupledControls.tsx` | Sichtbare Kernparameter, vollstaendige erweiterte Annahmen |
| `src/munich/CoupledCompare.tsx` (neu) | Gemeinsame Baseline-/Prioritaetsflaeche mit Delta und Audit-Tabelle |
| `src/munich/CoupledViews.tsx` | Kompakte ResultCard und helle Recharts-Praesentation |
| `src/munich/FlightPlanPanel.tsx`, `src/munich/FlightPlanPanel.css` | Import/Quelle kompakter, Importlogik unveraendert |
| `src/munich/CoupledPanel.test.tsx`, `src/munich/MunichPilot.test.tsx`, `src/munich/FlightPlanPanel.test.tsx` | Funktionserhalt, Trennung, Guard- und Report-Regression |
| `src/munich/__fixtures__/coupledConfig.ts` (neu) | Unveraenderte vorhandene Coupled-Testkonfiguration, keine Produktionsdefaults |
| `src/App.tsx`, `src/App.css`, `src/App.test.tsx` | Airport-Kopf, KPI-/Chart-/Planner-Praesentation, keine Engine-Aenderung |
| `src/munich/report.ts`, `src/munich/coupledReport.ts` | CSS-Einbau, bestehende Daten/Guards/Escaping erhalten |
| `docs/superpowers/reviews/2026-10-04-operations-studio.md` (neu) | Abnahmeprotokoll ohne Betriebsdaten oder Secrets |

Bestehende Reports und Diagramme werden nicht als Rasterbilder eingebaut.
Das PNG ist nur die Referenz. Keine neuen Router, Stores oder UI-Frameworks.

## Task 1: Scoped Flughafen-Rahmen und stabile Navigation

**Files:** Create `src/ui/AirportWorkspaceShell.tsx`, `src/ui/operationsStudio.css`.
Modify `src/WorkspaceApp.tsx`. Test `src/main.test.tsx`.

- [x] **1.1 Navigationstest rot ergaenzen.** In den vorhandenen `open`-Tests
  bleiben die bestehenden Assertions bestehen. Diese drei Tests ergaenzen:

```tsx
it("uses the studio shell only for airport workspaces", async () => {
  await open("?workspace=airport");
  await screen.findByRole("heading", { name: "Airport Twin Core" });
  expect(document.querySelector("[data-studio]")).not.toBeNull();
  expect(screen.getByRole("link", { name: "Zum Arbeitsbereich" }))
    .toHaveAttribute("href", "#studio-main");
});

it("uses the same studio shell for Munich", async () => {
  await open("?workspace=munich");
  await screen.findByRole("heading", { name: "Flughafen München" });
  expect(document.querySelector("[data-studio]")).not.toBeNull();
});

it("does not apply studio tokens to FlexLab", async () => {
  await open("?workspace=flexlab");
  await screen.findByRole("heading", { name: "FlexLab Workbench" });
  expect(document.querySelector("[data-studio]")).toBeNull();
  expect(document.querySelector(".workspace-frame--flexlab")).not.toBeNull();
});
```

- [ ] **1.2 Rotlauf pruefen.** `npm run test -- src/main.test.tsx`.
  Erwartet: neue Flughafen-Tests scheitern an fehlendem `[data-studio]`;
  bestehende Routen-/Subpath-Tests bleiben unveraendert.

- [x] **1.3 Shell implementieren.** Ganze neue TSX-Datei:

```tsx
import type { ReactNode } from "react";
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./operationsStudio.css";

type Props = {
  workspace: "airport" | "munich";
  basePath: string;
  children: ReactNode;
};
const links = [
  { id: "airport", text: "Flughafen", label: "Flughafen Airport Twin Core", path: "M12 3l2 7 7 3v2l-7-2v5l3 2v1l-5-1-5 1v-1l3-2v-5l-7 2v-2l7-3z" },
  { id: "munich", text: "München", label: "Flughafen / Energiepilot München Referenz", path: "M12 21s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12z M9 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0" },
  { id: "flexlab", text: "FlexLab", label: "Messdaten / Zusatzwerkzeug FlexLab Workbench", path: "M9 3h6 M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3 M7 16h10" },
] as const;

export default function AirportWorkspaceShell({ workspace, basePath, children }: Props) {
  return (
    <div className="studio-workspace" data-studio={workspace}>
      <a className="studio-skip" href="#studio-main">Zum Arbeitsbereich</a>
      <aside className="studio-rail">
        <a className="studio-brand" href={`${basePath}?workspace=airport`}>Airport Twin Core</a>
        <nav aria-label="Arbeitsbereich wählen">
          {links.map((link) => (
            <a key={link.id} href={`${basePath}?workspace=${link.id}`}
              aria-label={link.label} aria-current={link.id === workspace ? "page" : undefined}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"><path d={link.path} /></svg>
              <span>{link.text}</span>
            </a>
          ))}
        </nav>
        <p className="studio-rail-note">Methodenprototyp · SIL</p>
      </aside>
      <div id="studio-main" className="studio-main" tabIndex={-1}>{children}</div>
    </div>
  );
}
```

In `WorkspaceApp`, nach dem bestehenden Title-Effect den Flughafen-Zweig
vor dem bisherigen `return` einfuegen; Import von `AirportWorkspaceShell`
oben ergaenzen. Den alten Header fuer den FlexLab-Zweig erhalten:

```tsx
if (!isFlexLab) {
  return (
    <AirportWorkspaceShell workspace={isMunich ? "munich" : "airport"} basePath={basePath}>
      <Suspense fallback={<p className="workspace-loading" role="status">{title} wird geladen…</p>}>
        {isMunich ? <MunichApp /> : <AirportApp />}
      </Suspense>
    </AirportWorkspaceShell>
  );
}
```

- [x] **1.4 Die komplette scoped CSS-Grundlage anlegen.** Kein `:root`-Theme,
  keine Regeln fuer `body` ohne expliziten Flughafen-Selektor:

```css
.studio-workspace {
  --studio-bg: #f4f6f8; --studio-surface: #fff; --studio-line: #dde3eb;
  --studio-ink: #102033; --studio-muted: #5a6b80; --studio-blue: #2255ee;
  --studio-warning: #9a4a00; --studio-warning-bg: #fff4df;
  --studio-error: #b42332; --studio-success: #176447;
  --bg-base: var(--studio-bg); --bg-layer: var(--studio-surface);
  --bg-layer-2: #edf1f7; --surface: #fff; --surface-strong: #fff;
  --surface-soft: #f6f8fb; --line: var(--studio-line); --line-soft: #e6ebf1;
  --text-high: var(--studio-ink); --text-mid: var(--studio-muted); --text-low: #65758b;
  --cyan: var(--studio-blue); --cyan-strong: #1944ce; --amber: var(--studio-warning);
  --red: var(--studio-error); --green: var(--studio-success);
  --muc-ink: var(--studio-ink); --muc-muted: var(--studio-muted);
  --muc-line: var(--studio-line); --muc-surface: var(--studio-surface);
  --muc-cyan: var(--studio-blue); --muc-amber: var(--studio-warning);
  --radius-xl: 6px; --radius-lg: 6px; --radius-md: 6px; --radius-sm: 6px;
  --shadow-glow: none; --shadow-card: 0 2px 8px #10203308;
  --font-ui: "Sora", "Trebuchet MS", sans-serif;
  --font-mono: "IBM Plex Mono", Menlo, Consolas, monospace;
  display: grid; grid-template-columns: 208px minmax(0, 1fr); min-height: 100vh;
  background: var(--studio-bg); color: var(--studio-ink);
  font: 13px/1.6 var(--font-ui);
}
.studio-workspace *, .studio-workspace *::before, .studio-workspace *::after { box-sizing: border-box; }
.studio-main { min-width: 0; }
.studio-rail { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: #202832; color: #f3f5f8; }
.studio-brand { padding: 24px; color: inherit; text-decoration: none; font-size: 17px; line-height: 1.4; font-weight: 600; }
.studio-rail nav { display: grid; margin-top: 16px; }
.studio-rail nav a { display: flex; align-items: center; gap: 14px; padding: 16px 24px; color: #dce2eb; text-decoration: none; border-left: 3px solid transparent; }
.studio-rail nav a[aria-current="page"] { background: var(--studio-blue); color: #fff; border-left-color: #82a1ff; }
.studio-rail nav a:hover { background: #303d50; }
.studio-rail nav a[aria-current="page"]:hover { background: #1944ce; }
.studio-rail-note { margin: auto 24px 24px; color: #c0ccdc; font-size: 12px; }
.studio-skip { position: fixed; top: -100px; left: 12px; z-index: 30; padding: 12px; background: #fff; color: #102033; }
.studio-skip:focus { top: 12px; }
.studio-workspace :focus-visible { outline: 3px solid #2255ee; outline-offset: 3px; }
.studio-rail :focus-visible { outline-color: #b4c7ff; outline-offset: -4px; }
.studio-workspace button, .studio-workspace input, .studio-workspace select { font: inherit; }
.studio-workspace input:not([type="checkbox"]):not([type="file"]), .studio-workspace select {
  min-width: 0; max-width: 100%; background: #fff; color: #102033;
  border: 1px solid #becbdb; border-radius: 6px; padding: 9px 11px;
}
.studio-workspace button { cursor: pointer; min-height: 40px; border-radius: 6px; transition: background 140ms ease; }
.studio-workspace button:disabled { cursor: not-allowed; opacity: .55; }
.studio-workspace code, .studio-workspace .mono { font-family: var(--font-mono); overflow-wrap: anywhere; }
.studio-workspace a { text-underline-offset: 4px; }
@media (max-width: 1279px) {
  .studio-workspace { display: block; }
  .studio-rail { position: static; height: auto; flex-direction: row; align-items: center; flex-wrap: wrap; }
  .studio-brand { padding: 16px 20px; }
  .studio-rail nav { display: flex; margin: 0; }
  .studio-rail nav a { padding: 12px 16px; }
  .studio-rail-note { margin: 12px 20px 12px auto; }
}
@media (max-width: 767px) {
  .studio-brand { width: 100%; padding: 16px; }
  .studio-rail nav { width: 100%; }
  .studio-rail nav a { flex: 1; padding: 12px; gap: 8px; font-size: 12px; }
  .studio-rail-note { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .studio-workspace *, .studio-workspace *::before, .studio-workspace *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

CSS wird in spaeteren Tasks erweitert, nicht um ein zweites Token-System
ergaenzt. Die alten `.muc-pilot`-Variablen werden in Task 3 entfernt, sonst
ueberschreiben sie die geerbten hellen Tokens.

- [x] **1.5 Gruenlauf und Commit.**

```sh
npm run test -- src/main.test.tsx
npm run typecheck
git add src/ui/AirportWorkspaceShell.tsx src/ui/operationsStudio.css src/WorkspaceApp.tsx src/main.test.tsx
git commit -m "feat(ui): add scoped Operations Studio airport shell"
```

## Task 2: Arbeitskopf, Workflow-Anker und helle Chart-Tokens

**Files:** Create `src/ui/StudioHeader.tsx`, `src/ui/StudioHeader.test.tsx`,
`src/ui/chartTheme.ts`, `src/ui/chartTheme.test.ts`.
Modify `src/ui/operationsStudio.css`.

- [x] **2.1 Tests vor Implementierung schreiben.**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StudioHeader, StudioWorkflowNav } from "./StudioHeader";

it("keeps action ownership in its caller and preserves disabled controls", () => {
  const start = vi.fn();
  render(<StudioHeader title="Flugplan, Flotte & Energie" location="München / Systemtest"
    context="Seed 42" warning="Nicht kalibriert. Keine reale Flug-OTP."
    actions={<><button onClick={start}>Vergleich starten</button><button disabled>Bericht</button></>} />);
  fireEvent.click(screen.getByRole("button", { name: "Vergleich starten" }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Bericht" })).toBeDisabled();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Flugplan, Flotte & Energie");
  expect(screen.getByText(/Keine reale Flug-OTP/)).toBeVisible();
});

it("uses real anchors, not a second simulation state machine", () => {
  render(<StudioWorkflowNav current="vergleich" />);
  expect(screen.getByRole("link", { name: /1.*Flugplan/ })).toHaveAttribute("href", "#coupled-flightplan");
  expect(screen.getByRole("link", { name: /4.*Vergleich/ })).toHaveAttribute("aria-current", "step");
});
```

- [ ] **2.2 Rotlauf.** `npm run test -- src/ui/StudioHeader.test.tsx`.
  Erwartet: Modul fehlt, danach Assertions gruen mit folgendem Code.

- [x] **2.3 Ganze Kopf-/Navigationskomponente anlegen.**

```tsx
import type { ReactNode } from "react";

type HeaderProps = { title: string; location: string; headingId?: string; context?: ReactNode; warning: ReactNode; actions?: ReactNode };
export function StudioHeader({ title, location, headingId, context, warning, actions }: HeaderProps) {
  return (
    <header className="studio-page-header">
      <div className="studio-page-heading"><p>{location}</p><h1 id={headingId}>{title}</h1></div>
      <div className="studio-header-actions">{actions}</div>
      <div className="studio-context"><div>{context}</div><p className="studio-warning">{warning}</p></div>
    </header>
  );
}
const steps = [
  { id: "flightplan", label: "Flugplan", href: "#coupled-flightplan" },
  { id: "fleet", label: "Flotte", href: "#coupled-fleet" },
  { id: "energy", label: "Energie", href: "#coupled-energy" },
  { id: "vergleich", label: "Vergleich", href: "#coupled-compare" },
] as const;
export function StudioWorkflowNav({ current }: { current: typeof steps[number]["id"] }) {
  return <nav className="studio-workflow" aria-label="München Pilotbereiche">
    {steps.map((s, i) => <a key={s.id} href={s.href} aria-label={`${i + 1}. ${s.label}`} aria-current={current === s.id ? "step" : undefined}>
      <span aria-hidden="true">{i + 1}</span>{s.label}
    </a>)}
  </nav>;
}
```

Die Nummer erscheint visuell einmal und ist im Accessible Name enthalten.

- [x] **2.4 Header-CSS erweitern.**

```css
.studio-page-header { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 20px; margin-bottom: 24px; }
.studio-page-heading p { margin: 0 0 4px; color: var(--studio-muted); font-size: 13px; }
.studio-page-heading h1 { margin: 0; font-size: clamp(25px, 2.2vw, 32px); line-height: 1.25; letter-spacing: -.8px; font-weight: 600; }
.studio-header-actions { display: flex; align-items: start; gap: 12px; }
.studio-header-actions button { padding: 10px 16px; border: 1px solid #bdcadd; background: #fff; color: #102033; }
.studio-header-actions button.studio-primary { background: #2255ee; color: #fff; border-color: #2255ee; }
.studio-context { grid-column: 1/-1; display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px solid #dde3eb; border-radius: 6px; padding: 12px 16px; background: #fff; }
.studio-warning { color: #9a4a00; background: #fff4df; padding: 7px 10px; border-radius: 4px; margin: 0; font-size: 12px; }
.studio-workflow { display: flex; justify-content: space-between; gap: 16px; margin: 24px 0; }
.studio-workflow a { display: flex; align-items: center; gap: 12px; color: #52657b; text-decoration: none; font-weight: 600; }
.studio-workflow a span { display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid #63758e; border-radius: 50%; font-weight: 400; }
.studio-workflow a[aria-current="step"] { color: #2255ee; }
.studio-workflow a[aria-current="step"] span { background: #2255ee; color: #fff; border-color: #2255ee; }
@media (max-width: 767px) {
  .studio-page-header { grid-template-columns: 1fr; gap: 16px; }
  .studio-context { display: grid; gap: 12px; padding: 12px; }
  .studio-workflow { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
  .studio-workflow a { font-size: 12px; gap: 8px; }
}
```

- [x] **2.5 Gemeinsames Chart-Theme und Kontrasttest anlegen.**

```ts
export const chartTheme = {
  axis: "#5a6b80", grid: "#dde3eb",
  tooltip: { background: "#ffffff", border: "1px solid #bdcadd", color: "#102033", borderRadius: 6, fontSize: 13 },
  series: { primary: "#2255ee", baseline: "#67758a", amber: "#9a4a00", red: "#b42332", green: "#176447", teal: "#16786b", blue: "#0878aa" },
} as const;
```

In `chartTheme.test.ts` die Farben gegen Weiss pruefen:

```ts
import { expect, it } from "vitest";
import { chartTheme } from "./chartTheme";
function contrastWithWhite(hex: string) {
  const c = hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255)
    .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return 1.05 / (c[0]!*0.2126 + c[1]!*0.7152 + c[2]!*0.0722 + .05);
}
it("keeps axis, tooltip and status text readable on white", () => {
  for (const hex of [chartTheme.axis, chartTheme.tooltip.color, chartTheme.series.amber, chartTheme.series.red, chartTheme.series.green]) {
    expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  }
});
```

- [x] **2.6 Gruenlauf und Commit.** `npm run test -- src/ui/StudioHeader.test.tsx src/ui/chartTheme.test.ts` und `npm run typecheck`.
  Explizit die sechs zu diesem Task gehoerenden Dateien stagen und
  `git commit -m "feat(ui): add studio headers and accessible light chart tokens"`.

## Task 3: Muenchen als gekoppelte Arbeitsflaeche, Energie-v1 separat

**Files:** Modify `src/munich/MunichPilot.tsx`, `src/munich/MunichPilot.css`,
`src/munich/CoupledPanel.tsx`, `src/munich/CoupledPanel.css`,
`src/munich/CoupledControls.tsx`, `src/munich/FlightPlanPanel.css`.
Test `src/munich/MunichPilot.test.tsx`, `src/munich/CoupledPanel.test.tsx`.

- [x] **3.1 Layout-/Controller-Regression schreiben.** In `CoupledPanel.test.tsx`
  die vorhandenen `config`, `plan`, `mockApi` weiter nutzen. `within` zu den
  Testing-Library-Imports ergaenzen; folgenden Test hinzufuegen:

```tsx
it("keeps coupled controls and its own action in one studio workspace", async () => {
  mockApi();
  render(<CoupledPanel plan={plan} flightPlanPanel={<p>Flugplan-Importslot</p>} pollMs={20} />);
  const configArea = await screen.findByRole("region", { name: "Testkonfiguration" });
  expect(within(configArea).getByText("Flugplan-Importslot")).toBeVisible();
  expect(within(configArea).getByLabelText(/Netzimportgrenze/)).toBeVisible();
  const start = screen.getByRole("button", { name: "Gekoppelten Vergleich starten" });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await screen.findByRole("heading", { name: "Fristenpriorität" });
  const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toContain("/munich/coupled-comparisons");
  expect(JSON.parse(String(posts[0]![1]?.body))).toMatchObject({
    flight_plan_snapshot_id: plan.snapshot_id, seed: 42,
    config: { power: config.power },
  });
});
```

In `MunichPilot.test.tsx` den bestehenden H1-Test fuer die bewusst geaenderte
sichtbare Ueberschrift auf `Flugplan, Flotte & Energie` aktualisieren.
`Flughafen München` bleibt als Ortskontext sichtbar. Separaten Energie-v1-
Bereich mit `aria-label` versehen und im vorhandenen `runs the pair`-Test
den Startbutton explizit daraus selektieren:

```tsx
const legacy = screen.getByRole("region", { name: "Energie-v1 / statisch" });
fireEvent.click(within(legacy).getByRole("button", { name: "Regeln vergleichen" }));
```

Das vorhandene Mock in `MunichPilot.test.tsx` fuer `/munich/coupled-reference`
um einen Import von `config` aus einer Testfixture erweitern: den bestehenden
vollstaendigen `config`-Literal aus `CoupledPanel.test.tsx` unveraendert nach
`src/munich/__fixtures__/coupledConfig.ts` verschieben und als
`export const config: CoupledConfig` deklarieren. Die neue Fixture beginnt
mit `import type { CoupledConfig } from "../coupledTypes";`. Beide Testdateien importieren
dieselbe Fixture. Keinen neuen plausibel klingenden Default erfinden:

```ts
if (path.endsWith("/munich/coupled-reference"))
  return new Response(JSON.stringify({ defaults: config }));
```

- [ ] **3.2 Rotlauf.** `npm run test -- src/munich/MunichPilot.test.tsx src/munich/CoupledPanel.test.tsx`.
  Erwartet: fehlender `flightPlanPanel`-Slot, Region und neuer Kopf.

- [x] **3.3 Controller nicht verlagern; nur Praesentationsslot ergaenzen.**
  `ReactNode` als Type importieren. CoupledPanel-Signatur:

```tsx
export default function CoupledPanel({ plan, loadingPlan = false, pollMs = 1000, flightPlanPanel }: {
  plan: FlightPlanSnapshot | null;
  loadingPlan?: boolean;
  pollMs?: number;
  flightPlanPanel?: ReactNode;
}) {
```

Hooks, `start`, `numbersComplete`, `sharedAccepted`, Cache, Timer, Abort,
`coupledPair`, Safety-Pruefung und Exportfunktion bleiben hier und unveraendert.
Den bisherigen Coupled-Header durch `StudioHeader` ersetzen; denselben
Startbutton und Exporthandler einmal in den Kopf verschieben:

```tsx
<StudioHeader title="Flugplan, Flotte & Energie" headingId="coupled-title" location="München / Systemtest"
  context={<><span>Flughafen München</span> · {plan ? flightDate(plan.service_date) : "Kein Flugplantag"} · Seed {seed} · Manueller Flugplan</>}
  warning="Nicht kalibriert. Keine FMG-Betriebsdaten. Modellierte Aufgabenbereitschaft, keine reale Flug-OTP."
  actions={<>
    <button type="button" aria-label="Gekoppelten HTML-Bericht" onClick={exportHtml} disabled={!pair || Boolean(error)}>Bericht</button>
    <button type="button" className="studio-primary" aria-label="Gekoppelten Vergleich starten"
      disabled={!plan || !config || !sharedAccepted || !numbersComplete || busy || loadingPlan}
      onClick={() => void start()}>{starting ? "Vergleich wird angelegt…" : "Vergleich starten"}</button>
  </>} />
<StudioWorkflowNav current={pair && !error ? "vergleich" : plan ? "energy" : "flightplan"} />
```

Die vorhandenen fachlichen Warntexte bleiben im Methoden-/Kontextbereich
vollstaendig erreichbar; kein Ersetzen durch lediglich den kurzen Headertext.
Vorhandene Ack-Checkbox und CoupledControls in die Konfigurationsregion
verschieben. Der bestehende Status-/Fehlerblock bleibt vor den Ergebnissen.
Die Ergebnisregion enthaelt den bisherigen `pair`-Block aus Task 4 samt
Charts, Tabelle, Filtern und Downloads. Struktur mit genau diesen IDs:

```tsx
<div className="studio-coupled-layout">
  <section className="studio-test-config" aria-label="Testkonfiguration">
    <h2>Testkonfiguration</h2>
    <div id="coupled-flightplan">{flightPlanPanel}</div>
    <p>Laderegeln: Ungesteuert / Fristenpriorität</p>
    <p className="muc-small">Annahmen, keine Messwerte.</p>
    {Boolean(plan?.possible_shared_flight_groups) && (
      <label className="coupled-ack"><input type="checkbox" checked={ackFor === plan!.snapshot_id}
        onChange={e => setAckFor(e.target.checked ? plan!.snapshot_id : null)} />
        Mehrfachgruppen als unabhängige Nachfrage annehmen ({plan!.possible_shared_flight_groups} ungeklärt). Keine bestätigten physischen Flugbewegungen.
      </label>
    )}
    {config && <CoupledControls config={config} setConfig={setConfig} seed={seed} setSeed={setSeed} />}
    <p className="muc-small">Keine reale Anlagensteuerung.</p>
  </section>
  <section id="coupled-compare" aria-label="Gekoppelter Regelvergleich" className="studio-coupled-results">
    <h2>Vergleich</h2>
    {!pair && !error && !busy && <p className="studio-empty">Flugplantag und Annahmen prüfen, dann Vergleich starten. Noch keine Modell-KPIs.</p>}
  </section>
</div>
```

Der bestehende Status-/Fehler-/Ergebnisinhalt wird in die Ergebnisregion
verschoben, nicht entfernt. Der bisherige separate `.coupled-actions`-
Startbutton wird entfernt, weil die eine gleiche Aktion bereits im Kopf ist.
Null-Pläne und ungeklaerte Gruppen duerfen nicht durch das neue Layout
umgangen werden. Bei `error` keine Ergebnisfreigabe oder Export anbieten.

In `MunichPilot.tsx` FlightPlanPanel zuerst als ReactNode deklarieren und
im oberen CoupledPanel verwenden. Den bisherigen zweiten FlightPlanPanel
und CoupledPanel innerhalb des statischen `.muc-layout` entfernen. Den
restlichen statischen `.muc-layout` einschliesslich Netzschema, Verlaeufen,
Eingaben, eingefrorenen Ergebnissen und Quellen darunter unveraendert in
`<section aria-label="Energie-v1 / statisch">` setzen. Alten grossen Hero
entfernen; nur CoupledPanel liefert den H1. Es gibt weiterhin genau einen
FlightPlanPanel, einen CoupledPanel und einen statischen Vergleich.

```tsx
const flightPlanPanel = <FlightPlanPanel selected={flightPlan} onSelect={setFlightPlan}
  onBusyChange={setFlightPlanLoading} disabled={busy} />;
```

`disabled={busy}` bezeichnet hier weiterhin ausschliesslich den bestehenden
Energie-v1-Controller. Keine Kopplungs-State-Variable in diesen Controller
kopieren und keine neue globale Busy-Variable einfuehren.

- [x] **3.4 Kernparameter sichtbar machen, erweiterte Werte erhalten.**
  In CoupledControls drei Kernfelder einmal vor dem vorhandenen Detailsblock
  rendern. Im erweiterten `POWER_FIELDS.map` diese drei ausfiltern:

```tsx
const CORE_POWER_KEYS: (keyof PowerConfig)[] = ["grid_import_limit_kw", "chp_output_kw", "background_load_kw"];
```

```tsx
<div id="coupled-energy" className="studio-core-fields">
  {POWER_FIELDS.filter(([key]) => CORE_POWER_KEYS.includes(key)).map(([key, label, unit]) => (
    <Numeric key={key} label={label} unit={unit} value={config.power[key]}
      onChange={v => setConfig({ ...config, power: { ...config.power, [key]: v } })} />
  ))}
</div>
```

Die bisherige aeussere Details-Komponente in einem Fragment hinter diesen
Kernfeldern erhalten. Sichtbarer Summary-Text kann `Weitere Modellannahmen`
sein; notwendige Testselektoren auf genau diesen Namen aktualisieren.
Den vorhandenen Flotten-Detailsbereich mit `id="coupled-fleet"` umschliessen.
Alle uebrigen Numeric-, Flotten-, Seed-, Stress-, Coverage- und Ack-Handler
aus der jetzigen Datei wortgleich erhalten. Keine doppelte editierbare
Instanz desselben Feldes, keine Aenderung des Wertes beim Auf-/Zuklappen.

- [x] **3.5 Scoped Layout und Importbereich umstellen.** Alte harte dunkle
  Farben und die sechs `.muc-pilot`-Variablen entfernen; Selektoren fuer
  Muenchen auf `[data-studio] .muc-pilot` begrenzen. Folgende Basis verwenden:

```css
[data-studio] .muc-pilot { margin: 0; padding: 24px; min-height: 100vh; background: var(--studio-bg); color: var(--studio-ink); font: 13px/1.6 var(--font-ui); }
[data-studio] .muc-panel, [data-studio] .muc-command, [data-studio] .muc-network, [data-studio] .muc-compare { background: #fff; border: 1px solid #dde3eb; border-radius: 6px; box-shadow: none; }
[data-studio] .muc-coupled { padding: 0; background: transparent; border: 0; }
[data-studio] .studio-coupled-layout { display: grid; grid-template-columns: 286px minmax(0,1fr); gap: 16px; align-items: start; }
[data-studio] .studio-test-config, [data-studio] .studio-coupled-results { min-width: 0; padding: 20px; background: #fff; border: 1px solid #dde3eb; border-radius: 6px; }
[data-studio] .studio-test-config h2, [data-studio] .studio-coupled-results h2 { margin: 0 0 20px; font-size: 18px; }
[data-studio] .studio-core-fields { display: grid; gap: 12px; margin-top: 20px; }
[data-studio] .muc-field { color: #102033; font-size: 12px; }
[data-studio] .muc-small { color: #5a6b80; font-size: 12px; }
[data-studio] .muc-error { background: #fff0f1; color: #b42332; border-color: #e1b2b7; }
[data-studio] .muc-warn { color: #9a4a00; }
[data-studio] .muc-ok { color: #176447; }
[data-studio] .muc-tag { border: 0; background: #edf1f7; color: #52657b; border-radius: 4px; }
[data-studio] .muc-primary { background: #2255ee; color: #fff; border-color: #2255ee; box-shadow: none; }
[data-studio] .muc-chart { min-width: 0; background: #fff; }
[data-studio] .muc-table-scroll { max-width: 100%; overflow-x: auto; }
[data-studio] .muc-table-scroll th, [data-studio] .muc-table-scroll td { background: #fff; color: #102033; border-color: #dde3eb; }
[data-studio] .studio-empty { color: #5a6b80; padding: 24px 0; }
[data-studio] .muc-pilot > section[aria-label="Energie-v1 / statisch"] { margin-top: 40px; }
@media (max-width: 1023px) { [data-studio] .studio-coupled-layout { grid-template-columns: 1fr; } }
@media (max-width: 767px) { [data-studio] .muc-pilot { padding: 16px; } [data-studio] .studio-test-config, [data-studio] .studio-coupled-results { padding: 16px; } }
```

FlightPlanPanel-Styles auf helle Inputs, gestapelte Labels, 12-px-Metadaten
und innerhalb der Konfiguration volle Breite setzen. Keine Importaktionen,
CSV-Downloads, Quellen-/Hash-Anzeige oder Warnungen aus dem JSX entfernen.
Die verbleibenden dunklen Hardcodes der vier Muenchen-CSS-Dateien durch die
obigen Rollen ersetzen; technische Detail-/Quellensektionen duerfen unter
dem sichtbaren Kern aufgeklappt werden. Kein globaler `body:has`-Hintergrund.

- [x] **3.6 Gruenlauf und Commit.**

```sh
npm run test -- src/munich/MunichPilot.test.tsx src/munich/CoupledPanel.test.tsx src/munich/FlightPlanPanel.test.tsx
npm run typecheck
git add src/munich/MunichPilot.tsx src/munich/MunichPilot.css src/munich/CoupledPanel.tsx src/munich/CoupledPanel.css src/munich/CoupledControls.tsx src/munich/FlightPlanPanel.css src/munich/MunichPilot.test.tsx src/munich/CoupledPanel.test.tsx src/munich/__fixtures__/coupledConfig.ts
git commit -m "feat(ui): reframe Munich around the coupled studio workspace"
```

## Task 4: Direkter Vergleich, dynamische Nachweise, kompaktes Schema

**Files:** Create `src/munich/CoupledCompare.tsx`.
Modify `src/munich/CoupledViews.tsx`, `src/munich/CoupledPanel.tsx`,
`src/munich/CoupledPanel.css`. Test `src/munich/CoupledPanel.test.tsx`.

- [x] **4.1 Tests fuer den Praesentationsbaustein schreiben.** Im vorhandenen
  Testfile `CoupledCompare` importieren und bestehende `records` verwenden:

```tsx
it("shows dynamic denominators, null deltas and honest missing hash counts", () => {
  const same = structuredClone(records);
  same[1]!.summary!.coupled_kpis = { ...same[0]!.summary!.coupled_kpis };
  render(<CoupledCompare baseline={same[0]!} priority={same[1]!} reportsHashed={false} />);
  expect(screen.getByText(/Kein modellierter Vorteil/)).toBeVisible();
  expect(screen.getByRole("table", { name: "Prüfnachweise" })).toBeVisible();
  expect(screen.getAllByText(/0 \/ 1 modellierte Abflugseinträge rechtzeitig/)).toHaveLength(2);
  expect(screen.getByText(/ohne ursprüngliche SHA256/)).toBeVisible();
  expect(screen.queryByText("7 Dateien")).toBeNull();
});

it("does not replace absent readiness with a fabricated zero", () => {
  const missing = structuredClone(records);
  missing[0]!.summary!.coupled_kpis.departure_readiness_pct = null;
  missing[1]!.summary!.coupled_kpis.departure_readiness_pct = null;
  render(<CoupledCompare baseline={missing[0]!} priority={missing[1]!} reportsHashed />);
  expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(/Kein modellierter Vorteil/)).toBeNull();
});
```

- [ ] **4.2 Rotlauf.** `npm run test -- src/munich/CoupledPanel.test.tsx`.
  Erwartet: neues Modul fehlt. Die bereits vorhandenen negativen Safety-
  und Report-Consistency-Tests weder entfernen noch lockern.

- [x] **4.3 Komponente implementieren; keine zweite KPI-Berechnung.**

```tsx
import type { CoupledRecord } from "./coupledTypes";
import { ResultCard, Delta } from "./CoupledViews";
import { number } from "./config";

type Props = { baseline: CoupledRecord; priority: CoupledRecord; reportsHashed: boolean };
function hashes(record: CoupledRecord) {
  const n = Object.keys(record.build_meta.result_artifact_hashes ?? {}).length;
  return n ? `${n} Dateien` : "n/a";
}
export default function CoupledCompare({ baseline, priority, reportsHashed }: Props) {
  const a = baseline.summary!.coupled_kpis;
  const b = priority.summary!.coupled_kpis;
  const equal = a.departure_readiness_pct !== null && b.departure_readiness_pct !== null
    && Math.round((b.departure_readiness_pct - a.departure_readiness_pct) * 10) === 0;
  const world = baseline.model_pack_snapshot.calibration_meta.coupled_world;
  return (
    <div className="studio-compare">
      <div className="studio-compare-band">
        <ResultCard record={baseline} />
        <div className="studio-primary-delta">
          <Delta label="Aufgabenbereitschaft" base={a.departure_readiness_pct}
            value={b.departure_readiness_pct} unit="pp" higherBetter />
          {equal && <span>Kein modellierter Vorteil</span>}
        </div>
        <ResultCard record={priority} />
      </div>
      <div className="studio-evidence-strip">
        <span>{number(a.mission_count,0)} Serviceaufträge / Baseline</span>
        <span>{number(a.missions_on_time,0)} fristgerecht / Baseline</span>
        <span>Gleiche Welt / Seed {world.seed}</span>
      </div>
      <table aria-label="Prüfnachweise" className="studio-audit-table">
        <caption>Prüfnachweise: technische Integrität, keine empirische Validierung</caption>
        <thead><tr><th scope="col">Nachweis</th><th scope="col">Baseline</th><th scope="col">Fristenpriorität</th></tr></thead>
        <tbody>
          <tr><th scope="row">Welt &amp; Seed</th><td>Identisch</td><td>Identisch</td></tr>
          <tr><th scope="row">Artefakt-Hashes</th><td>{hashes(baseline)}</td><td>{hashes(priority)}</td></tr>
          <tr><th scope="row">Modellkriterien</th>
            {[baseline,priority].map(r => <td key={r.status.run_id} className={r.status.pass_fail ? "muc-ok" : "muc-warn"}>
              {r.status.pass_fail ? "Erfüllt" : "Nicht erfüllt"}</td>)}</tr>
        </tbody>
      </table>
      {!reportsHashed && <p className="muc-warn">Ältere Runs: PDF/Report-Dateien ohne ursprüngliche SHA256.</p>}
    </div>
  );
}
```

Die Komponente ist ausschliesslich **nach** der vorhandenen Paar-/Safety-
Freigabe aufzurufen. Im vorhandenen ResultCard `dl.muc-result__metrics`
mit `<details><summary>Weitere Modellwerte</summary>...</details>` umschliessen.
Haupt-KPI, Nenner, Modellstatus, volle Run-ID und Downloads bleiben sichtbar.
Fuer die Baseline vor dem bestehenden H3 eine kleine Rolle `Baseline /`
rendern; der bestehende H3 `Ungesteuert` bleibt fuer klare Semantik erhalten.

In CoupledPanel die bisherige `.coupled-results`-Map und das erste
Aufgabenbereitschafts-Delta ersetzen; die beiden anderen Deltas erhalten:

```tsx
{pair && !error && <CoupledCompare baseline={pair[0]} priority={pair[1]} reportsHashed={reportsHashed} />}
```

Kein `coupledPair`-, Hash- oder Seed-Guard wird aus dem Controller entfernt.
`reportsHashed` bleibt aus der Safety-Antwort abgeleitet, nie aus dem
Designbild. Alte Reports duerfen nicht als v2 dargestellt werden.

- [x] **4.4 Ein sachlich korrektes Schema aus eingefrorenen Werten rendern.**
  In CoupledCompare unter dem Evidenzstreifen als Detailsbereich ergaenzen:

```tsx
<details className="studio-supply" open>
  <summary>Versorgung &amp; Ladebereiche</summary>
  <p className="muc-small">Schema, kein FMG-Netzplan. Parallele Quellen und Lastbereiche, keine elektrische Serienschaltung.</p>
  <div className="studio-supply-sources">
    <span>Netz · {number(world.config.power.grid_import_limit_kw,0)} kW Importgrenze</span>
    <span>PV · {number(world.config.power.pv_capacity_kwp,0)} kWp Modellfläche</span>
    <span>BHKW · {number(world.config.power.chp_output_kw,0)} kW Fahrplan</span>
  </div>
  <div className="studio-supply-bus">Gemeinsame Wirkleistungsbilanz</div>
  <div className="studio-supply-loads">
    <span>Flotte · {world.config.fleets.reduce((sum,f) => sum + f.vehicles,0)} angenommene Fahrzeuge</span>
    <span>Parkhaus · {world.config.power.parking_sessions} angenommene Ladeaufträge</span>
    <span>Speicher · {number(world.config.power.battery_capacity_kwh,0)} kWh, hypothetisch</span>
  </div>
</details>
```

Keine Energie-v1-`viewConfig` fuer diesen gekoppelten Versuch nutzen.
Keine fuer eine schicke Serienlinie erfundene Netz-Topologie. Diese sachlich
notwendige Abweichung zum generierten Bild in der Abnahme vermerken.

- [x] **4.5 CSS fuer gemeinsame Flaeche ergaenzen.**

```css
[data-studio] .studio-compare-band { display: grid; grid-template-columns: minmax(0,1fr) 150px minmax(0,1fr); gap: 16px; padding: 16px 0; border-top: 1px solid #dde3eb; }
[data-studio] .studio-compare-band .muc-result { background: transparent; border: 0; border-radius: 0; padding: 16px; min-width: 0; }
[data-studio] .studio-compare-band .muc-result__main strong { font-size: 40px; line-height: 1.2; letter-spacing: -1px; color: #102033; }
[data-studio] .studio-primary-delta { border-inline: 1px solid #dde3eb; align-self: center; text-align: center; color: #5a6b80; font-size: 12px; }
[data-studio] .studio-primary-delta strong { display: block; color: #102033; font-size: 30px; line-height: 1.25; margin: 8px 0; }
[data-studio] .studio-evidence-strip { display: flex; gap: 20px; justify-content: space-between; border-block: 1px solid #dde3eb; padding: 16px 0; margin: 16px 0; font-size: 12px; }
[data-studio] .studio-audit-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 20px; }
[data-studio] .studio-audit-table caption { text-align: left; font-size: 14px; font-weight: 600; margin-bottom: 12px; }
[data-studio] .studio-audit-table th, [data-studio] .studio-audit-table td { padding: 12px; text-align: left; border-bottom: 1px solid #dde3eb; }
[data-studio] .studio-audit-table thead { background: #f4f6f8; }
[data-studio] .studio-supply { padding: 16px 0; }
[data-studio] .studio-supply-sources, [data-studio] .studio-supply-loads { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; }
[data-studio] .studio-supply-sources span, [data-studio] .studio-supply-loads span { padding: 12px; border: 1px solid #dde3eb; border-radius: 6px; font-size: 12px; }
[data-studio] .studio-supply-bus { padding: 12px; margin: 12px 0; text-align: center; border-block: 1px solid #2255ee; color: #2255ee; font-size: 12px; }
@media (max-width: 767px) {
  [data-studio] .studio-compare-band { grid-template-columns: 1fr; }
  [data-studio] .studio-primary-delta { border-inline: 0; border-block: 1px solid #dde3eb; padding: 16px; }
  [data-studio] .studio-evidence-strip { flex-direction: column; gap: 8px; }
  [data-studio] .studio-supply-sources, [data-studio] .studio-supply-loads { grid-template-columns: 1fr; }
}
```

- [x] **4.6 Gruenlauf und Commit.** `npm run test -- src/munich/CoupledPanel.test.tsx` und `npm run typecheck`.
  Genau die fuenf Task-Dateien stagen und
  `git commit -m "feat(ui): add evidence-first studio comparison surface"`.

## Task 5: Airport-Dashboard und alle Charts auf Design A

**Files:** Modify `src/App.tsx`, `src/App.css`, `src/App.test.tsx`,
`src/munich/MunichPilot.tsx`, `src/munich/CoupledViews.tsx`.

- [x] **5.1 Leere KPI-Ansicht und acht Cases absichern.** In App.test:

```tsx
it("uses a compact studio header without presenting initial zeros as evidence", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Airport Twin Core", level: 1 })).toBeVisible();
  const band = screen.getByRole("region", { name: "Airport-Modell-KPIs" });
  expect(within(band).getAllByText("n/a")).toHaveLength(4);
  expect(within(band).queryByText("0.00")).toBeNull();
  expect(screen.getByRole("button", { name: "Backend Run starten" })).toBeVisible();
});
```

Die bestehenden acht Case-, Capability-, Polling-, Baseline-/Pareto- und
frozen-report-Tests unveraendert erhalten. `within` importieren.

- [ ] **5.2 Rotlauf.** `npm run test -- src/App.test.tsx`.
  Erwartet: fehlende benannte KPI-Region / initiale Nullwerte.

- [x] **5.3 Arbeitskopf und Aktionen neu anordnen.** Den vorhandenen grossen
  Hero sowie `.app-bg`-Dekorationen entfernen. `StudioHeader` mit Titel
  Airport Twin Core einsetzen, bestehenden API-/Run-/Grafana-Status als
  Kontext nutzen. Die vorhandenen Backend-Run- und Reportbuttons in den
  Kopf verschieben, nicht duplizieren. Die jetzigen OnClick-/Disabled-
  Ausdruecke wortgleich erhalten. `Demo Live starten` und `API pruefen`
  bleiben als beschriftete Sekundaeraktionen in der Konfiguration.

```tsx
<StudioHeader title="Airport Twin Core" location="Flughafen / Turnaround-Systemtest"
  warning="Demo-Modell: unkalibriert. KPI-Werte sind Modellwerte, keine Betriebsprognose."
  context={<><span className={`studio-status ${apiTone}`}>API {state.remoteApiStatus.toUpperCase()}{state.remoteApiLatencyMs != null ? ` / ${state.remoteApiLatencyMs} ms` : ""}</span> · <span className={`studio-status ${runTone}`}>Run {(state.remoteRunState || "idle").toUpperCase()}</span> · <span>Grafana {telemetryStreamEnabled ? "STREAM ON" : "STREAM OFF"}</span></>}
  actions={<>
    <button type="button" onClick={() => reportContext && generateTestReport(state, reportContext.config, reportContext.testId, reportPlaybook)} disabled={state.remoteRunState !== "completed" || !reportContext}>Bericht erzeugen</button>
    <button type="button" className="studio-primary" onClick={runRemoteScenario} disabled={busy}>{busy ? "Starte..." : "Backend Run starten"}</button>
  </>} />
```

Vorhandene Konfigurations-, Safety-, Planner- und Run-Link-Blöcke bleiben
vorhanden. API Base URL darf in `details` mit Summary `API-Verbindung`
verschoben werden; das Eingabelabel und der Handler bleiben identisch.
Run-ID und Fortschritt bleiben ausserhalb versteckter Details.

Den vorhandenen vollstaendigen Conditional-Block mit dem Anker
`playbookRecord?.best_option` und dem Wurzelelement `.playbook-result`
aus der Command-Rail in `.content-grid` direkt nach dem KPI-Band verschieben.
Im fertigen Code steht weiter der komplette bestehende JSX-Block mit Actions, Forecast-Kontext,
Baseline/Empfehlung, Deltas, Pareto-Tabelle und Artefakt-Links. Die aeuessere
Bedingung lautet `playbookEnabled && playbookRecord?.best_option`; in der
Rail verbleiben nur Planner-Controls, Job-ID, Progress und Fehlermeldungen.
Keine zweite Instanz und keine neue Planner-State-Eigentuemerschaft.
Der vorhandene Capability-off-Test muss auch diese Ergebnisflaeche ausschliessen.

- [x] **5.4 Nur Darstellungs-Verfuegbarkeit von KPIs ergaenzen.**
  In App eine lokale UI-Flag einfuehren, keine AirportState-/API-Schemaaenderung:

```tsx
const [hasKpiSummary, setHasKpiSummary] = useState(false);
```

In `pullRunDataFromBase` unmittelbar vor der bestehenden `setState`-Zeile:

```tsx
setHasKpiSummary(Boolean(record?.summary?.airport_kpis));
setState((prev) => stateFromTwinRecord(prev, record, telemetry, safety));
```

Beim Start einer neuen Run-ID zusammen mit den schon bestehenden KPI-
Reset-Zeilen `setHasKpiSummary(false)` aufrufen. Keine neuen Requests.
Im Rendering:

```tsx
const hasKpiEvidence = hasKpiSummary || state.dataLog.length > 0;
```

Das bestehende KPI-Band bekommt `role="region" aria-label="Airport-Modell-KPIs"`.
`StatCardProps.tone` um `neutral` erweitern. Fuer jeden der vier vorhandenen
StatCards bei fehlenden Daten `n/a`, keine Einheit und den Ton `neutral`
rendern. Der konkrete OTP-Aufruf lautet:

```tsx
<StatCard label="OTP" value={hasKpiEvidence ? state.otpRatePct.toFixed(2) : "n/a"}
  unit={hasKpiEvidence ? "%" : ""}
  tone={!hasKpiEvidence ? "neutral" : state.otpRatePct >= 85 ? "good" : "bad"} />
```

Die anderen Zahlen-Ausdruecke bleiben `state.avgTurnaroundMin.toFixed(2)`,
`state.gateUtilizationAvgPct.toFixed(2)`
und `state.delayAvgMin.toFixed(2)`. Keine Auswertungsschwelle aendern.

- [x] **5.5 Dashboard-CSS restrukturieren.** Die alten globalen Body-/Root-
  Regeln und Navy-Variablen aus App.css entfernen; Flughafen-Tokens sind
  Task 1. Bestehende Komponenten-/Stateklassen erhalten, scoped light basis:

```css
[data-studio] .app-shell { padding: 24px; min-height: 100vh; background: #f4f6f8; isolation: auto; }
[data-studio] .app-frame { width: 100%; max-width: none; }
[data-studio] .layout-grid { display: grid; grid-template-columns: 286px minmax(0,1fr); gap: 16px; align-items: start; }
[data-studio] .glass-panel { background: #fff; border: 1px solid #dde3eb; border-radius: 6px; backdrop-filter: none; box-shadow: none; }
[data-studio] .command-rail { padding: 20px; }
[data-studio] .stat-card { background: #fff; border: 0; border-radius: 0; box-shadow: none; padding: 16px; }
[data-studio] .kpi-band { border: 1px solid #dde3eb; border-radius: 6px; background: #fff; overflow: hidden; }
[data-studio] .stat-card + .stat-card { border-left: 1px solid #dde3eb; }
[data-studio] .stat-card__value { color: #102033; font-size: 32px; }
[data-studio] .stat-card--neutral .stat-card__value { color: #5a6b80; }
[data-studio] .btn { min-height: 40px; background: #fff; color: #102033; border: 1px solid #bdcadd; border-radius: 6px; box-shadow: none; }
[data-studio] .btn--primary { background: #2255ee; color: #fff; border-color: #2255ee; }
[data-studio] .btn--live { background: #edf1f7; color: #102033; border-color: #bdcadd; }
[data-studio] .progress-bar { background: #e6ecf4; }
[data-studio] .progress-bar__value { background: #2255ee; }
[data-studio] .chart-panel, [data-studio] .detail-panel { padding: 20px; }
[data-studio] .planner-table-wrap { max-width: 100%; overflow-x: auto; }
[data-studio] .reveal { animation-duration: 180ms; }
@media (max-width: 1023px) { [data-studio] .layout-grid { grid-template-columns: 1fr; } }
@media (max-width: 767px) {
  [data-studio] .app-shell { padding: 16px; }
  [data-studio] .kpi-band { grid-template-columns: repeat(2,minmax(0,1fr)); }
  [data-studio] .stat-card:nth-child(3) { border-left: 0; }
}
```

Restliche App.css-Hardcodes in Planner, Hinweisen, Tabellen und Kontrollen
auf diese Rollen ersetzen. Keine bestehenden Tabellen/Alternativen/Charts
aus Platzgruenden entfernen. Kein Detailblock darf die Grid-Spalte verbreitern.

- [x] **5.6 Charts ausschliesslich visuell aendern.** chartTheme importieren.
  Die vorhandene Airport-`CHART_COLORS`-Definition ersetzen:

```ts
const CHART_COLORS = {
  otp: chartTheme.series.primary, turnaround: chartTheme.series.amber,
  delay: chartTheme.series.red, gate: chartTheme.series.green,
  crew: chartTheme.series.blue, dep: chartTheme.series.red, bag: chartTheme.series.amber,
  axis: chartTheme.axis, grid: chartTheme.grid, tooltipBg: chartTheme.tooltip.background,
};
```

Beide Airport-Tooltips bekommen `contentStyle={chartTheme.tooltip}` und
`labelStyle={{ color: chartTheme.tooltip.color }}`. Munich `PowerChart` und
`CoupledChart` behalten Datenreihen/Formatierer/UTC-Zeitachse; ausschliesslich
`stroke`, `tick.fontSize` (mindestens 12), Grid und Tooltip ersetzen:

```tsx
<CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 5" vertical={false} />
<Tooltip contentStyle={chartTheme.tooltip} />
```

In bestehenden Serien-Tuples werden baseline/grau, priority/blau,
ground/amber, parking/teal anhand der semantischen Theme-Schluessel ersetzt.
Bestehende ReferenceLine/Labels und alle Einheiten bleiben erhalten.

- [x] **5.7 Gruenlauf, Browser-Zwischencheck und Commit.**
  `npm run test -- src/App.test.tsx src/munich/CoupledPanel.test.tsx src/munich/MunichPilot.test.tsx`;
  `npm run typecheck`; alle fuenf Task-Dateien explizit stagen und
  `git commit -m "feat(ui): modernize airport cockpit and telemetry visuals"`.
  Vor Reports das Layout bei 1536 und 390 px im IAB pruefen; sichtbare
  Ueberlaeufe korrigieren, keine abgeschnittene Hauptaktion akzeptieren.

## Task 6: Portable HTML-Reports im Operations-Studio-Look

**Files:** Create `src/ui/reportStyles.ts`, `src/ui/reportStyles.test.ts`.
Modify `src/App.tsx`, `src/munich/report.ts`, `src/munich/coupledReport.ts`.
Test `src/App.test.tsx`, `src/munich/MunichPilot.test.tsx`,
`src/munich/CoupledPanel.test.tsx`.

- [x] **6.1 Gemeinsame CSS-Tests rot schreiben.**

```ts
import { expect, it } from "vitest";
import { REPORT_STYLES } from "./reportStyles";
it("keeps reports light, printable and free of remote dependencies", () => {
  expect(REPORT_STYLES).toContain("--text:#102033");
  expect(REPORT_STYLES).toContain("@media print");
  expect(REPORT_STYLES).not.toMatch(/@import|url\(/i);
});
```

Die drei vorhandenen Reporttests zusaetzlich jeweils auf
`data-report-theme="operations-studio"` pruefen. Existierende Escaping-,
Vergleichs-, fehlende Playbook-, Source-URL- und Null-Delta-Assertions behalten.

- [ ] **6.2 Rotlauf.** `npm run test -- src/ui/reportStyles.test.ts`.

- [x] **6.3 Portable CSS-Konstante anlegen und drei CSS-Bloecke ersetzen.**

```ts
export const REPORT_STYLES = `
:root{--bg-a:#f4f6f8;--bg-b:#ffffff;--surface:#ffffff;--surface-soft:#f6f8fb;--line:#dde3eb;--text:#102033;--text-dim:#5a6b80;--cyan:#2255ee;--good:#176447;--bad:#b42332}
*{box-sizing:border-box}body{margin:0;background:var(--bg-a);color:var(--text);font:14px/1.65 Sora,"Trebuchet MS",sans-serif;padding:32px}
main,.wrapper{max-width:1100px;margin:auto;background:#fff;padding:28px;border:1px solid var(--line);border-radius:6px}
h1{font-size:30px;line-height:1.25;letter-spacing:-.6px;margin:0 0 16px}h2{font-size:20px;line-height:1.4;color:var(--text);margin-top:32px}h3{font-size:16px}
.head{display:flex;justify-content:space-between;align-items:start;gap:24px}.brand small{color:var(--text-dim)}
.warning,.notice{background:#fff4df;color:#9a4a00;border-left:3px solid #9a4a00;padding:16px;margin:20px 0}
.meta{padding:16px;background:var(--surface-soft);border-block:1px solid var(--line)}.meta b{color:var(--text-dim)}
.badge{display:inline-block;padding:6px 10px;border-radius:4px;font-weight:600}.badge.pass{background:#e8f4ec;color:var(--good)}.badge.fail{background:#fff0f1;color:var(--bad)}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}thead{background:var(--surface-soft)}th{font-weight:600}
code,pre,.mono{font-family:"IBM Plex Mono",Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap}details{padding:16px 0;border-top:1px solid var(--line)}summary{cursor:pointer;font-weight:600}
a{color:#2255ee;text-underline-offset:4px}.delta{font-size:24px;color:#102033}.foot,.footer{color:var(--text-dim);font-size:12px;margin-top:24px}.grid,.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
@media(max-width:600px){body{padding:12px}main,.wrapper{padding:16px}.head{display:block}.grid,.compare-grid{grid-template-columns:1fr}th,td{padding:8px;font-size:12px}h1{font-size:25px}}
@media print{body{padding:0;background:#fff;color:#102033}main,.wrapper{max-width:none;margin:0;padding:0;border:0}.warning,.notice{background:#fff4df}h2{break-after:avoid}tr{break-inside:avoid}a{color:#102033}details{break-inside:avoid}}
`;
```

Die sichtbaren HTML-Strukturen/Daten bleiben erhalten. In allen drei
Exporten den `html`-Starttag um `data-report-theme="operations-studio"`
ergaenzen und genau den jeweiligen bisherigen `<style>...</style>`-Inhalt
gegen `${REPORT_STYLES}` tauschen. Imports entsprechend ergaenzen.
Nicht `generateTestReport`, `assertComparable`, `coupledPair`, `escape`,
Nullbehandlung, URL-Pruefung, Reportkontext oder die passenden Playbook-
Zuordnungspruefungen herausrefaktorieren. Alle bisherigen Appendix- und
Vergleichsinhalte behalten. Backend-PDF bleibt unangetastet.

- [x] **6.4 Gruenlauf und Commit.**

```sh
npm run test -- src/ui/reportStyles.test.ts src/App.test.tsx src/munich/MunichPilot.test.tsx src/munich/CoupledPanel.test.tsx
npm run typecheck
git add src/ui/reportStyles.ts src/ui/reportStyles.test.ts src/App.tsx src/munich/report.ts src/munich/coupledReport.ts src/App.test.tsx src/munich/MunichPilot.test.tsx src/munich/CoupledPanel.test.tsx
git commit -m "feat(reports): align frontend exports with Operations Studio"
```

## Task 7: Responsive-, Accessibility- und funktionale Browser-Abnahme

**Files:** Modify nur vorhandene Task-1-bis-6-Dateien fuer gefundene
Praesentationsfehler. Create `docs/superpowers/reviews/2026-10-04-operations-studio.md`.

- [x] **7.1 Alle Quality Gates vor Browser-Abnahme ausfuehren.**

```sh
npm run typecheck
npm run lint
npm run test
npm run build
TWIN_UI_BASE_PATH=/airport/ npm run build
sh scripts/check-recovery.sh
git diff --check
```

Erwartet: alle neuen und bisherigen Tests gruen, keine neuen Lintfehler,
beide Buildvarianten erfolgreich, Archive intakt. Die bekannte Warnung zur
nicht-modularen `runtime-config.js` ist kein Anlass fuer eine neue Architektur.

- [x] **7.2 Isolierte lokale SIL-Demo starten, nicht den geschuetzten Pilot
  aktualisieren.** `docker-compose.demo.yml` setzt INFLUX_TOKEN explizit leer.
  Kein Monitoring-Overlay verwenden; Ports zuerst auf Konflikte pruefen:

```sh
if lsof -nP -iTCP:5186 -iTCP:8016 -sTCP:LISTEN; then
  printf 'QA-Ports bereits belegt; keine fremden Dienste beenden.\n' >&2
  exit 1
fi
AIRPORT_UI_PORT=5186 AIRPORT_API_PORT=8016 TWIN_BUILD_GIT_COMMIT="$(git rev-parse HEAD)" \
  docker compose -p airport-studio-qa -f docker-compose.demo.yml up --build -d
docker compose -p airport-studio-qa -f docker-compose.demo.yml ps
```

Erwartet: genau ein Uvicorn-Prozess fuer diese isolierte Demo, keine Adapter,
kein Influx-Token, eigener Volume `airport-studio-qa_twin-data`.
Bei belegten Ports zuerst klaren Konflikt melden, keine fremden Prozesse
beenden. Keine alten Volumes loeschen, kein `down -v`.

- [x] **7.3 Synthetischen QA-Flugplan lokal erzeugen und klar als Testdaten
  behandeln.** Nicht als echte Muenchner Veroeffentlichung praesentieren.
  Der PDF-Inhalt entspricht dem bereits vorhandenen Parser-Testformat:

```sh
docker compose -p airport-studio-qa -f docker-compose.demo.yml exec -T twin-core python -c '
from io import BytesIO
import sys
from reportlab.pdfgen import canvas
b=BytesIO(); pdf=canvas.Canvas(b,invariant=1); text=pdf.beginText(30,780)
lines=["Flugplan Muenchen / SYNTHETISCHER QA-TEST", "Datenstand: 02.10.2026",
"L/S Flug-Nr - Ziel ab MUC + Ziel an Tag Ziel Stop von bis Term. Airlinename",
"Alle Zeiten im Flugplan sind Ortszeiten. 1 ... 7 = Montag ... Sonntag",
"L XY 101 - 23:10 06:25 1234567 AAA 03.10.26 24.10.26 2 Test Air",
"S XY 102 22:40 + 07:10 1234567 BBB 03.10.26 24.10.26 1 Test Air"]
for line in lines: text.textLine(line)
pdf.drawText(text); pdf.save(); sys.stdout.buffer.write(b.getvalue())
' > /private/tmp/airport-studio-qa-flightplan.pdf
```

PDF im **lokalen** Browser-Import manuell fuer 03.10.2026 auswaehlen.
Kein automatischer Abruf, kein Hochladen beim echten Pilot. Dieses Datum
ist ein fixierter Fixture-Verkehrstag, nicht der aktuelle Nutzertag.

- [x] **7.4 Im IAB Airport und Muenchen funktional pruefen.** Browser ueber
  dokumentierte CUA-APIs bedienen, bestehende Browserbindung wiederverwenden.
  URL `http://localhost:5186/` und `?workspace=munich`. Browserdokumentation
  fuer Viewport-/Screenshot-APIs lesen; keine alternative Shell-Browserautomation.
  Bei UI-Aktionen frischen Zustand pruefen. Private Artefakte nicht ins Repo.

Pruefpunkte:

- Airport: alle acht Cases sichtbar; Guillotine und Schwarzstart jeweils
  explizit im SIL starten; terminaler Abschluss und Modellstatus getrennt.
- Airport-Run-ID, Progress, Audit, Chart-Legenden und CSV/PDF/HTML-Links
  sichtbar; bestehende same-origin und Monitoring-Hinweise nicht verlieren.
- Playbook: Gate sichtbar nur bei Capability, Start/Polling/Ende,
  Baseline/Empfehlung/Pareto, validierte und nicht validierte Optionen.
- Muenchen: manueller Test-PDF-Import, Slot befuellt, keine automatische
  Vergleichserzeugung beim Laden, Coupled-Start einmal, zwei Nachweisruns.
- Eingaben nach abgeschlossenem Run editieren: Ergebnis bleibt als
  eingefrorener Versuch markiert, Report exportiert nicht die neuen Werte.
- Energie-v1 separat bedienen; seine Eingaben duerfen keine gekoppelte
  Welt oder Nachweise ueberschreiben.
- Tabellen filtern, erweiterte Annahmen oeffnen, Quellen/Run-IDs und alle
  bestehenden Downloads auffinden. Null-Deltas bleiben neutral.
- FlexLab-Link funktioniert und bleibt optisch/fachlich separat.

- [ ] **7.5 Desktop/Mobile, Kontrast und Tastatur pruefen.** Viewports
  1536 x 1024, 1440 x 1000, 1024 x 900, 390 x 844; 200-%-Browser-Zoom.
  Keine globale horizontale Scrollbar; nur breite Datentabellen scrollen
  lokal. Controls/Labels nicht abgeschnitten; Fokus, Skip-Link und alle
  Summary-/Datei-/Select-Aktionen mit Tastatur erreichbar. Normale Texte
  mindestens 4,5:1, grosse Texte 3:1. Reduced Motion pruefen; Overrides
  vor Handoff zuruecksetzen.

- [x] **7.6 Bildtreue direkt vergleichen und reparieren.** Referenz und
  aktuelles Browserbild beide mit `view_image` ansehen. Im Review mindestens
  diese sechs konkreten Punkte mit Ist/Soll, Fix oder begruendeter Abweichung:
  Navigation/208-px-Rail, Sora-Typografie, Off-White/Blau-Palette,
  Konfiguration/Ergebnis-Raster, Header/Buttons, Baseline-/Nachweistabellen.
  Sichtbare Copy mit dem freigegebenen Bild und der Spezifikation abgleichen.

Erlaubte fachliche Abweichungen: dynamische Werte statt Beispielzahlen;
festes Regelpaar statt Scheinauswahl; paralleles statt Serien-Schema;
sichtbare originale Guards/Quellen; mehr echte KPI-Details im aufklappbaren
Bereich. Keine weiteren gestalterischen Abweichungen als Geschmackssache.

- [x] **7.7 HTML-Downloads pruefen, ohne Browser-Sicherheitsblocker zu
  umgehen.** Download-/Exportbuttons testen und erzeugten HTML-Inhalt auf
  Theme, eingefrorene IDs, KPI-/Delta-Werte und Warnungen pruefen.
  Wenn Browser lokale Reportdateien blockiert, nicht via anderem Browser
  oder neuem Server denselben Blocker umgehen; Inhalt/Druck-CSS pruefen
  und die fehlende visuelle Reportvorschau ehrlich festhalten.

- [x] **7.8 Reviewprotokoll und reparierte Praesentation committen.**
  Protokoll enthaelt getesteten Commit, Befehle/Resultate, UI-Workflows,
  Viewports, Vergleichspunkte und verbleibende Grenzen. Keine Zugangsdaten,
  echten Quelldateien, Betriebsdaten oder vollstaendigen Logs veroeffentlichen.
  Nur die tatsaechlich reparierten Originaldateien sowie Review-Datei
  explizit stagen; `git commit -m "test(ui): verify studio workflow and responsive fidelity"`.

## Task 8: Finale Regression, Git-Handoff, kein stilles Deployment

**Files:** Review-Dokument aus Task 7 und dieses Plan-Dokument.

- [ ] **8.1 Gesamte Regression am fertigen Commit wiederholen.**

```sh
npm run typecheck
npm run lint
npm run test
npm run build
sh scripts/check-recovery.sh
git diff --check
git diff --name-only 3432269b9777050e12121ee7209748258d356af9
```

Die Liste darf keine Backend-, Seed-, Archiv- oder FlexLab-Fachdatei
enthalten. Nicht gruene oder nicht ausgefuehrte Checks als solche berichten.
Implementierungs-Checklisten erst nach tatsaechlicher Ausfuehrung markieren.

- [ ] **8.2 Getesteten Stand pushen und Remote-SHA vergleichen.**

```sh
git push origin codex/operations-studio
local_sha=$(git rev-parse HEAD)
remote_sha=$(git ls-remote origin refs/heads/codex/operations-studio | cut -f1)
test "$local_sha" = "$remote_sha"
printf 'Verified remote: %s\n' "$remote_sha"
```

- [ ] **8.3 PR erstellen und an diesen Chat anhaengen.** Base-Branch ist
  `codex/recovery-audit`; Titel `Modernize airport UI with Operations Studio`.
  Vor unbekanntem Create-Ausgang vorhandene PRs fuer diesen Head pruefen.
  PR-Beschreibung enthaelt den Praesentationsscope, Tests, Bildvergleich und
  die expliziten Modellgrenzen; keine Secrets, privaten Testdaten oder
  Speicher-/Produktreifeversprechen. `attach_artifact` nach erfolgreicher
  PR-Erstellung aufrufen. Merge nur fuer den getesteten Head mit gruener CI.

- [ ] **8.4 Ergebnis lokal zeigen und klar trennen.** Handoff: lokale
  Test-URL, Referenz/Screenshot, konkrete gepruefte Funktionen, Commit/PR und
  offene Freigaben. Nicht behaupten, der Hetzner-Pilot sei bereits erneuert.
  Ist ein Deployment gewuenscht, zuerst separat kontrolliertes Release
  planen: Daten/Volumes erhalten, Auth und Subpath pruefen, keine anderen
  Anwendungen anfassen. Commercial-/Kalibrierungsgrenzen bleiben offen.

## Plan-Selbstpruefung

- Shell/Navigation/Scope: Task 1; FlexLab-Isolation explizit getestet.
- Tokens, Copy-Hierarchie, Icons, Motion, Kontrast: Tasks 1, 2 und 7.
- Muenchen-Konfiguration, Handlereigentuemer, statische Trennung: Task 3.
- Baseline, Delta, Nenner, Audit-Guards, Schema: Task 4.
- Acht Cases, Planner, Run-Flow und Chart-Lesbarkeit: Task 5.
- Bestehende drei Frontend-HTML-Exporte: Task 6.
- Responsive, reale Bedienpfade, Bildtreue, Subpath und Archive: Task 7.
- Gepruefte Commits, Remote-SHA, PR und Deployment-Grenze: Task 8.

## Ausfuehrungsstand 04.10.2026

Tasks 1 bis 6 implementiert und unabhaengig reviewed; finale Gruenlaeufe im
Reviewprotokoll `../reviews/2026-10-04-operations-studio.md`. Die historischen
Rotlauf-Checkboxen bleiben mangels separat aufbewahrter Root-Logbelege offen;
das ist kein behaupteter erneuter Rotlauf am fertigen Commit.

7.5 ist teilweise abgenommen: alle vier Viewports, Reflow, Kontrast und
Tastatur geprueft; echter 200-%-Browserzoom und aktiv emuliertes Reduced Motion
sind im IAB nicht verfuegbar und bleiben offen. 7.7 ist nach der vorgesehenen
Fallback-Regel abgenommen: echte Downloads und Inhalt/Druck-CSS geprueft;
visuelle Reportvorschau vom Browser blockiert, kein Sicherheitsbypass.

Task 8 wird erst nach tatsaechlicher Regression, Remote-SHA-Pruefung und PR
markiert. Der geschuetzte Hetzner-Pilot wird in diesem Scope nicht deployed.
