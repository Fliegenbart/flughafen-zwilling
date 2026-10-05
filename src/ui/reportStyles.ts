export const REPORT_STYLES = `
:root{--bg-a:#f4f6f8;--bg-b:#ffffff;--surface:#ffffff;--surface-soft:#f6f8fb;--line:#dde3eb;--text:#102033;--text-dim:#5a6b80;--cyan:#2255ee;--good:#176447;--bad:#b42332}
*{box-sizing:border-box}body{margin:0;background:var(--bg-a);color:var(--text);font:14px/1.65 Sora,"Trebuchet MS",sans-serif;padding:32px}
main,.wrapper{max-width:1100px;margin:auto;background:#fff;padding:28px;border:1px solid var(--line);border-radius:6px}
h1{font-size:30px;line-height:1.25;letter-spacing:-.6px;margin:0 0 16px}h2{font-size:20px;line-height:1.4;color:var(--text);margin-top:32px}h3{font-size:16px}
.head{display:flex;justify-content:space-between;align-items:start;gap:24px}.brand small{color:var(--text-dim)}
.warning,.notice{background:#fff4df;color:#9a4a00;border-left:3px solid #9a4a00;padding:16px;margin:20px 0}
.meta{padding:16px;background:var(--surface-soft);border-block:1px solid var(--line)}.meta b{color:var(--text-dim)}
.badge{display:inline-block;padding:6px 10px;border-radius:4px;font-weight:600}.badge.pass{background:#e8f4ec;color:var(--good)}.badge.fail{background:#fff0f1;color:var(--bad)}
.ok{color:var(--good);font-weight:600}.ko{color:var(--bad);font-weight:600}.config{margin-top:16px;padding:16px;background:var(--surface-soft);border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}thead{background:var(--surface-soft)}th{font-weight:600}
code,pre,.mono{font-family:"IBM Plex Mono",Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}.code{font-family:"IBM Plex Mono",Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap}details{padding:16px 0;border-top:1px solid var(--line)}summary{cursor:pointer;font-weight:600}
a{color:#2255ee;text-underline-offset:4px}.delta{font-size:24px;color:#102033}.foot,.footer{color:var(--text-dim);font-size:12px;margin-top:24px}.grid,.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
@media(max-width:600px){body{padding:12px}main,.wrapper{padding:16px}.head{display:block}.grid,.compare-grid{grid-template-columns:1fr}th,td{padding:8px;font-size:12px}h1{font-size:25px}}
@media print{body{padding:0;background:#fff;color:#102033}main,.wrapper{max-width:none;margin:0;padding:0;border:0}.warning,.notice{background:#fff4df}.config{background:#fff}h2{break-after:avoid}tr{break-inside:avoid}a{color:#102033}details{break-inside:avoid}}
`;
