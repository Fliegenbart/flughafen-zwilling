import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { points } from "../model/dayCurve";
import { leversFromBasis, resultFromExact, simulateLive } from "../model/livePower";
import { samplePreview } from "../sample";
import LoadChart from "./LoadChart";

const preview = samplePreview();
const todayLevers = leversFromBasis(preview.basis);
const today = resultFromExact(preview.basis);
/** Eng: der Anschluss reicht nicht, also Fehlendes, aber keine Batterie. */
const tight = simulateLive(preview.basis, { ...todayLevers, gridLimitKw: 2500 });
/** Mit Batterie: ein Teil der Spitze wird gedeckt. */
const covered = simulateLive(preview.basis, {
  ...todayLevers,
  gridLimitKw: 3000,
  batteryKwh: 4000,
  batteryKw: 2000,
});
/** Weit: nichts fehlt. */
const roomy = simulateLive(preview.basis, { ...todayLevers, gridLimitKw: 9000 });

function chart(result = today, changed = false) {
  return render(
    <LoadChart result={result} today={today} departures={preview.departures} changed={changed} />,
  );
}

describe("LoadChart im Druck", () => {
  it("zeichnet sich zum Drucken in fester Groesse und danach wieder in Fensterbreite", () => {
    const { container } = chart();
    const svg = () => container.querySelector("svg")!;
    const screenWidth = svg().getAttribute("width");
    expect(screenWidth).toBe("900");
    const screenHeight = svg().getAttribute("height");

    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(svg().getAttribute("width")).toBe("700");
    expect(svg().getAttribute("viewBox")).toMatch(/^0 0 700 /);
    // Niedriger als am Bildschirm, damit die Handreichung auf eine Seite passt.
    expect(Number(svg().getAttribute("height"))).toBeLessThan(Number(screenHeight));

    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(svg().getAttribute("width")).toBe(screenWidth);
    expect(svg().getAttribute("height")).toBe(screenHeight);
  });
});

