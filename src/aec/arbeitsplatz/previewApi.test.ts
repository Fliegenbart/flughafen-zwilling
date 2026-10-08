import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, type ApiError } from "../api/http";
import { getPreview, isDataProblem, previewError } from "../api/preview";
import { fetchVariantBoard, getVariantBoard } from "../api/variants";
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
      "invalid_variant: Fahrzeugklasse pushback_tug ist in der Basis nicht modelliert",
      /^Pushback-Schlepper lassen sich in diesem Projekt nicht ergänzen\.$/,
    ],
    [
      "invalid_variant: Zusaetzliche Fahrzeuge ...",
      /^Diese Einstellung lässt sich nicht rechnen\.$/,
    ],
    ["Failed to fetch", /^Keine Verbindung zum Server\.$/],
    ["Load failed", /^Keine Verbindung zum Server\.$/],
    ["NetworkError when attempting to fetch resource.", /^Keine Verbindung zum Server\.$/],
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

  it("bleibt für die Projektseite bei der Beispiel-Tafel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect((await getVariantBoard(API_PROJECT)).source).toBe("beispiel");
    expect((await fetchVariantBoard(SAMPLE_PROJECT)).source).toBe("beispiel");
  });
});
