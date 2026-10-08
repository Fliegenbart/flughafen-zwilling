import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../../context";
import type { Levers } from "../../model/livePower";
import type { Project, Variant, VariantBoard } from "../../types";
import Compare from "./Compare";
import { describeChanges } from "./describe";
import Festhalten from "./Festhalten";
import { currentBoard, outdatedNote, outdatedReason } from "./results";

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
const battery = { id: "v1", name: "Batterie", changes: { storage_kwh: 2000 } };
/** Eine fertig gerechnete Tafel mit einer festgehaltenen Lösung. */
const done = (patch: Partial<VariantBoard> = {}): VariantBoard =>
  board({
    definitions: [battery],
    run: run(),
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
    expect(screen.getByText(/Wir rechnen die Lösung auch unter „Gepäckstau“/)).toBeVisible();
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
      "Ein vorhandener Batteriespeicher bleibt in jeder festgehaltenen Lösung bestehen.",
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
    view({ levers: today, board: done() });
    expect(screen.getByText("„Batterie“ hilft am meisten.")).toBeVisible();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: /Heutiger Stand/ })).toBeVisible();
    expect(within(table).getByRole("row", { name: /Batterie.*97,0\s%/ })).toBeVisible();
    expect(within(table).getByText("+13,0 Prozentpunkte")).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: "Lösung" })).toBeInTheDocument();
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

