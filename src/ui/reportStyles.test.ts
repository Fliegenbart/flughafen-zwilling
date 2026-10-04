import { expect, it } from "vitest";
import { REPORT_STYLES } from "./reportStyles";

it("keeps reports light, printable and free of remote dependencies", () => {
  expect(REPORT_STYLES).toContain("--text:#102033");
  expect(REPORT_STYLES).toContain("@media print");
  expect(REPORT_STYLES).not.toMatch(/@import|url\(/i);
});
