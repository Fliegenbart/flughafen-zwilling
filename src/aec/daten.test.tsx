import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "./AirportEnergyCheck";
import {
  computeDataStatus,
  EMPTY_INPUTS,
  importError,
  isExampleFile,
  needsFlightPlan,
  splitAnswer,
  type DataInputs,
} from "./model/dataStatus";
import { assetsFromApi, importFromApi } from "./api/data";
import { parseRoute, toSearch } from "./routes";
import { SAMPLE_PROJECT } from "./sample";
import FlightPlanForm, { flightPlanError } from "./views/daten/FlightPlanForm";
import { distributeFleet } from "./model/dataStatus";
import { recomputeState } from "./RecomputeBanner";
import { sampleBoard } from "./api/variants";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  delete (globalThis as { __TWIN_CONFIG__?: unknown }).__TWIN_CONFIG__;
});

const plan = {
  snapshotId: "a".repeat(64),
  serviceDate: "2026-10-03",
  sourceDataDate: "2026-10-02",
  importedAt: "2026-10-04T08:00:00Z",
  sharedGroups: 0,
  departures: 412,
  arrivals: 405,
};
const entry = (key: string, source = "Fuhrparkliste") => ({
  key,
  label: key,
  group: "flotte" as const,
  value: 10,
  unit: "Stück",
  originalValue: 10,
  originalUnit: "Stück",
  source,
  sourceDate: "2026-09-30",
  status: source ? ("echt" as const) : ("annahme" as const),
});
const assets = (entries: ReturnType<typeof entry>[]) => ({
  status: "echt" as const,
  entries,
  fields: [],
  version: null,
});
const input = (patch: Partial<DataInputs>): DataInputs => ({
  ...EMPTY_INPUTS,
  available: true,
  ...patch,
});

