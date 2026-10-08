import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../../context";
import type { Levers } from "../../model/livePower";
import type { Project, Variant, VariantBoard } from "../../types";
import { describeChanges } from "./describe";
import Festhalten from "./Festhalten";

const api = vi.hoisted(() => ({
  createVariant: vi.fn<(project: unknown, name: string, changes: unknown) => Promise<void>>(),
  deleteVariant: vi.fn<(project: unknown, id: string) => Promise<void>>(),
  runVariants: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("../../api/variants", () => api);

const project = { id: "p1", name: "HAM", source: "api" } as Project;
const today: Levers = { gridLimitKw: 3500, batteryKwh: 0, pvFactor: 1, policy: "uncontrolled" };
const board = (patch: Partial<VariantBoard> = {}): VariantBoard => ({
  source: "api",
  base: {
    source: "coupled_run",
    policy: "uncontrolled",
    gridLimitKw: 3500,
    storageKwh: 0,
    fleet: { total: 80, byKind: [], source: null },
  },
  definitions: [],
  run: null,
  variants: [],
  answer: null,
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

function view(props: Partial<React.ComponentProps<typeof Festhalten>> = {}) {
  const reload = vi.fn(async () => null);
  render(
    <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
      <Festhalten
        project={project}
        board={board()}
        reload={reload}
        running={false}
        levers={{ ...today, gridLimitKw: 4500, batteryKwh: 2000, batteryKw: 1000 }}
        today={today}
        sample={false}
        {...props}
      />
    </NavContext.Provider>,
  );
  return {
    reload,
    keep: () => screen.getByRole("button", { name: /Einstellung festhalten|Wird/ }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockResolvedValue(undefined);
});

describe("Einstellung festhalten", () => {
  it("legt die Lösung an, rechnet sie nach und lädt die Tafel neu", async () => {
    const { reload, keep } = view();
    fireEvent.click(keep());
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.createVariant).toHaveBeenCalledWith(
      project,
      expect.stringMatching(/^Netzanschluss 4,50\sMW · Batteriespeicher 2,0\sMWh mit 1,00\sMW$/),
      { grid_import_limit_kw: 4500, storage_kwh: 2000, storage_kw: 1000 },
    );
    expect(api.runVariants).toHaveBeenCalledWith(project, false, false, null);
  });

  it("rechnet unter dem gewählten Krisenfall mit", async () => {
    const crisis = "airport_case_04_gepaeckstau_v1";
    const { reload, keep } = view({
      levers: { ...today, gridLimitKw: 4500, crisis },
    });
    expect(screen.getByText(/Gerechnet wird auch unter „Gepäckstau“/)).toBeVisible();
    fireEvent.click(keep());
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.runVariants).toHaveBeenCalledWith(project, true, false, crisis);
  });

  it("sagt, warum nichts festgehalten werden kann", () => {
    view({ sample: true });
    expect(screen.getByText("Festhalten geht nur in einem eigenen Projekt.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Einstellung festhalten" })).toBeDisabled();
  });

  it.each([
    ["ohne Änderung", { levers: today }, "Verändern Sie erst einen Regler."],
    [
      "ohne Flugplan",
      { board: board({ base: null }) },
      "Dafür braucht das Projekt zuerst einen Flugplan unter Daten.",
    ],
    [
      "beim Entfernen des Speichers",
      {
        today: { ...today, batteryKwh: 1000, batteryKw: 500 },
        levers: { ...today, batteryKwh: 0, gridLimitKw: 4000 },
      },
      "Einen vorhandenen Speicher zu entfernen lässt sich nicht festhalten.",
    ],
    [
      "bei schon festgehaltener Einstellung",
      {
        board: board({
          definitions: [
            {
              id: "v1",
              name: "Mein Vorschlag",
              changes: { storage_kw: 1000, storage_kwh: 2000, grid_import_limit_kw: 4500 },
            },
          ],
        }),
      },
      "Diese Einstellung ist schon festgehalten als „Mein Vorschlag“.",
    ],
  ])("bleibt %s gesperrt", (_, props, hint) => {
    view(props);
    expect(screen.getByText(hint)).toBeVisible();
    expect(screen.getByRole("button", { name: "Einstellung festhalten" })).toBeDisabled();
  });

  it("hält Fahrzeuge verschiedener Art auseinander", () => {
    view({
      levers: { ...today, extraVehicles: 5, extraKind: "gpu" },
      board: board({
        definitions: [
          { id: "v1", name: "Schlepper", changes: { extra_vehicles: { pushback_tug: 5 } } },
        ],
      }),
    });
    expect(screen.getByRole("button", { name: "Einstellung festhalten" })).toBeEnabled();
    expect(screen.queryByText(/schon festgehalten/)).toBeNull();
  });

  it("hält höchstens acht Lösungen", () => {
    const definitions = Array.from({ length: 8 }, (_, i) => ({
      id: `v${i}`,
      name: `Lösung ${i}`,
      changes: { grid_import_limit_kw: 4000 + i },
    }));
    view({ board: board({ definitions }) });
    expect(screen.getByText(/Es sind schon 8 Lösungen festgehalten/)).toBeVisible();
  });

  it("vergibt einen freien Namen, wenn der erste schon belegt ist", async () => {
    const { reload, keep } = view({
      board: board({
        definitions: [
          {
            id: "v1",
            name: describeChanges({
              grid_import_limit_kw: 4500,
              storage_kwh: 2000,
              storage_kw: 1000,
            }),
            changes: { grid_import_limit_kw: 9000 },
          },
        ],
      }),
    });
    fireEvent.click(keep());
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.createVariant.mock.calls[0]![1]).toMatch(/ \(2\)$/);
  });

  it("zeigt Fehler vom Server als Meldung", async () => {
    api.createVariant.mockRejectedValueOnce(new Error("Maximal 8 Varianten"));
    const { keep } = view();
    fireEvent.click(keep());
    expect(await screen.findByRole("alert")).toHaveTextContent("Maximal 8 Varianten");
  });

  it("entfernt eine festgehaltene Lösung", async () => {
    const { reload } = view({
      levers: today,
      board: board({
        definitions: [{ id: "v1", name: "Batterie", changes: { storage_kwh: 2000 } }],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Batterie entfernen" }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.deleteVariant).toHaveBeenCalledWith(project, "v1");
  });

  it("zeigt den Vergleich erst, wenn gerechnet ist", () => {
    const done = board({
      variants: [
        variant({}),
        variant({
          id: "v1",
          name: "Batterie",
          kind: "speicher",
          onTimePct: 97,
          minutesAtLimit: 12,
          deltaOnTimePct: 13,
        }),
      ],
      answer: { status: "ok", headline: "„Batterie“ hilft am meisten.", details: [], bestId: "v1" },
    });
    view({ levers: today, board: done });
    expect(screen.getByText("„Batterie“ hilft am meisten.")).toBeVisible();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: /Heutiger Stand/ })).toBeVisible();
    expect(within(table).getByRole("row", { name: /Batterie.*97,0 %/ })).toBeVisible();
    expect(within(table).getByText("+13,0 Prozentpunkte")).toBeVisible();
  });

  it("zeigt den Fortschritt, solange gerechnet wird", () => {
    view({
      running: true,
      board: board({
        run: {
          status: "running",
          done: 1,
          total: 3,
          stress: false,
          crisis: null,
          stale: false,
          inputsStale: false,
          createdAt: "",
        },
      }),
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 von 3 Berechnungen fertig.");
    expect(screen.getByRole("button", { name: "Wird gerechnet …" })).toBeDisabled();
  });
});
