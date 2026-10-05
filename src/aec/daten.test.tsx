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
      "Noch keine der 4 Datenquellen ist echt. Es fehlen der offizielle Flugplan, Angaben zu Flotte und Anlagen sowie Messdaten vom Flughafen und aus dem Lab.",
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
      "2 von 4 Datenquellen sind echt. Es fehlen Messdaten vom Flughafen und aus dem Lab.",
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
    expect(fp!.warnings[0]).toMatch(/3 ungeklärte Mehrfachgruppen/);
    expect(fl!.state).toBe("annahme");
    expect(s.answer).toMatch(/Flotte und Anlagen steht noch auf Annahmen\./);
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
    expect(s.items[2]!.warnings[0]).toMatch(/abgewiesen.*Doppelter Zeitstempel/);
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
    expect(s.items[2]!.warnings.join(" ")).toMatch(/nicht gesperrt/);
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
    expect(computeDataStatus(full).answer).toBe("Alle 4 Datenquellen sind echt.");
    const sim = computeDataStatus({ ...full, labRuns: [{ ...lab, source: "simulation" }] });
    expect(sim.items[3]!.state).toBe("annahme");
    expect(sim.items[3]!.evidence).toBe("synthetic");
  });

  it("übersetzt Importfehler verständlich", () => {
    expect(importError("invalid_assets: „PV-Leistung“: nur ganze Zahlen.")).toBe(
      "„PV-Leistung“: nur ganze Zahlen.",
    );
    expect(importError("role_forbidden: set project assets requires admin|airport")).toMatch(
      /Ihre Rolle darf/,
    );
    expect(importError("timestamp_timezone_required")).toBe("Zeitstempel benötigen eine Zeitzone.");
    expect(importError("Failed to fetch")).toMatch(/Keine Verbindung/);
    expect(flightPlanError("PDF als application/pdf hochladen")).toBe(
      "Bitte eine PDF-Datei hochladen.",
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
    const meter = await screen.findByRole("link", { name: /^Datenstand: 0 von 4 echt/ });
    fireEvent.click(meter);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Noch keine der 4 Datenquellen/ }),
    ).toBeVisible();
    expect(window.location.search).toContain("frage=daten");
    expect(screen.getByRole("note", { name: "Hinweis zur Demo-Instanz" })).toHaveTextContent(
      /keine Mandantentrennung/,
    );
    expect(
      within(screen.getByRole("list", { name: "Vier Datenquellen" })).getAllByRole("heading"),
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
    expect(await screen.findByRole("heading", { level: 1, name: /Noch keine/ })).toBeVisible();
  });
});