describe("LoadChart Legende", () => {
  it("nennt nur, was gezeichnet ist", () => {
    const { rerender } = chart(roomy);
    expect(points(roomy).some((p) => p.miss > 0.5 || p.cover > 0.5)).toBe(false);
    expect(screen.queryByRole("list", { name: "Legende" })).not.toBeInTheDocument();

    rerender(
      <LoadChart result={tight} today={today} departures={preview.departures} changed={false} />,
    );
    expect(points(tight).some((p) => p.miss > 0.5)).toBe(true);
    const items = () => screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items()).toEqual(["Es fehlt"]);

    rerender(
      <LoadChart result={tight} today={today} departures={preview.departures} changed={true} />,
    );
    expect(items()).toEqual(["Strombedarf mit Ihrer Einstellung", "Strombedarf heute", "Es fehlt"]);
  });

  it("nennt die Batterie, sobald sie Strom gibt", () => {
    chart(covered, true);
    expect(points(covered).some((p) => p.cover > 0.5)).toBe(true);
    expect(screen.getByText("Batterie deckt")).toBeInTheDocument();
  });

  it("schraffiert das Fehlende, damit Rot und Gruen auch ohne Farbe zu trennen sind", () => {
    const { container } = chart(tight);
    expect(container.querySelector("pattern#ap-miss-hatch")).toBeInTheDocument();
    const css = readFileSync(resolve(__dirname, "arbeitsplatz.css"), "utf8");
    expect(/\.ap-chart__miss\s*\{[^}]*fill:\s*url\(#ap-miss-hatch\)/.test(css)).toBe(true);
  });
});

describe("LoadChart Zeitschieber", () => {
  it("nennt die Uhrzeit auch ohne Auswahl und zeigt den Zeiger gleich beim Fokus", () => {
    const { container } = chart(tight);
    const scrub = screen.getByRole("slider", { name: "Uhrzeit im Tagesverlauf" });
    expect(scrub).toHaveAttribute("aria-valuetext", "00:00 Uhr");
    expect(container.querySelector(".ap-chart__cursor")).not.toBeInTheDocument();

    fireEvent.focus(scrub);
    expect(container.querySelector(".ap-chart__cursor")).toBeInTheDocument();
    expect(scrub.getAttribute("aria-valuetext")).toMatch(/^00:00 Uhr: .* gebraucht/);

    fireEvent.change(scrub, { target: { value: "720" } });
    expect(scrub.getAttribute("aria-valuetext")).toMatch(/^12:00 Uhr: /);

    fireEvent.blur(scrub);
    expect(container.querySelector(".ap-chart__cursor")).not.toBeInTheDocument();
    expect(scrub).toHaveAttribute("aria-valuetext", "00:00 Uhr");
  });

  it("meldet das Ablesefeld nicht bei jedem Schritt als Ansage", () => {
    const { container } = chart(tight);
    const readout = container.querySelector(".ap-chart__readout")!;
    expect(readout).not.toHaveAttribute("aria-live");
    expect(readout).not.toHaveAttribute("role");
  });
});

describe("Stilregeln des Arbeitsbildschirms", () => {
  const css = readFileSync(resolve(__dirname, "arbeitsplatz.css"), "utf8");

  /** Text ausserhalb von `@media <query> { ... }`-Bloecken, die mit `query` beginnen. */
  function outsideMedia(source: string, query: string) {
    let out = "";
    let i = 0;
    const head = `@media ${query}`;
    while (i < source.length) {
      const start = source.indexOf(head, i);
      if (start < 0) {
        out += source.slice(i);
        break;
      }
      out += source.slice(i, start);
      let depth = 0;
      let j = source.indexOf("{", start);
      for (; j < source.length; j++) {
        if (source[j] === "{") depth++;
        if (source[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
    }
    return out;
  }

  it("haelt die Beamer-Groessen aus dem Druck heraus", () => {
    expect(css).toContain("[data-presenting]");
    expect(outsideMedia(css, "screen")).not.toContain("[data-presenting]");
  });

  it("laesst die Kopfzeile umbrechen statt zur Seite zu laufen", () => {
    const head = /\n\.ap-head\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(head).toMatch(/flex-wrap:\s*wrap/);
  });

  it("faerbt veraenderte Regler nicht gruen, denn Gruen heisst besser", () => {
    const rules = [...css.matchAll(/\.ap-lever\[data-changed\][^{]*\{([^}]*)\}/g)].map(
      (m) => m[1]!,
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toContain("--ap-go");
  });

  it("zeichnet Vergleichslinie und Balken mit mindestens 3:1 auf Weiss", () => {
    const hex = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)![1]!;
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    expect(ratio(hex("--ap-ghost"), hex("--ap-bg"))).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/\.ap-chart__today\s*\{[^}]*stroke:\s*var\(--ap-ghost\)/);
    expect(css).toMatch(/\.ap-chart__dep\s*\{[^}]*fill:\s*var\(--ap-ghost\)/);
  });
});

describe("Evidenz-Badge im Arbeitsbildschirm", () => {
  const css = readFileSync(resolve(__dirname, "../../ui/designSystem.css"), "utf8");

  /** Selektorliste der Regel, die `property` setzt (erste Fundstelle ab `from`). */
  function selectorsOf(property: string, from = 0) {
    const at = css.indexOf(property, from);
    expect(at).toBeGreaterThan(-1);
    const open = css.lastIndexOf("{", at);
    const close = css.lastIndexOf("}", open);
    return css.slice(close + 1, open);
  }

  it("legt die Badge-Farben und Flaechen auch unter .ap an", () => {
    expect(selectorsOf("--ev-synthetic-bg")).toMatch(/\.ap\b/);
    expect(selectorsOf("--ds-surface:")).toMatch(/\.ap\b/);
    expect(selectorsOf("--ds-line-strong:")).toMatch(/\.ap\b/);
    expect(selectorsOf("--ds-ink:")).toMatch(/\.ap\b/);
  });

  it("gibt dem Arbeitsbildschirm keine dunklen Badge-Farben, er hat festen hellen Grund", () => {
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark.slice(0, dark.indexOf(".ds-visually-hidden"))).not.toMatch(/\.ap\b/);
  });
});