describe("Wenn beim Festhalten etwas schiefgeht", () => {
  /** Die Tafel wie auf dem Server: createVariant legt an, reload holt den Stand ab. */
  function stateful(server: { board: VariantBoard }) {
    const reload = vi.fn(async () => server.board);
    function Harness() {
      const [current, setCurrent] = useState<VariantBoard>(server.board);
      return (
        <NavContext.Provider value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}>
          <Festhalten
            project={project}
            board={current}
            reload={async () => {
              const next = await reload();
              setCurrent(next);
              return next;
            }}
            running={false}
            levers={{ ...today, gridLimitKw: 4500 }}
            today={today}
            sample={false}
          />
        </NavContext.Provider>
      );
    }
    render(<Harness />);
    return reload;
  }

  it("lädt die Tafel neu, wenn die Berechnung nach dem Anlegen scheitert", async () => {
    const server = { board: board() };
    api.createVariant.mockImplementationOnce(async (_, name, changes) => {
      server.board = board({ definitions: [{ id: "v1", name, changes: changes as never }] });
    });
    api.runVariants.mockRejectedValueOnce(new Error("Der Rechner ist gerade ausgelastet."));
    const reload = stateful(server);
    fireEvent.click(screen.getByRole("button", { name: "Einstellung festhalten" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Wir haben die Lösung festgehalten");
    expect(alert).toHaveTextContent("Der Rechner ist gerade ausgelastet.");
    expect(alert).toHaveTextContent("Neu rechnen");
    expect(reload).toHaveBeenCalled();
    // Die Lösung steht jetzt in der Liste, ein zweiter Versuch mit gleichem Namen ist gesperrt.
    expect(await screen.findByRole("list", { name: "Festgehaltene Lösungen" })).toBeVisible();
    expect(screen.getByText(/Diese Einstellung ist schon festgehalten/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Einstellung festhalten" })).toBeDisabled();
    expect(api.createVariant).toHaveBeenCalledTimes(1);
    // Ohne Lauf bietet die Seite das Rechnen an.
    expect(
      screen.getByText("Die festgehaltenen Lösungen sind noch nicht gerechnet."),
    ).toBeVisible();
    api.runVariants.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Neu rechnen" }));
    await vi.waitFor(() => expect(api.runVariants).toHaveBeenCalledTimes(2));
    expect(api.runVariants).toHaveBeenLastCalledWith(project, false, false, null);
  });

  it("zeigt den Fehler, wenn das Entfernen scheitert", async () => {
    api.deleteVariant.mockRejectedValueOnce(new Error("Keine Verbindung zum Server."));
    view({ levers: today, board: done() });
    fireEvent.click(screen.getByRole("button", { name: "Batterie entfernen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keine Verbindung zum Server.");
  });
});

describe("Ergebnisse, die nicht mehr zur Auswahl passen", () => {
  const gone = variant({ id: "v9", name: "Entfernt", kind: "pv", onTimePct: 91 });
  const rerunButton = () => screen.queryByRole("button", { name: "Neu rechnen" });

  it("zeigt nach dem Entfernen der letzten Lösung weder Tabelle noch Antwortsatz", () => {
    const stale = done({ definitions: [], run: run({ stale: true }) });
    view({ levers: today, board: stale });
    expect(screen.getByText("Noch nichts festgehalten.")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/hilft am meisten/)).toBeNull();
    expect(rerunButton()).toBeNull();
  });

  it("lässt entfernte Lösungen aus der Tabelle und nimmt den alten Antwortsatz weg", () => {
    const stale = done({
      run: run({ stale: true }),
      variants: [...done().variants, gone],
    });
    view({ levers: today, board: stale });
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Batterie/ })).toBeVisible();
    expect(within(table).queryByRole("row", { name: /Entfernt/ })).toBeNull();
    expect(screen.queryByText(/hilft am meisten/)).toBeNull();
    expect(screen.getByText("Die Auswahl hat sich geändert.")).toBeVisible();
    expect(rerunButton()).toBeEnabled();
  });

  it("rechnet mit dem Krisenfall des letzten Laufs neu", async () => {
    const crisis = { id: "airport_case_03_wetter_kompression_v1", name: "Wetter", assumption: "x" };
    view({
      levers: today,
      board: done({ run: run({ stale: true, stress: true, crisis }) }),
    });
    fireEvent.click(rerunButton()!);
    await vi.waitFor(() => expect(api.runVariants).toHaveBeenCalled());
    expect(api.runVariants).toHaveBeenCalledWith(project, true, false, crisis.id);
  });

  it("blendet die Tabelle aus, wenn sich die Daten seit dem Lauf geändert haben", () => {
    view({ levers: today, board: done({ run: run({ inputsStale: true }) }) });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/hilft am meisten/)).toBeNull();
    expect(screen.getByText("Ihre Daten haben sich seit der Berechnung geändert.")).toBeVisible();
    expect(rerunButton()).toBeEnabled();
  });

  it("sagt, welche Lösung sich nicht rechnen ließ, und hält den Antwortsatz zurück", () => {
    const two = done({
      definitions: [battery, { id: "v2", name: "Mehr Anschluss", changes: {} }],
      run: run({ status: "partial" }),
    });
    view({ levers: today, board: two });
    expect(screen.getByText("„Mehr Anschluss“ ließ sich nicht rechnen.")).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.queryByText(/hilft am meisten/)).toBeNull();
    expect(rerunButton()).toBeEnabled();
  });

  it("zeigt nichts davon, solange noch gerechnet wird", () => {
    view({ levers: today, running: true, board: done({ run: run({ status: "running" }) }) });
    expect(screen.queryByRole("table")).toBeNull();
    expect(rerunButton()).toBeNull();
  });

  it("warnt, dass ein früherer Krisenfall beim Festhalten wegfällt", () => {
    const crisis = { id: "airport_case_03_wetter_kompression_v1", name: "Wetter", assumption: "x" };
    view({ board: done({ run: run({ stress: true, crisis }) }) });
    expect(screen.getByText(/Ohne Krisenfall rechnen wir alle Lösungen neu/)).toHaveTextContent(
      "„Wetter“",
    );
  });

  it("bewertet die Teile der Entscheidung einzeln", () => {
    const b = done();
    expect(outdatedReason(b)).toBeNull();
    expect(outdatedReason({ ...b, run: null })).toBe("never");
    expect(outdatedReason({ ...b, run: run({ stale: true }) })).toBe("definitions");
    expect(outdatedReason({ ...b, run: run({ inputsStale: true }) })).toBe("inputs");
    expect(outdatedReason({ ...b, variants: [variant({})] })).toBe("failed");
    expect(outdatedReason({ ...b, source: "beispiel" })).toBeNull();
    expect(outdatedNote(b)).toBe("");
    expect(currentBoard(b).answer?.bestId).toBe("v1");
    expect(currentBoard({ ...b, definitions: [] }).variants).toEqual([]);
  });
});

