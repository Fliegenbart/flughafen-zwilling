/** Die Zusage führt die festgehaltenen Lösungen auf, die Schritt B verspricht. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../../context";
import { mergeWindows } from "../../model/situation";
import { sampleSituation } from "../../sample";
import type { Project, Situation, Variant, VariantBoard } from "../../types";
import NachweisView from "../../views/NachweisView";
import KeptSolutions from "./KeptSolutions";

vi.mock("../../api/overview", () => ({
  getOverview: vi.fn(async () => ({
    source: "api",
    locked: false,
    sha256: null,
    elements: [],
    summary: {},
  })),
}));
vi.mock("../../api/exchange", () => ({
  listExchange: vi.fn(async () => []),
  proposeTest: vi.fn(),
}));

const project = { id: "p1", name: "HAM", source: "api", gridLimitKw: 3500 } as Project;
const run = (
  patch: Partial<NonNullable<VariantBoard["run"]>> = {},
): NonNullable<VariantBoard["run"]> => ({
  status: "completed",
  done: 2,
  total: 2,
  stress: false,
  crisis: null,
  stale: false,
  inputsStale: false,
  createdAt: "",
  ...patch,
});
const variant = (patch: Partial<Variant>): Variant => ({
  id: "base",
  name: "Heute",
  kind: "basis",
  onTimePct: 84,
  minutesAtLimit: 184,
  gridEnergyMwh: 40,
  peakKw: 3500,
  evidence: "model_checked",
  source: "api",
  delayedDepartures: 33,
  departuresTotal: 205,
  missingKw: 1100,
  bottleneck: "energy",
  ...patch,
});
const battery = { id: "v1", name: "Batterie 2 MWh", changes: { storage_kwh: 2000 } };
const board = (patch: Partial<VariantBoard> = {}): VariantBoard => ({
  source: "api",
  base: null,
  definitions: [battery],
  run: run(),
  variants: [
    variant({}),
    variant({ id: "v1", name: battery.name, kind: "speicher", onTimePct: 97, deltaOnTimePct: 13 }),
  ],
  answer: {
    status: "ok",
    headline: "„Batterie 2 MWh“ hilft am meisten.",
    details: [],
    bestId: "v1",
  },
  ...patch,
});

/** Die Seite lädt Übersicht und Prüfpunkte nach; erst danach sind alle Updates verbucht. */
async function page(
  b: VariantBoard,
  p: Project = project,
  situation: Situation = sampleSituation(),
) {
  render(
    <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
      <NachweisView
        project={p}
        situation={situation}
        board={b}
        route={{ page: "projekt", projekt: "p1", frage: "nachweis" }}
      />
    </NavContext.Provider>,
  );
  await act(async () => {});
}

const base = (gridLimitKw: number): NonNullable<VariantBoard["base"]> => ({
  source: "coupled_run",
  policy: "uncontrolled",
  gridLimitKw,
  storageKwh: 0,
  fleet: { total: 80, byKind: [], source: null },
});

const section = () =>
  screen.getByRole("heading", { level: 2, name: "Was Sie im Durchrechnen festgehalten haben" })
    .parentElement!.parentElement!;

beforeEach(() => vi.clearAllMocks());

