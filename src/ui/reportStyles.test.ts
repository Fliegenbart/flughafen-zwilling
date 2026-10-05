import { expect, it } from "vitest";
import { REPORT_STYLES } from "./reportStyles";

it("keeps reports light, printable and free of remote dependencies", () => {
  expect(REPORT_STYLES).toContain("--text:#13171c");
  expect(REPORT_STYLES).toContain('"Instrument Serif"');
  expect(REPORT_STYLES).toContain('"Inter Tight"');
  expect(REPORT_STYLES).toMatch(/"JetBrains Mono",ui-monospace[^;]*monospace/);
  expect(REPORT_STYLES).toMatch(/Georgia,serif/);
  expect(REPORT_STYLES).toContain("@media print");
  expect(REPORT_STYLES).not.toMatch(/@import|url\(/i);
});

it("styles existing Airport report status, identifiers and context roles", () => {
  expect(REPORT_STYLES).toContain(".ok{color:var(--good);font-weight:600}");
  expect(REPORT_STYLES).toContain(".ko{color:var(--bad);font-weight:600}");
  expect(REPORT_STYLES).toContain(".code{font-family:var(--font-mono)");
  expect(REPORT_STYLES).toContain(
    ".config{margin-top:16px;padding:16px;background:var(--surface-soft);border:1px solid var(--line)}",
  );
  expect(REPORT_STYLES).toContain(".config{background:#fff}");
});
