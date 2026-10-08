/** Die Bausteine von Schritt B im Einzelnen: Regler, Vorschläge, Tabelle, Phasenliste, Druckseite. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Preview } from "../../api/preview";
import type { DataStatus } from "../../model/dataStatus";
import {
  leversFromBasis,
  resultFromExact,
  type Levers,
  type LiveResult,
} from "../../model/livePower";
import { samplePreview } from "../../sample";
import { SCENARIO_CASES } from "../../scenarios";
import BasisNote from "../BasisNote";
import { HandoutFoot, HandoutHead } from "../Handout";
import LeverPanel from "../LeverPanel";
import Outcome from "../Outcome";
import Presets from "../Presets";
import Shortfalls from "../Shortfalls";

const preview = samplePreview();
const base = leversFromBasis(preview.basis);
const today: Levers = { ...base, policy: "uncontrolled" };
const baseResult = resultFromExact(preview.basis);
const crisisId = SCENARIO_CASES[2]!.scenarioId;

afterEach(() => vi.useRealTimers());

function panel(props: Partial<React.ComponentProps<typeof LeverPanel>> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <LeverPanel
      levers={today}
      today={today}
      pvKwp={7000}
      fleetVehicles={101}
      onChange={onChange}
      onReset={onReset}
      exactEnabled
      {...props}
    />,
  );
  return { onChange, onReset };
}

describe("Regler", () => {
  it("zählt auch die Laderegel allein als Änderung", () => {
    panel({ levers: { ...today, policy: "mission_priority" } });
    expect(screen.getByRole("button", { name: "Auf heute zurücksetzen" })).toBeEnabled();
  });

  it("lässt den Knopf zu, solange nichts anders ist", () => {
    panel();
    expect(screen.getByRole("button", { name: "Auf heute zurücksetzen" })).toBeDisabled();
  });

  it("kündigt Werte nicht noch einmal an, die der Schieber schon nennt", () => {
    const { container } = render(
      <LeverPanel
        levers={today}
        today={today}
        pvKwp={7000}
        fleetVehicles={101}
        onChange={vi.fn()}
        onReset={vi.fn()}
        exactEnabled
      />,
    );
    const outputs = container.querySelectorAll("output");
    expect(outputs.length).toBeGreaterThan(2);
    for (const o of outputs) expect(o).toHaveAttribute("aria-live", "off");
  });

  it("rastet neben dem Raster auf heute ein und kehrt exakt zu heute zurück", () => {
    const off = { ...today, batteryKwh: 1200, batteryKw: 800 };
    const { onChange } = panel({ levers: off, today: off });
    const slider = screen.getByRole("slider", { name: "Batteriespeicher" });
    // Die Schiene kennt nur Vielfache von 250: 1250 ist der Rasterpunkt neben 1200.
    fireEvent.change(slider, { target: { value: "1250" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...off, batteryKwh: 1200, batteryKw: 800 });
    fireEvent.change(slider, { target: { value: "1500" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...off, batteryKwh: 1500, batteryKw: 750 });
    fireEvent.change(slider, { target: { value: "1000" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...off, batteryKwh: 1000, batteryKw: 500 });
  });

  it("lässt Werte auf dem Raster unverändert", () => {
    const { onChange } = panel();
    fireEvent.change(screen.getByRole("slider", { name: "Netzanschluss" }), {
      target: { value: String(today.gridLimitKw + 100) },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...today, gridLimitKw: today.gridLimitKw + 100 });
  });

  it("erklärt ohne Server einmal, was fehlt, und verknüpft die gesperrten Regler damit", () => {
    panel({ exactEnabled: false });
    const note = screen.getByText(/gibt es nur in einem eigenen Projekt/);
    expect(screen.getAllByText(/nur in einem eigenen Projekt/i)).toHaveLength(1);
    for (const name of ["Zusätzliche Elektrofahrzeuge", "Laderegel", "Krisenfall durchspielen"])
      expect(
        screen.getByRole(name === "Zusätzliche Elektrofahrzeuge" ? "slider" : "combobox", { name }),
      ).toHaveAccessibleDescription(note.textContent!);
    expect(screen.queryByText(/genauen? Rechnung/)).toBeNull();
  });

  it("sagt mit Server, wann die Regler wirken, und nennt die Mischung ehrlich", () => {
    panel({ levers: { ...today, extraVehicles: 4 } });
    expect(screen.getAllByText(/wirkt erst, wenn die Rechnung fertig ist/i).length).toBeGreaterThan(
      1,
    );
    expect(
      screen.getByRole("option", { name: "alle Arten, in angenommener Mischung" }),
    ).toBeVisible();
    expect(screen.queryByText(/wie heute gemischt/)).toBeNull();
  });

  it("hält für den Druck den Klartext der Auswahlfelder bereit", () => {
    const { container } = render(
      <LeverPanel
        levers={{ ...today, policy: "mission_priority", extraVehicles: 4, extraKind: "gpu" }}
        today={today}
        pvKwp={7000}
        fleetVehicles={101}
        onChange={vi.fn()}
        onReset={vi.fn()}
        exactEnabled
      />,
    );
    const printed = [...container.querySelectorAll(".ap-print-only")].map((e) => e.textContent);
    expect(printed).toEqual(["nur Bodenstromgeräte", "Wer zuerst los muss, lädt zuerst", "keiner"]);
    for (const e of container.querySelectorAll(".ap-print-only"))
      expect(e).toHaveAttribute("aria-hidden");
  });

  it("nennt die Annahme zum Krisenfall in einem Satz ohne Doppelpunkt", () => {
    panel({ levers: { ...today, crisis: crisisId } });
    expect(screen.getByText(/^Annahme für „Wetter“\. Den ganzen Tag liefert/)).toBeVisible();
  });

  it("schützt Zahl und Einheit vor dem Umbruch", () => {
    panel({ levers: { ...today, batteryKwh: 2000, batteryKw: 1000 } });
    // getByText gleicht Leerzeichen an; der geschützte Abstand steht im Text selbst.
    expect(screen.getByText("2,0 MWh").textContent).toBe("2,0\u00a0MWh");
    expect(screen.getByText("100 % von heute").textContent).toBe("100\u00a0% von heute");
    expect(screen.getByText(/^heute 7,0 MWp$/).textContent).toContain("7,0\u00a0MWp");
  });
});

describe("Vorschläge", () => {
  const view = (props: Partial<React.ComponentProps<typeof Presets>> = {}) => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <Presets
        levers={today}
        today={today}
        onChange={onChange}
        onReset={onReset}
        exactEnabled
        {...props}
      />,
    );
    return { onChange, onReset };
  };

  it("behält beim Antippen den gewählten Krisenfall", () => {
    const { onChange } = view({ levers: { ...today, crisis: crisisId } });
    fireEvent.click(screen.getByRole("button", { name: "1 MW mehr Anschluss" }));
    expect(onChange).toHaveBeenCalledWith({
      ...today,
      gridLimitKw: today.gridLimitKw + 1000,
      crisis: crisisId,
    });
  });

  it("bleibt gedrückt, wenn danach ein Krisenfall dazukommt, und nimmt nur die Änderung zurück", () => {
    const pressed = { ...today, gridLimitKw: today.gridLimitKw + 1000, crisis: crisisId };
    const { onChange, onReset } = view({ levers: pressed });
    const chip = screen.getByRole("button", { name: "1 MW mehr Anschluss" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith({ ...today, crisis: crisisId });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("setzt ohne Krisenfall wie bisher ganz auf heute zurück", () => {
    const { onReset } = view({ levers: { ...today, gridLimitKw: today.gridLimitKw + 1000 } });
    fireEvent.click(screen.getByRole("button", { name: "1 MW mehr Anschluss" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("erklärt ohne Server sichtbar, warum Vorschläge gesperrt sind", () => {
    view({ exactEnabled: false });
    const note = screen.getByText("Ausgegraute Vorschläge gibt es nur in einem eigenen Projekt.");
    const blocked = screen.getByRole("button", { name: "5 Schlepper mehr" });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription(note.textContent!);
    expect(screen.getByRole("button", { name: "1 MW mehr Anschluss" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("zeigt mit Server keinen Hinweis", () => {
    view();
    expect(screen.queryByText(/Ausgegraute/)).toBeNull();
  });
});

describe("Vergleich heute und mit Ihrer Einstellung", () => {
  const exact: Preview = { ...preview, computeMs: 412 };
  const view = (props: Partial<React.ComponentProps<typeof Outcome>> = {}) =>
    render(
      <Outcome
        today={baseResult}
        todayPreview={preview}
        result={baseResult}
        exact={exact}
        accuracy="genau"
        changed
        sample={false}
        {...props}
      />,
    );

  it("nennt weder genau noch Millisekunden und sagt, was festhalten bedeutet", () => {
    const { container } = view();
    const line = container.querySelector(".ap-accuracy")!;
    expect(line).toHaveTextContent(/Diese Rechnung ist nicht gespeichert/);
    expect(line).toHaveTextContent("„Einstellung festhalten“ macht daraus eine Lösung im Projekt");
    expect(line.textContent).not.toMatch(/genau|\bms\b|412/i);
    expect(line).not.toHaveAttribute("role");
  });

  it("spricht erst von einer Rechnung, wenn etwas verstellt ist", () => {
    const { container } = view({ changed: false });
    const line = container.querySelector(".ap-accuracy")!;
    // Das Element bleibt, es trägt die Genauigkeit für Tests und Stil.
    expect(line).toHaveAttribute("data-accuracy", "genau");
    expect(line.textContent?.trim()).toBe("");
    expect(line.querySelector("[data-evidence]")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
  });

  it("schreibt in die Tabelle nicht „wird gerechnet“, wenn die Rechnung ausgefallen ist", () => {
    const cells = (label: string) =>
      within(screen.getByRole("row", { name: new RegExp(label) }))
        .getAllByRole("cell")
        .map((c) => c.textContent);
    const { container, rerender } = view({ exact: null, accuracy: "naeherung" });
    expect(cells("Abflüge nicht rechtzeitig fertig")[1]).toBe("wird gerechnet …");
    rerender(
      <Outcome
        today={baseResult}
        todayPreview={preview}
        result={baseResult}
        exact={null}
        accuracy="fehler"
        changed
        sample={false}
      />,
    );
    expect(cells("Abflüge nicht rechtzeitig fertig")[1]).toBe("nicht gerechnet");
    expect(cells("Was die Abflüge bremst")[1]).toBe("nicht gerechnet");
    expect(container.textContent).not.toMatch(/wird gerechnet/);
    expect(container.querySelector(".ap-accuracy")).toHaveTextContent(
      "Die Kurve bleibt eine Näherung, die Rechnung ist ausgefallen.",
    );
  });

  it("kündigt nur das Ende einer Rechnung an, nicht jede Zwischenstufe", () => {
    const { container, rerender } = view();
    const live = () => container.querySelector('[role="status"]')!;
    expect(live()).toHaveTextContent("Die Rechnung ist fertig.");
    rerender(
      <Outcome
        today={baseResult}
        todayPreview={preview}
        result={baseResult}
        exact={null}
        accuracy="naeherung"
        changed
        sample={false}
      />,
    );
    expect(live()).toBeEmptyDOMElement();
    expect(container.querySelector(".ap-accuracy")).toHaveTextContent(
      "Die Kurve ist vorerst eine Näherung, die Rechnung läuft.",
    );
  });

  it("sagt im Beispielprojekt ohne Doppelpunkt und Passiv, was fehlt", () => {
    const { container } = view({ sample: true, exact: null, accuracy: "naeherung" });
    expect(container.querySelector(".ap-accuracy")).toHaveTextContent(
      "Die Kurve des Beispieltags folgt den Reglern als Näherung, eine Rechnung gibt es nur in einem eigenen Projekt.",
    );
    expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
  });

  it("benennt die Eckzelle und die Zeilen verständlich", () => {
    view();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Kennzahl" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Was die Abflüge bremst" })).toBeVisible();
    expect(within(table).queryByText("Woran die Wartezeit liegt")).toBeNull();
  });

  it("schützt Zahl und Einheit in der Tabelle", () => {
    view();
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.some((c) => /^[\d.]+\u00a0kWh$/.test(c.textContent ?? ""))).toBe(true);
    expect(cells.some((c) => /^\d+\u00a0min$/.test(c.textContent ?? ""))).toBe(true);
  });
});

describe("Phasenliste", () => {
  /** Sieben getrennte knappe Phasen (Lücken über 20 Minuten). */
  const phases = (n: number): LiveResult => ({
    ...baseResult,
    shortfalls: Array.from({ length: n }, (_, i) => ({
      start: 60 + i * 120,
      end: 90 + i * 120,
      maxMissingKw: 500 + i,
      missingKwh: 100 + i,
    })),
  });

  it("zählt eine weitere Phase in der Einzahl", () => {
    render(<Shortfalls result={phases(7)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("und eine weitere Phase")).toBeVisible();
  });

  it("zählt mehrere weitere Phasen in der Mehrzahl", () => {
    render(<Shortfalls result={phases(9)} />);
    expect(screen.getByText("und 3 weitere Phasen")).toBeVisible();
  });

  it("zeigt bei sechs Phasen keine Überlaufzeile und schützt die Einheit", () => {
    render(<Shortfalls result={phases(6)} />);
    expect(screen.queryByText(/weitere/)).toBeNull();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(/zusammen 100\skWh$/);
    expect(screen.getAllByRole("listitem")[0]!.textContent).toContain("100\u00a0kWh");
  });
});