describe("Zusage", () => {
  it("zeigt die festgehaltenen Lösungen mit ihrem Ergebnis", async () => {
    await page(board());
    const s = within(section());
    expect(s.getByText("„Batterie 2 MWh“ hilft am meisten.")).toBeVisible();
    const table = s.getByRole("table");
    expect(within(table).getByRole("row", { name: /Batterie 2 MWh.*97,0\s%/ })).toBeVisible();
    expect(within(table).getByRole("rowheader", { name: /Heutiger Stand/ })).toBeVisible();
    // Eine Lösung mit Zeile steht nicht noch einmal in der Liste darunter.
    expect(s.queryByRole("list")).toBeNull();
    expect(s.queryByText(/Batteriespeicher/)).toBeNull();
  });

  it("nennt, was fehlt, und führt zum Durchrechnen, wenn die Auswahl sich geändert hat", async () => {
    const stale = board({
      run: run({ stale: true }),
      definitions: [
        battery,
        { id: "v2", name: "Mehr Anschluss", changes: { grid_import_limit_kw: 5000 } },
      ],
    });
    await page(stale);
    const s = within(section());
    expect(s.queryByText(/hilft am meisten/)).toBeNull();
    expect(s.getByText(/Sie haben Lösungen hinzugefügt oder entfernt\./)).toBeVisible();
    expect(s.getByRole("link", { name: "Durchrechnen" })).toHaveAttribute("href", "/?projekt=p1");
    // Die Lösung ohne Zeile steht als Name in der Liste, die andere in der Tabelle und nur dort.
    expect(s.getByText(/^Mehr Anschluss \(Netzanschluss 5,00\sMW\)$/)).toBeVisible();
    expect(s.getAllByRole("listitem")).toHaveLength(1);
    expect(s.queryByText(/^Batterie 2 MWh \(/)).toBeNull();
    expect(s.getByRole("table")).toBeVisible();
  });

  it("zeigt nach dem Entfernen der letzten Lösung nichts Altes", async () => {
    await page(board({ definitions: [], run: run({ stale: true }) }));
    const s = within(section());
    expect(s.getByText(/Sie haben noch nichts festgehalten/)).toBeVisible();
    expect(s.getByRole("link", { name: "Durchrechnen" })).toBeVisible();
    expect(s.queryByRole("table")).toBeNull();
    expect(s.queryByText(/hilft am meisten/)).toBeNull();
  });

  it("blendet die Tabelle aus, wenn sich die Daten geändert haben", async () => {
    await page(board({ run: run({ inputsStale: true }) }));
    const s = within(section());
    expect(s.queryByRole("table")).toBeNull();
    expect(s.getByText(/Ihre Werte haben sich seit der letzten Rechnung geändert\./)).toBeVisible();
    expect(s.getByText(/^Batterie 2 MWh \(Batteriespeicher/)).toBeVisible();
  });

  it("blendet die Tabelle auch aus, wenn sich zugleich die Auswahl geändert hat", async () => {
    await page(board({ run: run({ stale: true, inputsStale: true }) }));
    const s = within(section());
    expect(s.queryByRole("table")).toBeNull();
    expect(s.queryByText(/hilft am meisten/)).toBeNull();
    expect(s.getByText(/Ihre Werte haben sich seit der letzten Rechnung geändert\./)).toBeVisible();
    expect(s.getByText(/^Batterie 2 MWh \(Batteriespeicher/)).toBeVisible();
  });

  it("sagt, dass noch gerechnet wird", async () => {
    await page(board({ run: run({ status: "running" }) }));
    const s = within(section());
    expect(s.getByText("Die Rechnung läuft noch.")).toBeVisible();
    expect(s.queryByRole("table")).toBeNull();
  });

  it("sagt im Beispielprojekt, warum nichts festgehalten ist", async () => {
    await page(
      { ...board(), source: "beispiel", definitions: [], variants: [], run: null, answer: null },
      { ...project, source: "beispiel" },
    );
    expect(
      within(section()).getByText("Festhalten geht nur in einem eigenen Projekt."),
    ).toBeVisible();
  });

  it("sagt bei einem eigenen Projekt, dessen Lösungen nicht kamen, nicht, es sei ein Beispiel", async () => {
    await page({
      ...board(),
      source: "beispiel",
      definitions: [],
      variants: [],
      run: null,
      answer: null,
    });
    const s = within(section());
    expect(s.getByText(/Die festgehaltenen Lösungen ließen sich nicht laden\./)).toBeVisible();
    expect(s.queryByText(/nur in einem eigenen Projekt/)).toBeNull();
  });

  it("verspricht keine Abflugzeiten und kommt auch ohne bekannte Anschlussleistung aus", async () => {
    await page(board(), { ...project, gridLimitKw: null });
    expect(screen.queryByText(/Abflugzeiten/)).toBeNull();
    expect(screen.getByText(/denselben Flugplan/)).toBeVisible();
    expect(screen.getByText(/wie viel der Anschluss hergibt/)).toBeVisible();
    expect(screen.getByText("Prüfprotokoll und Detailwerkzeuge (für Fachleute)")).toBeVisible();
  });

  it("beschreibt die Prüfung, statt zu behaupten, jede Lösung habe sie bestanden", async () => {
    await page(board());
    const step = screen.getByRole("heading", {
      name: "Was wir rechnerisch geprüft haben",
    }).nextElementSibling!;
    expect(step).toHaveTextContent(
      /^Wir prüfen bei jeder Rechnung, ob keine Energie verloren geht/,
    );
    expect(step).toHaveTextContent("Eine Lösung, die das nicht besteht, gilt als ausgedacht.");
    expect(step.textContent).not.toMatch(/Strombedarf des Flughafens ist gedeckt/);
  });
});

describe("Anschluss in den Annahmen", () => {
  const noLimit = { ...project, gridLimitKw: null };
  const assumed = () =>
    screen.getByRole("heading", { name: "Was wir angenommen haben" }).nextElementSibling!;

  it("nennt den Anschluss der Rechnung, auch wenn das Projekt ihn nicht kennt", async () => {
    await page(board({ base: base(4200) }), noLimit);
    expect(assumed()).toHaveTextContent(/dass der Anschluss 4,20\sMW hergibt\.$/);
  });

  it("nimmt sonst den Anschluss aus dem Lagebild des Projekts", async () => {
    await page(board(), noLimit, { ...sampleSituation(), source: "api", gridLimitKw: 4300 });
    expect(assumed()).toHaveTextContent(/dass der Anschluss 4,30\sMW hergibt\.$/);
  });

  it("zieht den Anschluss der Rechnung dem des Lagebilds vor", async () => {
    await page(board({ base: base(4200) }), noLimit, {
      ...sampleSituation(),
      source: "api",
      gridLimitKw: 4300,
    });
    expect(assumed()).toHaveTextContent(/4,20\sMW/);
  });

  it("setzt für ein eigenes Projekt nie die Beispielwerte ein", async () => {
    // Das Beispiel-Lagebild und eine Beispiel-Tafel tragen 3500 kW, die zu diesem Projekt nicht gehören.
    await page(board({ source: "beispiel", base: base(3500) }), noLimit, sampleSituation());
    expect(assumed()).toHaveTextContent(/wie viel der Anschluss hergibt\.$/);
    expect(assumed().textContent).not.toMatch(/3,50/);
  });

  it("hält einen unbekannten Anschluss nicht für 0 kW", async () => {
    await page(board({ base: base(0) }), noLimit, {
      ...sampleSituation(),
      source: "api",
      gridLimitKw: 0,
    });
    expect(assumed()).toHaveTextContent(/wie viel der Anschluss hergibt\.$/);
  });

  it("fällt auf den Anschluss des Projekts zurück", async () => {
    await page(board(), project);
    expect(assumed()).toHaveTextContent(/dass der Anschluss 3,50\sMW hergibt\.$/);
  });
});

describe("Zusammenfassung zum Weitergeben", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.restoreAllMocks();
  });

  /** Klickt auf „Zusammenfassung herunterladen“ und liefert den Text der Datei. */
  async function download(b: VariantBoard): Promise<string> {
    let file: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      file = blob;
      return "blob:zusage";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await page(b);
    fireEvent.click(screen.getByRole("button", { name: "Zusammenfassung herunterladen" }));
    return file!.text();
  }

  it("nennt den Satz zu den festgehaltenen Lösungen, solange er zur Auswahl passt", async () => {
    expect(await download(board())).toContain("Was hilft:</b> „Batterie 2 MWh“ hilft am meisten.");
  });

  it("lässt den Satz weg, wenn die Auswahl sich seit der Rechnung geändert hat", async () => {
    const html = await download(board({ run: run({ stale: true }) }));
    expect(html).not.toContain("Was hilft");
    expect(html).not.toContain("hilft am meisten");
  });
});

