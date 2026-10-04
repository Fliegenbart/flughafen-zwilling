import { describe, expect, it } from "vitest";
import { compareAnswer, ruleDifferenceNote } from "./coupledReport";
import type { CoupledKpis } from "./coupledTypes";

const kpis = (patch: Partial<CoupledKpis>) =>
  ({ departure_readiness_pct: 80, ...patch }) as CoupledKpis;

describe("ruleDifferenceNote", () => {
  it("nennt Fahrzeugverfügbarkeit als Engpass, wenn kein Energie-Warten auftritt", () => {
    expect(
      ruleDifferenceNote(kpis({ bottleneck: "resource" }), kpis({ bottleneck: "resource" })),
    ).toBe("Unterschied der Laderegel nicht messbar, Engpass: Fahrzeugverfügbarkeit");
  });
  it("schweigt bei energetischem Engpass, realem Unterschied oder älteren Läufen", () => {
    expect(ruleDifferenceNote(kpis({ bottleneck: "energy" }), kpis({ bottleneck: "energy" }))).toBe(
      null,
    );
    expect(
      ruleDifferenceNote(
        kpis({ bottleneck: "resource" }),
        kpis({ bottleneck: "resource", departure_readiness_pct: 90 }),
      ),
    ).toBe(null);
    expect(ruleDifferenceNote(kpis({}), kpis({}))).toBe(null);
  });
});

describe("compareAnswer", () => {
  const base = {
    departure_readiness_pct: 21.5,
    bottleneck: "resource",
  } as unknown as CoupledKpis;
  it("treats a null result as a legitimate answer with its bottleneck", () => {
    expect(compareAnswer(base, base)).toBe(
      "Kein messbarer Unterschied der Laderegeln – Engpass Fahrzeugverfügbarkeit",
    );
  });
  it("states direction and size of a modelled difference", () => {
    const better: CoupledKpis = { ...base, departure_readiness_pct: 24, bottleneck: "energy" };
    expect(compareAnswer(base, better)).toMatch(/erhöht .* um 2,5 Prozentpunkte – Engpass Energie/);
    expect(compareAnswer(better, base)).toMatch(/senkt/);
  });
});
