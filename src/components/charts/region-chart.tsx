"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * On-time rate by region with a 95% target reference line. The data lands ~85%,
 * so the visible gap to the target line is the story.
 * Rates arrive as fractions (0..1); converted to percent only here for display.
 */
export function RegionChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  const chartData = data.map((d) => ({
    key: d.key,
    percent: d.value === null ? 0 : d.value * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          domain={[0, 100]}
          unit="%"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={44}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "On-time rate"]}
          cursor={{ fill: "var(--muted)" }}
        />
        <ReferenceLine
          y={95}
          stroke="var(--chart-4)"
          strokeDasharray="4 4"
          label={{
            value: "Target 95%",
            position: "insideTopRight",
            fontSize: 11,
            fill: "var(--muted-foreground)",
          }}
        />
        <Bar dataKey="percent" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
