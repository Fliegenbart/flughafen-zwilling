/**
 * Durchrechnen mit einem Projekt vom Server: die Module unter `api/` sind gemockt, die Oberflaeche
 * und die Hooks laufen echt. Das Beispielprojekt (arbeitsplatz.test.tsx) prueft nur die Naeherung.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext, type Nav } from "../context";
import type { Preview, PreviewBody } from "../api/preview";
import { EMPTY_INPUTS, type DataInputs } from "../model/dataStatus";
import type { Route } from "../routes";
import { SAMPLE_PROJECT, samplePreview } from "../sample";
import { SCENARIO_CASES } from "../scenarios";
import type { Project } from "../types";
import Arbeitsplatz from "./Arbeitsplatz";
import { useLiveScenario } from "./useLiveScenario";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  loadDataInputs: vi.fn(),
  getPreview: vi.fn(),
  fetchVariantBoard: vi.fn(),
}));
vi.mock("../api/projects", async (orig) => ({
  ...(await orig<typeof import("../api/projects")>()),
  getProject: mocks.getProject,
}));
vi.mock("../api/data", async (orig) => ({
  ...(await orig<typeof import("../api/data")>()),
  loadDataInputs: mocks.loadDataInputs,
}));
vi.mock("../api/preview", async (orig) => ({
  ...(await orig<typeof import("../api/preview")>()),
  getPreview: mocks.getPreview,
}));
vi.mock("../api/variants", async (orig) => {
  const actual = await orig<typeof import("../api/variants")>();
  return {
    ...actual,
    fetchVariantBoard: mocks.fetchVariantBoard.mockImplementation(
      async () => actual.boardFromApi({ variants: [], base: {} })!,
    ),
  };
});

type ArbeitsplatzRoute = Extract<Route, { page: "arbeitsplatz" }>;

const API_PROJECT: Project = {
  ...SAMPLE_PROJECT,
  id: "p1",
  name: "HAM Vorfeld Nord",
  source: "api",
};
const PLAN = {
  snapshotId: "s1",
  serviceDate: "2026-10-03",
  sourceDataDate: "2026-09-01",
  importedAt: "2026-09-02T10:00:00Z",
  sharedGroups: 0,
  departures: 205,
  arrivals: 200,
};
const WITH_PLAN: DataInputs = { ...EMPTY_INPUTS, available: true, plans: [PLAN] };
const NO_PLAN: DataInputs = { ...EMPTY_INPUTS, available: true };

const today: Preview = samplePreview();
const exact = (over: Partial<Preview> = {}): Preview => ({
  ...today,
  delayedDepartures: 20,
  computeMs: 12,
  policy: "mission_priority",
  ...over,
});
const withGrid = (kw: number): Preview => ({
  ...today,
  basis: { ...today.basis, power: { ...today.basis.power, gridImportLimitKw: kw } },
});

/** Antwort der Vorschau: ohne Aenderung der heutige Tag, sonst die genaue Rechnung. */
const serve = (answer: Preview = exact()) =>
  mocks.getPreview.mockImplementation(async (_p: Project, body: PreviewBody) =>
    Object.keys(body).length ? answer : today,
  );
const bodies = () => mocks.getPreview.mock.calls.map((c) => c[1] as PreviewBody);

function renderAt(route: ArbeitsplatzRoute, navigate = vi.fn()) {
  const nav: Nav = { basePath: "/", route, navigate };
  const ui = (
    <NavContext.Provider value={nav}>
      <Arbeitsplatz route={route} />
    </NavContext.Provider>
  );
  return { navigate, ...render(ui) };
}
const OPEN: ArbeitsplatzRoute = { page: "arbeitsplatz", projekt: "p1" };

const row = (name: string | RegExp) =>
  within(screen.getByRole("table")).getByRole("rowheader", { name }).closest("tr")!;
const cells = (name: string | RegExp) =>
  within(row(name))
    .getAllByRole("cell")
    .map((c) => visibleText(c).replace(/\s/g, " "));