describe("Datenstand", () => {
  it("leer: nichts ist echt, Daten-Schritt nötig", () => {
    const s = computeDataStatus(input({}));
    expect(s.real).toBe(0);
    expect(s.items.map((i) => i.state)).toEqual(["fehlt", "fehlt", "fehlt", "fehlt"]);
    // Ein Serverprojekt rechnet ohne Flugplan nicht, also sagt die Antwort auch nichts von Annahmen.
    expect(s.answer).toBe(
      "Noch ist keine der 4 Datenquellen belegt. Es fehlen der offizielle Flugplan, Angaben zu Fahrzeugen und Anlagen sowie Messungen vom Flughafen und aus dem Testing-Lab.",
    );
    expect(s.items[0]!.detail).toBe("Ohne Flugplan können wir den Tag nicht durchrechnen.");
    expect(needsFlightPlan(s)).toBe(true);
  });

  it("Beispielprojekt ohne Server: gerechnet wird mit dem erfundenen Beispieltag", () => {
    const s = computeDataStatus(EMPTY_INPUTS);
    expect(s.answer).toMatch(
      /^Noch ist keine der 4 Datenquellen belegt, gerechnet wird mit Annahmen\./,
    );
    expect(s.items[0]!.detail).toBe("Der Beispieltag rechnet mit erfundenen Abflügen.");
  });

  it("teilt die Antwort in Überschrift und Rest", () => {
    expect(splitAnswer("Alle 4 Datenquellen sind belegt.")).toEqual({
      headline: "Alle 4 Datenquellen sind belegt.",
      detail: "",
    });
    expect(splitAnswer("2 von 4 Datenquellen sind belegt. Es fehlen X.")).toEqual({
      headline: "2 von 4 Datenquellen sind belegt.",
      detail: "Es fehlen X.",
    });
  });

  it("teilweise: Flugplan und Flotte echt, Messdaten fehlen", () => {
    const s = computeDataStatus(
      input({
        plans: [plan],
        assets: assets([entry("grid_import_limit_kw"), entry("fleet.bus.vehicles")]),
      }),
    );
    expect(s.real).toBe(2);
    expect(s.answer).toBe(
      "2 von 4 Datenquellen sind belegt. Es fehlen Messungen vom Flughafen und aus dem Testing-Lab.",
    );
    expect(needsFlightPlan(s)).toBe(false);
  });

  it("Werte ohne Quelle bleiben Annahme; Mehrfachgruppen warnen", () => {
    const s = computeDataStatus(
      input({
        plans: [{ ...plan, sharedGroups: 3 }],
        assets: assets([entry("grid_import_limit_kw"), entry("fleet.bus.vehicles", "")]),
      }),
    );
    const [fp, fl] = s.items;
    expect(fp!.state).toBe("echt");
    expect(fp!.warnings[0]).toMatch(/^3 Flüge könnten doppelt im Plan stehen \(Codeshares\)\./);
    const single = computeDataStatus(input({ plans: [{ ...plan, sharedGroups: 1 }] }));
    expect(single.items[0]!.warnings[0]).toMatch(
      /^Ein Flug könnte doppelt im Plan stehen \(Codeshare\)\. Wir rechnen erst, wenn Sie/,
    );
    expect(fl!.state).toBe("annahme");
    expect(s.answer).toMatch(/Für Fahrzeuge und Anlagen gelten noch Annahmen\./);
    // Der Flugplan ist da: Durchrechnen startet, auch wenn die Flotte noch Annahme ist.
    expect(needsFlightPlan(s)).toBe(false);
  });

  it("abgewiesene Importe zählen nie, PASS nur über Holdout-Bewertung", () => {
    const bad = {
      id: "1",
      role: "holdout" as const,
      filename: "x.csv",
      sourceNote: "Zähler",
      createdAt: "2026-10-04",
      valid: false,
      issues: ["duplicate_timestamp"],
      rows: 10,
      first: null,
      last: null,
    };
    let s = computeDataStatus(input({ imports: [bad] }));
    expect(s.items[2]!.state).toBe("fehlt");
    expect(s.items[2]!.warnings[0]).toMatch(/nicht verwendbar.*Doppelter Zeitstempel/);
    const good = {
      ...bad,
      id: "2",
      valid: true,
      first: "2026-10-01T00:00:00Z",
      last: "2026-10-02T00:00:00Z",
    };
    s = computeDataStatus(input({ imports: [bad, good] }));
    expect(s.items[2]!.state).toBe("echt");
    expect(s.items[2]!.evidence).toBe("empirical_open");
    expect(s.items[2]!.warnings.join(" ")).toMatch(/wenn Grenzen festgelegt sind/);
    s = computeDataStatus(
      input({ imports: [good], holdoutPass: true, tolerances: { locked: true, sha256: "x" } }),
    );
    expect(s.items[2]!.evidence).toBe("empirical_passed");
  });

  it("vollständig, Lab-Simulation zählt nur als Annahme", () => {
    const lab = {
      id: "r",
      source: "csv_import" as const,
      state: "completed" as const,
      filename: "lab.csv",
      createdTs: "2026-10-04T08:00:00Z",
      verdict: "pass" as const,
      qualityReasons: [],
      error: null,
    };
    const imp = importFromApi({
      id: "i",
      role: "calibration",
      filename: "m.csv",
      source_note: "Zähler",
      created_at: "2026-10-04",
      quality: { state: "valid", issues: [], rows: 61 },
    })!;
    const full = input({
      plans: [plan],
      assets: assets([entry("grid_import_limit_kw"), entry("fleet.bus.vehicles")]),
      imports: [imp],
      labRuns: [lab],
    });
    expect(computeDataStatus(full).answer).toBe("Alle 4 Datenquellen sind belegt.");
    const sim = computeDataStatus({ ...full, labRuns: [{ ...lab, source: "simulation" }] });
    expect(sim.items[3]!.state).toBe("annahme");
    expect(sim.items[3]!.evidence).toBe("synthetic");
  });

  it("übersetzt Importfehler verständlich", () => {
    expect(importError("invalid_assets: „PV-Leistung“: nur ganze Zahlen.")).toBe(
      "„PV-Leistung“: nur ganze Zahlen.",
    );
    expect(importError("role_forbidden: set project assets requires admin|airport")).toMatch(
      /Flughafen-Ansicht/,
    );
    expect(importError("timestamp_timezone_required")).toBe("Zeitstempel benötigen eine Zeitzone.");
    expect(importError("Failed to fetch")).toMatch(/Keine Verbindung/);
    expect(importError("csv_text exceeds 5 MiB")).toBe("Die Datei ist größer als 5\u00a0MB.");
    expect(flightPlanError("PDF als application/pdf hochladen")).toBe("Das ist kein PDF.");
    expect(isExampleFile("lastgang-BEISPIEL-erfundene-werte.csv")).toBe(true);
    expect(
      assetsFromApi({ entries: [], status: "fehlt", fields: [{ key: "k", default: 3 }] })!
        .fields[0]!.default,
    ).toBe(3);
  });
});

