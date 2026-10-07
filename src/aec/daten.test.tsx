import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "./AirportEnergyCheck";
import {
  computeDataStatus,
  EMPTY_INPUTS,
  importError,
  isExampleFile,
  needsDataStep,
  type DataInputs,
} from "./dataStatus";
import { assetsFromApi, importFromApi } from "./dataApi";
import { parseRoute, toSearch } from "./routes";
import { SAMPLE_PROJECT } from "./sample";
import { flightPlanError } from "./views/DatenView";
import { distributeFleet } from "./dataStatus";
import { recomputeState } from "./ProjectPage";
import { sampleBoard } from "./api";

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
    expect(s.answer).toBe(
      "Noch ist keine der 4 Datenquellen belegt. Wir rechnen mit Annahmen. Es fehlen der offizielle Flugplan, Angaben zu Fahrzeugen und Anlagen sowie Messungen vom Flughafen und aus dem Testing-Lab.",
    );
    expect(needsDataStep(s)).toBe(true);
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
    expect(needsDataStep(s)).toBe(false);
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
    expect(fp!.warnings[0]).toMatch(/3 Flüge stehen womöglich mehrfach drin/);
    expect(fl!.state).toBe("annahme");
    expect(s.answer).toMatch(/Noch mit Annahmen gerechnet: Fahrzeuge und Anlagen\./);
    expect(needsDataStep(s)).toBe(true);
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
    expect(s.items[2]!.warnings.join(" ")).toMatch(/noch keine festgelegten Grenzen/);
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
    expect(computeDataStatus(full).answer).toBe("Alle 4 Datenquellen sind mit Quelle belegt.");
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
    expect(flightPlanError("PDF als application/pdf hochladen")).toBe(
      "Bitte laden Sie ein PDF hoch.",
    );
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
      page: "projekt",
      projekt: "p1",
      frage: "lage",
      auto: true,
    });
    expect(toSearch(parseRoute("?projekt=p1"))).toBe("?projekt=p1");
    expect(parseRoute("?projekt=p1&frage=daten")).toEqual({
      page: "projekt",
      projekt: "p1",
      frage: "daten",
    });
  });

  it("zeigt Datenstand im Kopf, Schild 0 und Warnhinweis im Daten-Schritt", async () => {
    window.history.replaceState(null, "", `/?projekt=${SAMPLE_PROJECT.id}&frage=lage`);
    render(<AirportEnergyCheck basePath="/" />);
    const meter = await screen.findByRole("link", { name: /^0 von 4 Datenquellen belegt/ });
    fireEvent.click(meter);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Noch ist keine der 4 Datenquellen/ }),
    ).toBeVisible();
    expect(window.location.search).toContain("frage=daten");
    expect(screen.getByRole("note", { name: "Hinweis zur Demo-Instanz" })).toHaveTextContent(
      /keine echten Kundendaten/,
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
    expect(await screen.findByRole("heading", { level: 1, name: /Noch ist keine/ })).toBeVisible();
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