describe("Seite zum Hinterlassen", () => {
  const clear: LiveResult = { ...baseResult, shortfalls: [] };
  const lead = (result: LiveResult, changed: boolean) => {
    const { container, unmount } = render(
      <HandoutHead project="HAM" result={result} changed={changed} />,
    );
    const text = container.querySelector(".ap-handout__lead")!.textContent;
    unmount();
    return text;
  };

  it("beginnt mit einem ganzen Satz, mit und ohne Änderung", () => {
    const worst = baseResult.shortfalls.length ? baseResult : null;
    expect(worst).not.toBeNull();
    expect(lead(baseResult, true)).toMatch(
      /^Mit Ihrer Einstellung fehlen bis zu .* von \d\d:\d\d bis \d\d:\d\d Uhr\.$/,
    );
    expect(lead(baseResult, false)).toMatch(
      /^Heute fehlen bis zu .* von \d\d:\d\d bis \d\d:\d\d Uhr\.$/,
    );
    expect(lead(clear, true)).toBe("Mit Ihrer Einstellung reicht der Anschluss den ganzen Tag.");
    expect(lead(clear, false)).toBe("Heute reicht der Anschluss den ganzen Tag.");
  });

  it("schreibt das Datum ohne führende Null", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 8));
    const { container } = render(<HandoutHead project="HAM" result={clear} changed={false} />);
    expect(container.querySelector(".ap-handout__meta")).toHaveTextContent("8. Oktober 2026");
  });

  it("nennt den Datenstand mit dem Satz aus der Datenübersicht", () => {
    const status = {
      real: 4,
      total: 4,
      items: [],
      answer: "Alle 4 Datenquellen sind belegt.",
    } as DataStatus;
    const { container } = render(<HandoutFoot status={status} sample={false} accuracy="genau" />);
    expect(container.textContent).toContain("Alle 4 Datenquellen sind belegt.");
    expect(container.textContent).not.toContain("für den Rest");
    expect(container.textContent).not.toMatch(/genaue Rechnung/);
  });

  it("sagt, dass die Kurve noch eine Näherung ist", () => {
    const { container } = render(<HandoutFoot status={null} sample={false} accuracy="naeherung" />);
    expect(container.textContent).toContain("Die Kurve ist eine Näherung, die Rechnung lief noch.");
  });

  it("sagt, dass die Rechnung ausgefallen ist, und nicht, dass sie noch lief", () => {
    const { container } = render(<HandoutFoot status={null} sample={false} accuracy="fehler" />);
    expect(container.textContent).toContain(
      "Die Kurve ist eine Näherung, die Rechnung ist ausgefallen.",
    );
    expect(container.textContent).not.toMatch(/lief noch/);
  });

  it("schweigt im Beispielprojekt über eine Rechnung, die es dort nicht gibt", () => {
    const { container } = render(<HandoutFoot status={null} sample accuracy="fehler" />);
    expect(container.textContent).not.toMatch(/Rechnung/);
  });
});