describe("Knappe Phasen", () => {
  it("fasst nahe Phasen zusammen und behält das größte Defizit", () => {
    const window = (start: number, end: number, deficitKw: number) => ({ start, end, deficitKw });
    expect(
      mergeWindows([window(360, 380, 800), window(390, 420, 500), window(900, 930, 300)]),
    ).toEqual([window(360, 420, 800), window(900, 930, 300)]);
    expect(mergeWindows([window(360, 380, 500), window(390, 420, 800)])).toEqual([
      window(360, 420, 800),
    ]);
  });
});

describe("Liste ohne Zusage-Seite", () => {
  it("beschreibt eine Lösung mit eigenem Namen zusätzlich durch ihre Änderungen", () => {
    render(
      <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
        <KeptSolutions
          projekt="p1"
          board={board({
            variants: [],
            run: null,
            answer: null,
            definitions: [
              { id: "v1", name: "Mein Vorschlag", changes: { grid_import_limit_kw: 4500 } },
            ],
          })}
        />
      </NavContext.Provider>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      /Mein Vorschlag \(Netzanschluss 4,50\sMW\)/,
    );
    expect(screen.getByText(/noch nicht gerechnet/)).toHaveTextContent(
      "Unter Durchrechnen starten Sie die Rechnung.",
    );
  });
});
