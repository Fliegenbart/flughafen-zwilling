import type { Sample } from "./types";

// Retain extrema and missing-data boundaries; a large CSV must not hide a power spike.
export function chartSamples(trace: Sample[], maxGap: number): Sample[] {
  const bucketSize = Math.max(1, Math.ceil(trace.length / 500));
  const reduced: Sample[] = [];
  const indices = new Map(trace.map((point, index) => [point.ts_s, index]));
  for (let start = 0; start < trace.length; start += bucketSize) {
    const chunk = trace.slice(start, start + bucketSize);
    const keep = new Set<number>([0, chunk.length - 1]);
    let minimum = 0,
      maximum = 0;
    chunk.forEach((point, index) => {
      if ((point.power_kw ?? Infinity) < (chunk[minimum]?.power_kw ?? Infinity)) minimum = index;
      if ((point.power_kw ?? -Infinity) > (chunk[maximum]?.power_kw ?? -Infinity)) maximum = index;
      const previous = trace[start + index - 1];
      if (
        previous &&
        ((point.power_kw === null) !== (previous.power_kw === null) ||
          point.ts_s - previous.ts_s > maxGap ||
          previous.setpoint_kw !== point.setpoint_kw ||
          previous.limit_kw !== point.limit_kw)
      ) {
        keep.add(index);
        if (index > 0) keep.add(index - 1);
      }
    });
    keep.add(minimum);
    keep.add(maximum);
    [...keep]
      .sort((a, b) => a - b)
      .forEach((i) => {
        const point = chunk[i];
        if (point) reduced.push(point);
      });
  }
  const output: Sample[] = [];
  reduced.forEach((point, index) => {
    const previous = reduced[index - 1];
    // Only actual timestamp gaps, not downsampling intervals, count as missing.
    const originalIndex = indices.get(point.ts_s) ?? 0;
    const originalPrevious = trace[originalIndex - 1];
    if (previous && originalPrevious && point.ts_s - originalPrevious.ts_s > maxGap) {
      output.push({ ...point, ts_s: (point.ts_s + originalPrevious.ts_s) / 2, power_kw: null });
    }
    output.push(point);
  });
  return output;
}
