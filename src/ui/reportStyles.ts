/**
 * Gemeinsame Stile der exportierten HTML-Berichte. Hell und drucktauglich, ohne externe
 * Abhaengigkeiten: Berichte werden offline geoeffnet, daher stehen Instrument Serif, Inter Tight
 * und JetBrains Mono nur vorne in Fallback-Stacks, die mit Systemschriften gut aussehen.
 */
const REPORT_FONTS = {
  serif: '"Instrument Serif","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
  sans: '"Inter Tight",Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  mono: '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
};

export const REPORT_STYLES = `
:root{--bg-a:#f3f1ec;--bg-b:#fffefb;--surface:#fffefb;--surface-soft:#f7f5f0;--line:#dcd8ce;--line-strong:#a9a499;--text:#13171c;--text-dim:#5b636d;--accent:#845c00;--signal:#f2b705;--link:#2f5bd3;--good:#1f7a4c;--bad:#b3261e;--font-serif:${REPORT_FONTS.serif};--font-sans:${REPORT_FONTS.sans};--font-mono:${REPORT_FONTS.mono}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:var(--bg-a);color:var(--text);font:15px/1.6 var(--font-sans);padding:40px 24px;font-feature-settings:"tnum" 1}
main,.wrapper{max-width:1040px;margin:auto;background:var(--surface);padding:40px 44px;border:1px solid var(--line);border-top:4px solid var(--signal)}
h1,h2{font-family:var(--font-serif);font-weight:400;color:var(--text)}h1{font-size:40px;line-height:1.08;letter-spacing:-.01em;margin:0 0 18px}h2{font-size:26px;line-height:1.2;margin:40px 0 10px;padding-top:14px;border-top:1px solid var(--line)}h3{font-size:16px;font-weight:600;margin:24px 0 8px}
small{font:600 11px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)}
.head{display:flex;justify-content:space-between;align-items:start;gap:24px}.brand small{color:var(--text-dim)}
.warning,.notice,.tag{display:block;background:#fbf3dc;color:#5c4100;border-left:3px solid var(--accent);padding:14px 16px;margin:20px 0}
.meta{padding:16px;background:var(--surface-soft);border-block:1px solid var(--line)}.meta b{color:var(--text-dim);font-weight:600}
.badge{display:inline-block;padding:4px 10px;border:1px solid currentColor;font:600 12px/1.5 var(--font-mono);letter-spacing:.04em}.badge.pass{background:#e6f2eb;color:var(--good)}.badge.fail{background:#fbe9e7;color:var(--bad)}
.ok{color:var(--good);font-weight:600}.ko{color:var(--bad);font-weight:600}.config{margin-top:16px;padding:16px;background:var(--surface-soft);border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13.5px;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}thead th{font:600 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);border-bottom:1px solid var(--line-strong)}
code,pre,.mono{font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}.code{font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:var(--surface-soft);padding:12px;border:1px solid var(--line)}details{padding:16px 0;border-top:1px solid var(--line)}summary{cursor:pointer;font-weight:600}
a{color:var(--link);text-underline-offset:3px}.delta{font:400 30px/1.1 var(--font-serif);color:var(--text)}.foot,.footer{color:var(--text-dim);font-size:12px;margin-top:32px;padding-top:12px;border-top:1px solid var(--line)}.grid,.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
@media(max-width:600px){body{padding:12px}main,.wrapper{padding:20px}.head{display:block}.grid,.compare-grid{grid-template-columns:1fr}th,td{padding:8px;font-size:12px}h1{font-size:30px}}
@page{size:A4;margin:16mm 14mm}
@media print{body{padding:0;background:#fff;color:#13171c;font-size:11pt}main,.wrapper{max-width:none;margin:0;padding:0;border:0}.warning,.notice,.tag{background:#fbf3dc}.config{background:#fff}h1,h2,h3{break-after:avoid}tr,table,.badge{break-inside:avoid}a{color:#13171c}details{break-inside:avoid}details>*{display:block}}
`;