describe("Navigation zum Daten-Schritt", () => {
  it("Adresse ohne Frage startet automatisch, Weiterleitungen bleiben", () => {
    expect(parseRoute("?projekt=p1")).toEqual({
      page: "arbeitsplatz",
      projekt: "p1",
      auto: true,
    });
    expect(toSearch(parseRoute("?projekt=p1"))).toBe("?projekt=p1");
    expect(parseRoute("?projekt=p1&frage=daten")).toEqual({
      page: "projekt",
      projekt: "p1",
      frage: "daten",
    });
  });

  it("zeigt Datenstand im Kopf, Schild A und Warnhinweis im Daten-Schritt", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}`);
    render(<AirportEnergyCheck basePath="/" />);
    expect(await screen.findByText("Daten: 0 von 4 belegt")).toBeVisible();
    const steps = screen.getByRole("navigation", { name: "Drei Schritte des Projekts" });
    fireEvent.click(within(steps).getByRole("link", { name: /Daten/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /Noch ist keine der 4 Datenquellen/ }),
    ).toBeVisible();
    // Der Name des Datenstand-Links beginnt mit dem sichtbaren Text und nennt die Zahl nur einmal.
    const meter = await screen.findByRole("link", { name: /^Belegt: 0 von 4\. Es fehlen/ });
    expect(meter).toHaveAccessibleName(/ Zu Ihren Daten\.$/);
    expect(meter).not.toHaveAccessibleName(/Datenquellen (sind |ist )?belegt/);
    expect(meter.querySelector("i")).toHaveAttribute("title", "Flugplan: fehlt");
    expect(window.location.search).toContain("frage=daten");
    expect(screen.getByRole("note", { name: "Hinweis zur Demo-Instanz" })).toHaveTextContent(
      /Keine echten Kundendaten/,
    );
    expect(
      within(screen.getByRole("list", { name: "Die vier Datenquellen" })).getAllByRole("heading"),
    ).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Daten/, current: "page" })).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Daten · Airport Energy Check"));
  });

  it("Warnhinweis per Runtime-Konfiguration abschaltbar", async () => {
    (globalThis as { __TWIN_CONFIG__?: unknown }).__TWIN_CONFIG__ = { sharedDemoNotice: false };
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}&frage=daten`);
    render(<AirportEnergyCheck basePath="/" />);
    await screen.findByRole("heading", { level: 1, name: /Datenquellen/ });
    expect(screen.queryByRole("note", { name: "Hinweis zur Demo-Instanz" })).toBeNull();
  });

  it("öffnet ein API-Projekt ohne echte Daten im Daten-Schritt", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body =
          url.includes(`/pilot/projects/${id}`) && !/imports|tolerances|assessments/.test(url)
            ? { id, name: "HAM", scope: "Hamburg", decision: "?" }
            : url.endsWith("/assets")
              ? { status: "fehlt", entries: [], fields: [] }
              : url.endsWith("/tolerances")
                ? null
                : url.includes("/situation") || url.includes("/variants")
                  ? {}
                  : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    window.history.replaceState(null, "", `/?projekt=${id}`);
    render(<AirportEnergyCheck basePath="/" />);
    await waitFor(() => expect(window.location.search).toContain("frage=daten"));
    const head = await screen.findByRole("heading", { level: 1, name: /Noch ist keine/ });
    expect(head).toBeVisible();
    // Die Weiterleitung tauscht den Seitenbaum aus; der Fokus bleibt nicht im Leeren.
    await waitFor(() => expect(document.getElementById("aec-main")).toHaveFocus());
    // Ein Serverprojekt rechnet ohne Flugplan nicht, und die Seite verspricht auch nichts anderes.
    expect(head).not.toHaveTextContent("Annahmen");
    expect(screen.getByText("Ohne Flugplan können wir den Tag nicht durchrechnen.")).toBeVisible();
  });
});

