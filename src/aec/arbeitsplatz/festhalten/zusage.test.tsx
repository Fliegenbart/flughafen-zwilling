/** Die Zusage führt die festgehaltenen Lösungen auf, die Schritt B verspricht. */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../../context";
import { sampleSituation } from "../../sample";
import type { Project, Variant, VariantBoard } from "../../types";
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

function page(b: VariantBoard, p: Project = project) {
  render(
    <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
      <NachweisView
        project={p}
        situation={sampleSituation()}
        board={b}
        route={{ page: "projekt", projekt: "p1", frage: "nachweis" }}
      />
    </NavContext.Provider>,
  );
}

const section = () =>
  screen.getByRole("heading", { level: 2, name: "Was Sie im Durchrechnen festgehalten haben" })
    .parentElement!.parentElement!;

beforeEach(() => vi.clearAllMocks());

describe("Zusage", () => {
  it("zeigt die festgehaltenen Lösungen mit ihrem Ergebnis", () => {
    page(board());
    const s = within(section());
    expect(s.getByText("„Batterie 2 MWh“ hilft am meisten.")).toBeVisible();
    const table = s.getByRole("table");
    expect(within(table).getByRole("row", { name: /Batterie 2 MWh.*97,0\s%/ })).toBeVisible();
    expect(within(table).getByRole("rowheader", { name: /Heutiger Stand/ })).toBeVisible();
  });

  it("nennt, was fehlt, und führt zum Durchrechnen, wenn die Auswahl sich geändert hat", () => {
    const stale = board({
      run: run({ stale: true }),
      definitions: [
        battery,
        { id: "v2", name: "Mehr Anschluss", changes: { grid_import_limit_kw: 5000 } },
      ],
    });
    page(stale);
    const s = within(section());
    expect(s.queryByText(/hilft am meisten/)).toBeNull();
    expect(s.getByText(/Die Auswahl hat sich geändert\./)).toBeVisible();
    expect(s.getByRole("link", { name: "Durchrechnen" })).toHaveAttribute("href", "/?projekt=p1");
    // Die Lösung ohne Zeile steht als Name in der Liste, die andere in der Tabelle.
    expect(s.getByText(/^Mehr Anschluss \(Netzanschluss 5,00\sMW\)$/)).toBeVisible();
    expect(s.getByRole("table")).toBeVisible();
  });

  it("zeigt nach dem Entfernen der letzten Lösung nichts Altes", () => {
    page(board({ definitions: [], run: run({ stale: true }) }));
    const s = within(section());
    expect(s.getByText(/Sie haben noch nichts festgehalten/)).toBeVisible();
    expect(s.getByRole("link", { name: "Durchrechnen" })).toBeVisible();
    expect(s.queryByRole("table")).toBeNull();
    expect(s.queryByText(/hilft am meisten/)).toBeNull();
  });

  it("blendet die Tabelle aus, wenn sich die Daten geändert haben", () => {
    page(board({ run: run({ inputsStale: true }) }));
    const s = within(section());
    expect(s.queryByRole("table")).toBeNull();
    expect(s.getByText(/Ihre Daten haben sich seit der Berechnung geändert\./)).toBeVisible();
    expect(s.getByText(/^Batterie 2 MWh \(Batteriespeicher/)).toBeVisible();
  });

  it("sagt, dass noch gerechnet wird", () => {
    page(board({ run: run({ status: "running" }) }));
    const s = within(section());
    expect(s.getByText("Die Berechnung läuft noch.")).toBeVisible();
    expect(s.queryByRole("table")).toBeNull();
  });

  it("sagt im Beispielprojekt, warum nichts festgehalten ist", () => {
    page({
      ...board(),
      source: "beispiel",
      definitions: [],
      variants: [],
      run: null,
      answer: null,
    });
    expect(
      within(section()).getByText("Festhalten geht nur in einem eigenen Projekt."),
    ).toBeVisible();
  });

  it("verspricht keine Abflugzeiten und kommt auch ohne bekannte Anschlussleistung aus", () => {
    page(board(), { ...project, gridLimitKw: null });
    expect(screen.queryByText(/Abflugzeiten/)).toBeNull();
    expect(screen.getByText(/demselben Flugplan/)).toBeVisible();
    expect(screen.getByText(/wie viel der Anschluss hergibt/)).toBeVisible();
    expect(screen.getByText("Prüfprotokoll und Detailwerkzeuge (für Fachleute)")).toBeVisible();
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
    expect(screen.getByText(/noch nicht gerechnet/)).toBeVisible();
  });
});