/** Text einer Zelle ohne die Worte, die nur Screenreader hoeren. */
function visibleText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".aec-visually-hidden").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

const LATE = /nicht rechtzeitig/;
const lead = () => document.querySelector(".ap-handout__lead")?.textContent;
/** Zustand der Rechnung, wie ihn der Vergleich anzeigt: naeherung oder genau. */
const accuracy = () => document.querySelector(".ap-accuracy")?.getAttribute("data-accuracy");
const settled = () => waitFor(() => expect(accuracy()).toBe("genau"));

beforeEach(() => {
  mocks.getProject.mockReset().mockResolvedValue(API_PROJECT);
  mocks.loadDataInputs.mockReset().mockResolvedValue(WITH_PLAN);
  mocks.getPreview.mockReset();
  serve();
});
afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Durchrechnen mit Projekt vom Server", () => {
  it("zählt eine geänderte Laderegel allein als Änderung und merkt sie", async () => {
    const first = renderAt(OPEN);
    await screen.findByRole("table");
    expect(cells(LATE)).toEqual(["33 von 205", "–"]);
    const leadToday = lead();
    fireEvent.change(screen.getByRole("combobox", { name: "Laderegel" }), {
      target: { value: "mission_priority" },
    });
    await settled();
    expect(cells(LATE)).toEqual(["33 von 205", "20 von 205"]);
    expect(bodies()[1]).toEqual({ charging_policy: "mission_priority" });
    // Das Blatt zum Hinterlassen spricht nicht mehr vom Stand heute.
    expect(lead()).not.toBe(leadToday);
    expect(JSON.parse(sessionStorage.getItem("aec.regler.p1")!)).toEqual({
      policy: "mission_priority",
    });

    // Nach einem Wechsel zu Daten und zurück steht die Laderegel noch da.
    first.unmount();
    mocks.getPreview.mockClear();
    renderAt(OPEN);
    await screen.findByRole("table");
    expect(screen.getByRole("combobox", { name: "Laderegel" })).toHaveValue("mission_priority");
    await waitFor(() => expect(bodies()).toContainEqual({ charging_policy: "mission_priority" }));
  });

  it("lässt unberührte Regler dem Projektwert folgen, den man in Daten korrigiert hat", async () => {
    // Zuletzt war nur die Batterie bewegt; inzwischen steht der Netzanschluss auf 5 MW.
    sessionStorage.setItem("aec.regler.p1", JSON.stringify({ batteryKwh: 2000, batteryKw: 1000 }));
    mocks.getPreview.mockImplementation(async (_p: Project, body: PreviewBody) =>
      Object.keys(body).length ? exact() : withGrid(5000),
    );
    renderAt(OPEN);
    await screen.findByRole("table");
    const [grid, battery] = screen.getAllByRole("slider");
    expect(grid).toHaveValue("5000");
    expect(battery).toHaveValue("2000");
    expect(screen.getByText(/heute 5,00\sMW/)).toBeInTheDocument();
    await waitFor(() => expect(bodies()).toContainEqual({ storage_kwh: 2000, storage_kw: 1000 }));
  });

  it("bringt gemerkte Werte auf die Schienen von heute", async () => {
    // Ein Speicher von heute lässt sich nicht auf „keiner“ stellen.
    const withBattery: Preview = {
      ...today,
      basis: {
        ...today.basis,
        power: { ...today.basis.power, batteryCapacityKwh: 2000, batteryPowerKw: 1000 },
      },
    };
    sessionStorage.setItem("aec.regler.p1", JSON.stringify({ batteryKwh: 0, gridLimitKw: 90000 }));
    mocks.getPreview.mockImplementation(async (_p: Project, body: PreviewBody) =>
      Object.keys(body).length ? exact() : withBattery,
    );
    renderAt(OPEN);
    await screen.findByRole("table");
    const [grid, battery] = screen.getAllByRole("slider");
    expect(battery).toHaveValue("250");
    expect(Number((grid as HTMLInputElement).value)).toBeLessThan(90000);
    await waitFor(() => expect(bodies().some((b) => b.storage_kwh === 250)).toBe(true));
  });

  it("reicht einen Krisenfall aus der Adresse an die genaue Rechnung und nennt die Annahme", async () => {
    const krise = SCENARIO_CASES[0]!;
    serve(
      exact({
        crisis: { id: krise.scenarioId, name: krise.name, assumption: "Nur halber Anschluss." },
      }),
    );
    renderAt({ ...OPEN, krise: krise.slug });
    await screen.findByRole("table");
    await waitFor(() => expect(bodies()).toContainEqual({ crisis: krise.scenarioId }));
    expect(screen.getByRole("combobox", { name: /Krisenfall durchspielen/ })).toHaveValue(
      krise.scenarioId,
    );
    await settled();
    expect(document.body).toHaveTextContent("Nur halber Anschluss.");
  });

  it("zeigt die genauen Zeilen und markiert, was besser wurde", async () => {
    serve(exact({ energyWaitSharePct: 60, backgroundUnservedKwh: 120 }));
    renderAt(OPEN);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Laderegel" }), {
      target: { value: "mission_priority" },
    });
    await settled();
    expect(cells(/Wartezeit|bremst/)).toEqual([
      "–",
      expect.stringMatching(/^60 % Strom, 40 % Fahrzeuge$/),
    ]);
    expect(cells(/übrig/i)[1]).toMatch(/^120 kWh$/);
    expect(row(LATE)).toHaveAttribute("data-better");
    // Besser oder schlechter steht auch als Wort da, nicht nur als Farbe.
    expect(row(LATE)).toHaveTextContent("besser als heute");
    expect(row(/übrig/i)).toHaveTextContent("schlechter als heute");
  });

  describe("rote Abflugbalken", () => {
    const late = () => document.querySelectorAll(".ap-chart__late").length;

    it("bleiben von heute stehen, solange die genaue Rechnung läuft, und kommen danach von ihr", async () => {
      let answer: (p: Preview) => void = () => undefined;
      mocks.getPreview.mockImplementation((_p: Project, body: PreviewBody) =>
        Object.keys(body).length
          ? new Promise<Preview>((resolve) => (answer = resolve))
          : Promise.resolve(today),
      );
      renderAt(OPEN);
      await screen.findByRole("table");
      const before = late();
      expect(before).toBeGreaterThan(0);
      fireEvent.change(screen.getAllByRole("slider")[0]!, { target: { value: "6000" } });
      await waitFor(() => expect(mocks.getPreview).toHaveBeenCalledTimes(2));
      expect(late()).toBe(before);
      await act(async () => {
        answer({ ...exact(), departures: today.departures.map((d) => ({ ...d, delayed: 0 })) });
      });
      await settled();
      expect(late()).toBe(0);
    });

    it("fallen weg, wenn die genaue Rechnung nicht kommt", async () => {
      mocks.getPreview.mockImplementation(async (_p: Project, body: PreviewBody) => {
        if (Object.keys(body).length) throw new Error("Keine Verbindung zum Server.");
        return today;
      });
      renderAt(OPEN);
      await screen.findByRole("table");
      expect(late()).toBeGreaterThan(0);
      fireEvent.change(screen.getAllByRole("slider")[0]!, { target: { value: "6000" } });
      await screen.findByRole("alert");
      expect(late()).toBe(0);
    });
  });

  describe("Weiterleitung bei der nackten Adresse", () => {
    it("führt ohne Flugplan zu den Daten und rechnet nichts", async () => {
      mocks.loadDataInputs.mockResolvedValue(NO_PLAN);
      const { navigate } = renderAt({ ...OPEN, auto: true });
      expect(screen.getByRole("status")).toHaveTextContent("Projekt wird geöffnet …");
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(
          { page: "projekt", projekt: "p1", frage: "daten" },
          { replace: true },
        ),
      );
      expect(mocks.getPreview).not.toHaveBeenCalled();
    });

    it("bleibt mit Flugplan auf der Seite", async () => {
      const { navigate } = renderAt({ ...OPEN, auto: true });
      await screen.findByRole("table");
      expect(navigate).not.toHaveBeenCalled();
      expect(mocks.getPreview).toHaveBeenCalled();
    });

    it("bleibt über die Schrittleiste auf der Seite und meldet den fehlenden Flugplan einmal", async () => {
      mocks.loadDataInputs.mockResolvedValue(NO_PLAN);
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 409,
            json: () => Promise.resolve({ detail: "no_base: Projekt braucht einen Lauf" }),
          } as Response),
        ),
      );
      const real = await vi.importActual<typeof import("../api/preview")>("../api/preview");
      mocks.getPreview.mockImplementation(real.getPreview);
      const { navigate } = renderAt(OPEN);
      const alert = await screen.findByRole("alert");
      expect(navigate).not.toHaveBeenCalled();
      expect(alert).toHaveTextContent("Der Tag lässt sich ohne Flugplan nicht rechnen.");
      expect(alert.textContent?.match(/Flugplan/g)).toHaveLength(1);
      expect(within(alert).getByRole("link", { name: "Zu den Daten" })).toHaveAttribute(
        "href",
        "/?projekt=p1&frage=daten",
      );
    });
  });

  describe("Fehlermeldungen", () => {
    const stubFetch = (response: () => Promise<Partial<Response>>) =>
      vi.stubGlobal("fetch", vi.fn(response));
    const useRealPreview = async () => {
      const real = await vi.importActual<typeof import("../api/preview")>("../api/preview");
      mocks.getPreview.mockImplementation(real.getPreview);
    };

    it("nennt bei fehlender Verbindung die Verbindung und bietet keinen Weg zu den Daten an", async () => {
      stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
      await useRealPreview();
      renderAt(OPEN);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/^Keine Verbindung zum Server\.$/);
      expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
    });

    it("übersetzt Serverfehler ohne Text", async () => {
      stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error("kein JSON")),
        }),
      );
      await useRealPreview();
      renderAt(OPEN);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /^Der Server konnte nicht rechnen\.$/,
      );
    });

    it("erklärt widersprüchliche Projektwerte ohne Maschinenwörter und führt zu den Daten", async () => {
      stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              detail: "invalid_assets: Projektwerte passen nicht zur Basis: Netzanschluss zu klein",
            }),
        }),
      );
      await useRealPreview();
      renderAt(OPEN);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Ihre Projektwerte passen nicht zusammen (Netzanschluss zu klein). Korrigieren Sie sie unter „Daten“.",
      );
      expect(alert).not.toHaveTextContent(/Basis|invalid_/);
      expect(within(alert).getByRole("link", { name: "Zu den Daten" })).toBeInTheDocument();
    });

    it("zeigt einen Fehler der genauen Rechnung unter der Tabelle und nimmt ihn beim Zurücksetzen weg", async () => {
      mocks.getPreview.mockImplementation(async (_p: Project, body: PreviewBody) => {
        if (Object.keys(body).length) throw new Error("Der Rechner ist gerade belegt.");
        return today;
      });
      renderAt(OPEN);
      await screen.findByRole("table");
      fireEvent.click(screen.getByRole("button", { name: "Wer zuerst los muss, lädt zuerst" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Der Rechner ist gerade belegt.");
      // Das Vergleichsfeld sagt nicht mehr, dass die Rechnung noch läuft.
      expect(accuracy()).toBe("fehler");
      fireEvent.click(screen.getByRole("button", { name: "Auf heute zurücksetzen" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(accuracy()).toBe("genau");
    });
  });
});

describe("useLiveScenario mit Server", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  /** Schreibt jede Anfrage mit; die Antwort liefert der Test selbst. */
  function track() {
    const calls: { body: PreviewBody; answer: ReturnType<typeof deferred<Preview>> }[] = [];
    mocks.getPreview.mockImplementation((_p: Project, body: PreviewBody) => {
      if (!Object.keys(body).length) return Promise.resolve(today);
      const answer = deferred<Preview>();
      calls.push({ body, answer });
      return answer.promise;
    });
    return calls;
  }

  beforeEach(() => vi.useFakeTimers());

  it("wartet nach der Pause 280 ms und schickt nur die neueste Stellung", async () => {
    const calls = track();
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    const base = result.current.todayLevers!;
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4000 }));
    await tick(200);
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4500 }));
    await tick(279);
    expect(calls).toHaveLength(0);
    await tick(1);
    expect(calls.map((c) => c.body)).toEqual([{ grid_import_limit_kw: 4500 }]);
  });

  it("hält höchstens eine Anfrage offen und verwirft die Antwort auf eine veraltete", async () => {
    const calls = track();
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    const base = result.current.todayLevers!;
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4000 }));
    await tick(280);
    expect(calls).toHaveLength(1);

    // Während die erste noch rechnet, zieht der Nutzer weiter.
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4500 }));
    act(() => result.current.setLevers({ ...base, gridLimitKw: 5000 }));
    await tick(5000);
    expect(calls).toHaveLength(1);

    // Die Antwort auf die erste passt nicht mehr zur Stellung.
    await act(async () => calls[0]!.answer.resolve(exact()));
    await tick(0);
    expect(result.current.exact).toBeNull();
    expect(result.current.accuracy).toBe("naeherung");
    expect(calls.map((c) => c.body)).toEqual([
      { grid_import_limit_kw: 4000 },
      { grid_import_limit_kw: 5000 },
    ]);

    const newest = exact({ delayedDepartures: 7 });
    await act(async () => calls[1]!.answer.resolve(newest));
    expect(result.current.exact).toBe(newest);
    expect(result.current.accuracy).toBe("genau");
  });

  it("rechnet nach einem Zurücksetzen nicht mehr mit der laufenden Anfrage", async () => {
    const calls = track();
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    act(() => result.current.setLevers({ ...result.current.todayLevers!, gridLimitKw: 4000 }));
    await tick(280);
    act(() => result.current.reset());
    await act(async () => calls[0]!.answer.resolve(exact()));
    expect(result.current.exact).toBe(today);
    expect(result.current.levers).toEqual(result.current.todayLevers);
  });

  it("meldet einen Fehler und räumt ihn bei der nächsten Anfrage auf", async () => {
    const calls = track();
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    const base = result.current.todayLevers!;
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4000 }));
    await tick(280);
    await act(async () => calls[0]!.answer.reject(new Error("Keine Verbindung zum Server.")));
    expect(result.current.error).toBe("Keine Verbindung zum Server.");
    expect(result.current.accuracy).toBe("naeherung");
    act(() => result.current.setLevers({ ...base, gridLimitKw: 4500 }));
    expect(result.current.error).toBe("");
  });

  it("räumt den Fehler beim Zurücksetzen auf", async () => {
    const calls = track();
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    act(() => result.current.setLevers({ ...result.current.todayLevers!, gridLimitKw: 4000 }));
    await tick(280);
    await act(async () => calls[0]!.answer.reject(new Error("Der Rechner ist gerade belegt.")));
    expect(result.current.error).not.toBe("");
    act(() => result.current.reset());
    expect(result.current.error).toBe("");
    expect(result.current.accuracy).toBe("genau");
  });

  it("meldet beim ersten Laden, ob der Fehler an den Daten liegt", async () => {
    const real = await vi.importActual<typeof import("../api/preview")>("../api/preview");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ detail: "no_base: x" }),
        } as Response),
      ),
    );
    mocks.getPreview.mockImplementation(real.getPreview);
    const { result } = renderHook(() => useLiveScenario(API_PROJECT));
    await tick(0);
    expect(result.current.accuracy).toBe("fehler");
    expect(result.current.errorInData).toBe(true);
  });
});