describe("Worauf diese Zahlen beruhen", () => {
  const view = (props: Partial<React.ComponentProps<typeof BasisNote>> = {}) =>
    render(
      <BasisNote
        today={preview}
        exact={null}
        board={null}
        status={null}
        sample={false}
        {...props}
      />,
    );

  it("nennt den Beispieltag ehrlich als zugeschnitten", () => {
    view({ sample: true });
    expect(
      screen.getByText(/Ein erfundener Beispieltag mit Annahmen für die Vorführung/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Standardwerten/)).toBeNull();
  });

  it("übernimmt den Datenstand aus der Datenübersicht, auch bei vier von vier", () => {
    const status = {
      real: 4,
      total: 4,
      items: [],
      answer: "Alle 4 Datenquellen sind belegt.",
    } as DataStatus;
    view({ status });
    expect(screen.getByText(/Alle 4 Datenquellen sind belegt\./)).toBeInTheDocument();
    expect(screen.queryByText(/für den Rest/)).toBeNull();
  });

  it("schreibt die Annahme zum Krisenfall als eigenen Satz", () => {
    view({
      exact: {
        ...preview,
        crisis: { id: crisisId, name: "Wetter", assumption: "Die Photovoltaik liefert weniger." },
      },
    });
    expect(
      screen.getByText(/^Annahme für „Wetter“\. Die Photovoltaik liefert weniger\.$/),
    ).toBeInTheDocument();
  });
});
