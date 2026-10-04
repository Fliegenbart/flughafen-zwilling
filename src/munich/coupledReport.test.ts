import { describe, expect, it } from "vitest";
import { ruleDifferenceNote } from "./coupledReport";
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
