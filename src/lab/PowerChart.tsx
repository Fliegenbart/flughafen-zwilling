import { chartTokens } from "../ui/chartTheme";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import { chartSamples } from "./chart";
import type { Sample } from "./types";

export default function PowerChart({
  trace,
  maxGap,
  preview,
}: {
  trace: Sample[];
  maxGap: number;
  preview: boolean;
}) {
  const data = useMemo(() => chartSamples(trace, maxGap), [trace, maxGap]);
  return (
    <div
      className="lab-chart"
      aria-label={
        preview
          ? "Geplantes Sollwertprofil, noch keine Messung"
          : "Ist-Leistung, Sollwert und Leistungsgrenze in kW über Sekunden"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 15, left: -10, bottom: 18 }}>
          <CartesianGrid stroke={chartTokens.grid} vertical={false} />
          <XAxis
            dataKey="ts_s"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            minTickGap={35}
            tick={{ fill: chartTokens.axis, fontSize: 11 }}
            label={{
              value: "Zeit / s",
              position: "insideBottomRight",
              offset: -13,
              fill: chartTokens.axis,
              fontSize: 11,
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: chartTokens.axis, fontSize: 11 }}
            label={{
              value: "kW",
              position: "insideTopLeft",
              offset: 12,
              fill: chartTokens.axis,
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{ ...chartTokens.tooltip, fontSize: 12 }}
            labelFormatter={(value) => `${value} s`}
            formatter={(value: number, name: string) => [`${Number(value).toFixed(2)} kW`, name]}
          />
          <ReferenceLine x={30} stroke={chartTokens.axis} strokeDasharray="3 5" />
          <Line
            name="Leistungsgrenze"
            dataKey="limit_kw"
            type="stepAfter"
            stroke={chartTokens.series.red}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="Soll-Leistung"
            dataKey="setpoint_kw"
            type="stepAfter"
            stroke={chartTokens.series.baseline}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
          {!preview && (
            <Line
              name="Ist-Leistung"
              dataKey="power_kw"
              type="linear"
              stroke={chartTokens.series.green}
              strokeWidth={2.5}
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
