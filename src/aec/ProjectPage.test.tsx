/**
 * Die Projektseite (Daten, Zusage) mit einem Projekt vom Server: Tafel der festgehaltenen
 * Lösungen laden, bei einem Fehler behalten, und der Knopf im Hinweis „Tag neu rechnen“.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "./context";
import ProjectPage from "./ProjectPage";
import { sampleSituation } from "./sample";
import type { Project, VariantBoard } from "./types";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getSituation: vi.fn(),
  loadDataInputs: vi.fn(),
  fetchVariantBoard: vi.fn(),
  runVariants: vi.fn(),
}));
vi.mock("./api/projects", async (orig) => ({
  ...(await orig<typeof import("./api/projects")>()),
  getProject: mocks.getProject,
}));
vi.mock("./api/situation", async (orig) => ({
  ...(await orig<typeof import("./api/situation")>()),
  getSituation: mocks.getSituation,
}));
vi.mock("./api/data", async (orig) => ({
  ...(await orig<typeof import("./api/data")>()),
  loadDataInputs: mocks.loadDataInputs,
}));
vi.mock("./api/variants", async (orig) => ({
  ...(await orig<typeof import("./api/variants")>()),
  fetchVariantBoard: mocks.fetchVariantBoard,
  runVariants: mocks.runVariants,
}));
vi.mock("./api/overview", () => ({
  getOverview: vi.fn(async () => ({
    source: "api",
    locked: false,
    sha256: null,
    elements: [],
    summary: {},
  })),
}));
vi.mock("./api/exchange", () => ({
  listExchange: vi.fn(async () => []),
  proposeTest: vi.fn(),
}));

const PROJECT: Project = {
  id: "p1",
  name: "HAM Vorfeld Nord",
  airport: "Hamburg",
  site: "Vorfeld Nord",
  dayLabel: "Ihr gerechneter Tag",
  fleetSize: 0,
  gridLimitKw: null,
  decision: "",
  source: "api",
};
const battery = { id: "v1", name: "Batterie 2 MWh", changes: { storage_kwh: 2000 } };
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
const board = (patch: Partial<VariantBoard> = {}): VariantBoard => ({
  source: "api",
  base: {
    source: "x",
    policy: "uncontrolled",
    gridLimitKw: 3500,
    storageKwh: 0,
    fleet: { total: 101, byKind: [], source: null },
  },
  definitions: [battery],
  run: run(),
  variants: [],
  answer: null,
  ...patch,
});
/** Die Tafel nach geänderten Projektwerten: Es gilt nur noch der Lauf von früher. */
const stale = (patch: Partial<VariantBoard> = {}) =>
  board({ run: run({ inputsStale: true }), ...patch });

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function open() {
  render(
    <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
      <ProjectPage route={{ page: "projekt", projekt: "p1", frage: "nachweis" }} />
    </NavContext.Provider>,
  );
  await tick(0);
}
const section = () =>
  screen.getByRole("heading", { level: 2, name: "Was Sie im Durchrechnen festgehalten haben" })
    .parentElement!.parentElement!;
const banner = () => document.querySelector(".aec-recompute");

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getProject.mockReset().mockResolvedValue(PROJECT);
  mocks.getSituation.mockReset().mockResolvedValue({ ...sampleSituation(), source: "api" });
  mocks.loadDataInputs.mockReset().mockRejectedValue(new Error("aus"));
  mocks.fetchVariantBoard.mockReset().mockResolvedValue(board());
  mocks.runVariants.mockReset().mockResolvedValue(board({ run: run({ status: "queued" }) }));
});
afterEach(() => vi.useRealTimers());