describe("Liste der festgehaltenen Lösungen", () => {
  it("nennt die Beschreibung nur, wenn sie vom Namen abweicht", () => {
    const changes = { grid_import_limit_kw: 4500 };
    const text = describeChanges(changes);
    view({
      levers: today,
      board: board({
        definitions: [
          { id: "v1", name: text, changes },
          { id: "v2", name: "Mein Vorschlag", changes },
        ],
      }),
    });
    const [auto, own] = screen.getAllByRole("listitem");
    expect(auto).toHaveTextContent(new RegExp(`^${text.replace(/\u00a0/g, "\\s")}entfernen$`));
    expect(own).toHaveTextContent(/^Mein Vorschlag.*Netzanschluss 4,50\sMW.*entfernen$/);
  });

  it("schreibt Photovoltaik wie der Regler und schützt Zahl und Einheit", () => {
    expect(describeChanges({ pv_factor: 1.5 })).toBe("Photovoltaik 150\u00a0% von heute");
    expect(describeChanges({ storage_kwh: 2000, storage_kw: 1000 })).toBe(
      "Batteriespeicher 2,0\u00a0MWh mit 1,00\u00a0MW",
    );
  });
});

describe("Sicherheitsstufe der Vergleichstabelle", () => {
  const level = () => document.querySelector(".ap-compare__foot [data-evidence]")!;
  const mixed = (baseLevel: Variant["evidence"], solutionLevel: Variant["evidence"]) =>
    done({
      variants: [
        variant({ evidence: baseLevel }),
        variant({ id: "v1", name: "Batterie", kind: "speicher", evidence: solutionLevel }),
      ],
    });

  it("gilt für die schwächste Zeile, auch wenn es die Lösung ist", () => {
    render(<Compare board={mixed("model_checked", "synthetic")} bestId={null} />);
    expect(level()).toHaveAttribute("data-evidence", "synthetic");
  });

  it("gilt für die schwächste Zeile, auch wenn es der heutige Stand ist", () => {
    render(<Compare board={mixed("synthetic", "model_checked")} bestId={null} />);
    expect(level()).toHaveAttribute("data-evidence", "synthetic");
  });

  it("bleibt bei gleichen Stufen unverändert und fällt ohne Zeilen nie nach oben", () => {
    const { unmount } = render(
      <Compare board={mixed("model_checked", "model_checked")} bestId={null} />,
    );
    expect(level()).toHaveAttribute("data-evidence", "model_checked");
    unmount();
    render(<Compare board={board()} bestId={null} />);
    expect(level()).toHaveAttribute("data-evidence", "assumption");
  });

  it("benennt die Krisenspalte nach dem, was sie misst", () => {
    const crisis = { id: "c", name: "Gepäckstau", assumption: "Weniger Personal." };
    const withStress = done({
      run: run({ crisis }),
      variants: [variant({ stressOnTimePct: 80 }), variant({ id: "v1", stressOnTimePct: 90 })],
    });
    const { unmount } = render(<Compare board={withStress} bestId={null} />);
    expect(
      screen.getByRole("columnheader", { name: "Rechtzeitig fertig unter „Gepäckstau“" }),
    ).toBeVisible();
    expect(screen.getByText(/Annahme für „Gepäckstau“\. Weniger Personal\./)).toBeVisible();
    unmount();
    render(<Compare board={{ ...withStress, run: run() }} bestId={null} />);
    expect(
      screen.getByRole("columnheader", { name: /bei 20\s%\sweniger Anschluss/ }),
    ).toBeVisible();
  });
});