describe("Flugplan-Formular", () => {
  const info = {
    snapshot_id: "b".repeat(64),
    service_date: "2026-10-03",
    source_data_date: "2026-10-02",
    departure_entry_count: 412,
    possible_shared_flight_groups: 1,
  };
  it("verlangt einen eingelesenen Plan und nennt eine einzelne Codeshare in der Einzahl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("/munich/flight-plans") ? [info] : {};
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(
      <FlightPlanForm project={SAMPLE_PROJECT} reload={async () => undefined} disabled={false} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Verwenden" }));
    expect(await screen.findByText("Wählen Sie einen eingelesenen Flugplan aus.")).toBeVisible();
    expect(screen.getByRole("option", { name: /· 1 möglicher Codeshare$/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: info.snapshot_id } });
    fireEvent.click(screen.getByRole("button", { name: "Verwenden" }));
    expect(
      await screen.findByText(
        /Ein Flug könnte doppelt im Plan stehen \(Codeshare\)\. Das klären Sie unten im Detailwerkzeug/,
      ),
    ).toBeVisible();
  });
});

describe("Flotte verteilen und Neuberechnung", () => {
  it("verteilt die Gesamtzahl nach Standardanteilen", () => {
    expect(distributeFleet(100).map((f) => [f.vehicles, f.chargers])).toEqual([
      [20, 8],
      [35, 12],
      [10, 4],
      [35, 10],
    ]);
    const odd = distributeFleet(7);
    expect(odd.reduce((a, f) => a + f.vehicles, 0)).toBe(7);
    for (const f of odd) expect(f.chargers).toBeLessThanOrEqual(f.vehicles);
    expect(distributeFleet(1000).reduce((a, f) => a + f.vehicles, 0)).toBe(300);
  });
  it("erkennt veraltete Läufe über den Hash-Vergleich", () => {
    const base = {
      source: "flight_plan",
      policy: "u",
      gridLimitKw: 1,
      storageKwh: 0,
      fleet: { total: null, byKind: [], source: null },
    };
    const run = {
      status: "completed" as const,
      done: 1,
      total: 1,
      stress: false,
      crisis: null,
      stale: false,
      inputsStale: false,
      createdAt: "",
    };
    const b = { ...sampleBoard(), source: "api" as const, base };
    expect(recomputeState(sampleBoard())).toBe("aktuell");
    expect(recomputeState({ ...b, run: null })).toBe("fehlt");
    expect(recomputeState({ ...b, run })).toBe("aktuell");
    expect(recomputeState({ ...b, run: { ...run, inputsStale: true } })).toBe("veraltet");
    expect(recomputeState({ ...b, run: { ...run, status: "running" } })).toBe("laeuft");
  });
});

describe("Sichtbarkeit im Ruhezustand", () => {
  it("Einblendungen enden deckend und entfallen bei reduzierter Bewegung", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/aec/aec.css`, "utf8");
    // aec-rise endet ohne opacity (Standard 1); die Animation nutzt fill-mode both.
    const rise = /@keyframes aec-rise\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(rise).toMatch(/to\s*\{\s*opacity: 1;/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.aec-page > \*,\s*\.aec-dcard\s*\{\s*animation: none !important;\s*opacity: 1;/,
    );
  });
});