describe("Hinweis „Tag neu rechnen“", () => {
  it("rechnet mit festgehaltenen Lösungen alle neu, damit die Zusage ihre Ergebnisse behält", async () => {
    mocks.fetchVariantBoard.mockResolvedValue(stale());
    await open();
    expect(banner()).toHaveTextContent("veraltet");
    fireEvent.click(within(banner() as HTMLElement).getByRole("button"));
    await tick(0);
    // Kein Lauf nur für heute: Der würde die Ergebnisse der Lösungen verwerfen.
    expect(mocks.runVariants).toHaveBeenCalledTimes(1);
    expect(mocks.runVariants).toHaveBeenCalledWith(PROJECT, false, false, null);
  });

  it("nennt den Knopf nach den Lösungen, die mitrechnen", async () => {
    mocks.fetchVariantBoard.mockResolvedValue(stale());
    await open();
    expect(within(banner() as HTMLElement).getByRole("button")).toHaveTextContent(
      "Tag und Lösungen neu rechnen",
    );
  });

  it("behält Krisenfall und Stress des letzten Laufs", async () => {
    const crisis = { id: "airport_case_03_wetter_kompression_v1", name: "Wetter", assumption: "" };
    mocks.fetchVariantBoard.mockResolvedValue(
      board({ run: run({ inputsStale: true, stress: true, crisis }) }),
    );
    await open();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button"));
    await tick(0);
    expect(mocks.runVariants).toHaveBeenCalledWith(PROJECT, true, false, crisis.id);
  });

  it("rechnet ohne festgehaltene Lösungen nur den Tag", async () => {
    mocks.fetchVariantBoard.mockResolvedValue(stale({ definitions: [] }));
    await open();
    const button = within(banner() as HTMLElement).getByRole("button");
    expect(button).toHaveTextContent("Tag neu rechnen");
    fireEvent.click(button);
    await tick(0);
    expect(mocks.runVariants).toHaveBeenCalledWith(PROJECT, false, true);
  });

  it("holt danach die Tafel neu und sagt, dass auch die Lösungen rechnen", async () => {
    mocks.fetchVariantBoard.mockResolvedValue(stale());
    await open();
    mocks.fetchVariantBoard.mockResolvedValue(board({ run: run({ status: "running", done: 1 }) }));
    fireEvent.click(within(banner() as HTMLElement).getByRole("button"));
    await tick(0);
    expect(banner()).toHaveTextContent(
      "Wir rechnen den Tag und Ihre Lösungen mit Ihren Werten neu",
    );
    expect(within(banner() as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("meldet, wenn sich die Rechnung nicht starten ließ", async () => {
    mocks.fetchVariantBoard.mockResolvedValue(stale());
    mocks.runVariants.mockRejectedValue(new Error("Keine Verbindung zum Server."));
    await open();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button"));
    await tick(0);
    expect(within(banner() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Keine Verbindung zum Server.",
    );
  });
});

describe("Tafel bei Verbindungsproblemen", () => {
  it("zeigt bei einem eigenen Projekt nie, Festhalten gehe nur im eigenen Projekt", async () => {
    mocks.fetchVariantBoard.mockRejectedValue(new Error("Keine Verbindung zum Server."));
    await open();
    const text = section().textContent;
    expect(text).not.toMatch(/nur in einem eigenen Projekt/);
    expect(text).toMatch(/ließen sich nicht laden/);
  });

  it("holt die Tafel nach, sobald der Server wieder antwortet", async () => {
    mocks.fetchVariantBoard
      .mockRejectedValueOnce(new Error("Keine Verbindung zum Server."))
      .mockResolvedValue(board());
    await open();
    expect(section().textContent).toMatch(/ließen sich nicht laden/);
    await tick(1500);
    expect(section().textContent).not.toMatch(/ließen sich nicht laden/);
    expect(within(section()).getByText(/^Batterie 2 MWh \(/)).toBeVisible();
  });

  it("behält die Tafel und fragt weiter, wenn eine Abfrage während der Rechnung scheitert", async () => {
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board({ run: run({ status: "running", done: 1 }) }))
      .mockRejectedValueOnce(new Error("Keine Verbindung zum Server."))
      .mockResolvedValue(board({ run: run({ status: "completed", done: 2 }) }));
    await open();
    expect(banner()).toHaveTextContent("Wir rechnen den Tag und Ihre Lösungen");
    await tick(1500);
    // Die Tafel steht noch, der Hinweis sagt, dass der Stand veraltet sein kann.
    expect(within(section()).getByText(/^Batterie 2 MWh \(/)).toBeVisible();
    expect(section().textContent).not.toMatch(/nur in einem eigenen Projekt/);
    expect(banner()).toHaveTextContent("Wir rechnen den Tag und Ihre Lösungen");
    expect(banner()).toHaveTextContent("Die Verbindung zum Server ist unterbrochen");
    await tick(1500);
    expect(banner()).toBeNull();
    expect(mocks.fetchVariantBoard).toHaveBeenCalledTimes(3);
  });

  it("holt das Lagebild neu, wenn die Rechnung fertig ist", async () => {
    mocks.fetchVariantBoard
      .mockResolvedValueOnce(board({ run: run({ status: "running", done: 1 }) }))
      .mockResolvedValue(board());
    await open();
    expect(mocks.getSituation).toHaveBeenCalledTimes(1);
    await tick(1500);
    expect(mocks.getSituation).toHaveBeenCalledTimes(2);
  });
});
