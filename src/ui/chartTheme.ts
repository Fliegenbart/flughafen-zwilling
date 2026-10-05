export const chartTheme = {
  axis: "#5a6b80",
  grid: "#dde3eb",
  tooltip: {
    background: "#ffffff",
    border: "1px solid #bdcadd",
    color: "#102033",
    borderRadius: 6,
    fontSize: 13,
  },
  series: {
    primary: "#2255ee",
    baseline: "#67758a",
    amber: "#9a4a00",
    red: "#b42332",
    green: "#176447",
    teal: "#16786b",
    blue: "#0878aa",
  },
} as const;

/** Dunkle Gegenstuecke; lesbar auf der dunklen Arbeitsflaeche (#151d28). */
export const chartThemeDark = {
  axis: "#a9b6c7",
  grid: "#2b3848",
  tooltip: { background: "#151d28", border: "1px solid #415168", color: "#e7edf5" },
  series: {
    primary: "#8aa6ff",
    baseline: "#a9b6c7",
    amber: "#f3b968",
    red: "#ff9aa5",
    green: "#8fd7b5",
    teal: "#6fd1c2",
    blue: "#6fc3ef",
  },
} as const;

const v = (name: string, light: string) => `var(--chart-${name}, ${light})`;

/**
 * Diagrammfarben als CSS-Variablen: folgen dem Hell/Dunkel-Schema des Arbeitsbereichs
 * (Werte in designSystem.css), mit den hellen Werten als Rueckfall.
 */
export const chartTokens = {
  axis: v("axis", chartTheme.axis),
  grid: v("grid", chartTheme.grid),
  tooltip: {
    ...chartTheme.tooltip,
    background: v("tooltip-bg", chartTheme.tooltip.background),
    border: `1px solid ${v("tooltip-line", "#bdcadd")}`,
    color: v("tooltip-ink", chartTheme.tooltip.color),
  },
  series: Object.fromEntries(
    Object.entries(chartTheme.series).map(([key, hex]) => [key, v(key, hex)]),
  ) as Record<keyof typeof chartTheme.series, string>,
} as const;
