import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explain, request, type ApiError } from "../api/http";
import {
  getPreview,
  isDataProblem,
  isFleetKind,
  isRetryable,
  previewError,
  previewFromApi,
} from "../api/preview";
import { boardFromApi, fetchVariantBoard } from "../api/variants";
import { SAMPLE_PROJECT } from "../sample";
import type { Project } from "../types";

const API_PROJECT: Project = { ...SAMPLE_PROJECT, id: "p1", source: "api" };

/** Ein fetch, der nie antwortet und nur auf den Abbruch seines Signals reagiert. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const aborted = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        if (init?.signal?.aborted) aborted();
        else init?.signal?.addEventListener("abort", aborted);
      }),
  );
}

const answer = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () =>
        body === undefined ? Promise.reject(new Error("kein JSON")) : Promise.resolve(body),
    } as Response),
  );

describe("request", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gilt die Zeitgrenze auch, wenn der Aufrufer ein eigenes Signal mitgibt", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const outcome = request(
      "/x",
      { signal: new AbortController().signal },
      { timeoutMs: 300 },
    ).then(
      () => "fertig",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("Der Server antwortet nicht.");
  });

  it("bricht ab, wenn der Aufrufer abbricht, auch vor dem Start", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const caller = new AbortController();
    const running = request("/x", { signal: caller.signal }).catch((e: Error) => e);
    caller.abort();
    expect(await running).toBeInstanceOf(Error);
    const before = new AbortController();
    before.abort();
    await expect(request("/x", { signal: before.signal })).rejects.toThrow();
  });

  it("gibt die Antwort zurück und räumt das Signal des Aufrufers auf", async () => {
    vi.stubGlobal("fetch", answer(200, { ok: true }));
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    await expect(request("/x", { signal: caller.signal })).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each(["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."])(
    "macht aus %s für jeden Bereich denselben deutschen Satz",
    async (browserText) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError(browserText))),
      );
      const own = vi.fn((d: string) => `eigener Satz: ${d}`);
      await expect(request("/x")).rejects.toThrow(/^Keine Verbindung zum Server\.$/);
      await expect(request("/x", undefined, { translate: own })).rejects.toThrow(
        /^Keine Verbindung zum Server\.$/,
      );
      expect(own).not.toHaveBeenCalled();
    },
  );
});

describe("Fehlertexte der Vorschau", () => {
  it.each([
    [
      "no_base: Projekt braucht einen gekoppelten Lauf oder Flugplan-Link",
      /^Der Tag lässt sich ohne Flugplan nicht rechnen\.$/,
    ],
    [
      "invalid_assets: Projektwerte passen nicht zur Basis: Netzanschluss zu klein.",
      /^Ihre Projektwerte passen nicht zusammen \(Netzanschluss zu klein\)\. Korrigieren Sie sie unter „Daten“\.$/,
    ],
    ["Run-Queue voll. Vorschau gleich erneut.", /^Der Rechner ist gerade belegt\.$/],
    [
      "invalid_assets: Projektwerte passen nicht zur Basis: Das Modell rechnet höchstens 300 Fahrzeuge, die Flotte käme auf 305.",
      /^Ihre Projektwerte passen nicht zusammen\. Das Modell rechnet höchstens 300 Fahrzeuge, die Flotte käme auf 305\. Korrigieren Sie sie unter „Daten“\.$/,
    ],
    [
      "invalid_variant: Fahrzeugklasse pushback_tug ist in der Basis nicht modelliert",
      /^Pushback-Schlepper lassen sich in diesem Projekt nicht ergänzen\.$/,
    ],
    [
      "invalid_variant: Zusaetzliche Fahrzeuge ...",
      /^Diese Einstellung lässt sich nicht rechnen\.$/,
    ],
    [
      "invalid_variant: Das Modell rechnet höchstens 200 Fahrzeuge je Art, Busse kämen auf 240.",
      /^Das Modell rechnet höchstens 200 Fahrzeuge je Art, Busse kämen auf 240\.$/,
    ],
    ["API-Fehler 502", /^Der Server konnte nicht rechnen\.$/],
  ])("übersetzt %s", (detail, expected) => {
    const text = previewError(detail);
    expect(text).toMatch(expected);
    expect(text).not.toMatch(/Basis|API|invalid_|Run-Queue/);
  });

  it("lässt Unbekanntes durch die allgemeinen Sätze laufen", () => {
    expect(previewError("irgendwas Neues")).toBe("irgendwas Neues");
    expect(previewError("role_forbidden: x")).toBe("Dieser Schritt ist Sache der anderen Seite.");
  });

  it("sagt für dieselbe Lage überall denselben Satz, ohne Doppelpunkt-Enthüllung", () => {
    const limit = "Das Modell rechnet höchstens 300 Fahrzeuge, die Flotte käme auf 305.";
    expect(explain(`invalid_variant: ${limit}`)).toBe(limit);
    expect(explain("invalid_variant: Fahrzeugklasse gpu ist in der Basis nicht modelliert")).toBe(
      "Diese Lösung lässt sich so nicht rechnen.",
    );
    expect(explain("Run-Queue voll. Vorschau gleich erneut.")).toBe(
      previewError("Run-Queue voll. Vorschau gleich erneut."),
    );
    expect(explain("API-Fehler 500")).toBe("Der Server konnte die Anfrage nicht bearbeiten.");
    expect(explain("Load failed")).toBe("Load failed");
  });

  it("erkennt Fahrzeugarten nur unter ihrem eigenen Namen", () => {
    expect(isFleetKind("pushback_tug")).toBe(true);
    for (const geerbt of ["constructor", "toString", "hasOwnProperty", "__proto__", "rakete", 3])
      expect(isFleetKind(geerbt)).toBe(false);
  });

  it("rät nur zum zweiten Versuch, wenn er helfen kann", () => {
    const withDetail = (detail: string) =>
      Object.assign(new Error("x"), { body: { detail } }) as ApiError;
    expect(isRetryable(new Error("Keine Verbindung zum Server."))).toBe(true);
    expect(isRetryable(withDetail("Run-Queue voll. Vorschau gleich erneut."))).toBe(true);
    expect(isRetryable(withDetail("invalid_variant: Das Modell rechnet höchstens 200"))).toBe(
      false,
    );
    expect(isRetryable(withDetail("no_base: x"))).toBe(false);
    expect(isRetryable(withDetail("invalid_assets: x"))).toBe(false);
  });

  it("erkennt Fehler, die in den Daten des Projekts liegen", () => {
    const withDetail = (detail: string) =>
      Object.assign(new Error("x"), { body: { detail } }) as ApiError;
    expect(isDataProblem(withDetail("no_base: x"))).toBe(true);
    expect(isDataProblem(withDetail("invalid_assets: x"))).toBe(true);
    expect(isDataProblem(withDetail("Run-Queue voll."))).toBe(false);
    expect(isDataProblem(new Error("Failed to fetch"))).toBe(false);
    expect(isDataProblem(null)).toBe(false);
  });

  describe("durch getPreview", () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
      [
        409,
        { detail: "no_base: Projekt braucht einen gekoppelten Lauf" },
        /^Der Tag lässt sich ohne Flugplan nicht rechnen\.$/,
      ],
      [
        429,
        { detail: "Run-Queue voll. Vorschau gleich erneut." },
        /^Der Rechner ist gerade belegt\.$/,
      ],
      [502, undefined, /^Der Server konnte nicht rechnen\.$/],
    ])("%i wird zu einem deutschen Satz", async (status, body, expected) => {
      vi.stubGlobal("fetch", answer(status, body));
      await expect(getPreview(API_PROJECT, {})).rejects.toThrow(expected);
    });

    it("macht aus einem Netzfehler einen deutschen Satz", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
      );
      await expect(getPreview(API_PROJECT, {})).rejects.toThrow("Keine Verbindung zum Server.");
    });
  });
});

describe("Tafel der festgehaltenen Lösungen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("wirft bei einem Fehler, statt zur Beispiel-Tafel zu werden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(fetchVariantBoard(API_PROJECT)).rejects.toThrow();
    vi.stubGlobal("fetch", answer(200, { unerwartet: true }));
    await expect(fetchVariantBoard(API_PROJECT)).rejects.toThrow(/ließen sich nicht lesen/);
  });

  it("kennt für ein Beispielprojekt nur die Beispiel-Tafel", async () => {
    expect((await fetchVariantBoard(SAMPLE_PROJECT)).source).toBe("beispiel");
  });
});

describe("Tafel aus der Antwort des Servers", () => {
  const entry = (key: string, level: string, stress?: Record<string, unknown>) => ({
    key,
    name: key,
    changes: {},
    kpis: { on_time_pct: 90 },
    evidence_level: level,
    ...(stress ? { stress } : {}),
  });
  const board = (entries: unknown[]) =>
    boardFromApi({ variants: [], base: {}, latest_run: { status: "completed", entries } })!;

  it("nimmt die Stufe des Stresslaufs eigens mit, auch wenn der Hauptlauf besser ist", () => {
    const rows = board([
      entry("base", "model_checked", {
        kpis: { on_time_pct: 70 },
        evidence_level: "synthetic",
      }),
      entry("v1", "model_checked", { kpis: { on_time_pct: 80 }, evidence_level: "model_checked" }),
      entry("v2", "model_checked"),
      // Läuft der Stress noch, gibt es keine Zahl und darum auch keine Stufe.
      entry("v3", "model_checked", { kpis: null, evidence_level: "assumption" }),
    ]).variants;
    expect(rows.map((v) => v.evidence)).toEqual(Array(4).fill("model_checked"));
    expect(rows.map((v) => v.stressEvidence)).toEqual(["synthetic", "model_checked", null, null]);
    expect(rows.map((v) => v.stressOnTimePct)).toEqual([70, 80, null, null]);
  });

  it("rechnet eine unbekannte Stufe des Stresslaufs auf das Vorsichtigste zurück", () => {
    const [row] = board([
      entry("base", "model_checked", { kpis: { on_time_pct: 70 }, evidence_level: "neu" }),
    ]).variants;
    expect(row!.stressEvidence).toBe("synthetic");
  });
});

describe("Fahrzeuge je Art in der Vorschau", () => {
  it("liest die Art jeder Klasse aus dem Flottenblock", () => {
    const klass = (kind: unknown, vehicles: number) => ({ kind, vehicles });
    const preview = previewFromApi({
      requested_kw: [0],
      power: {},
      fleet: {
        classes: [klass("bus", 170), klass("gpu", 35), klass("constructor", 9), klass(null, 4)],
        parking: [],
      },
    });
    expect(preview?.vehiclesByKind).toEqual({ bus: 170, gpu: 35 });
  });
});
