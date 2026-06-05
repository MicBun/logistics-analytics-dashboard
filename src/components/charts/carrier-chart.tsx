"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Delay rate by carrier, sorted desc (ordering is decided upstream by the
 * query's sort param; we render rows in the order received).
 * Rates arrive as fractions (0..1); we convert to percent only here for display.
 */
export function CarrierChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  const chartData = data.map((d) => ({
    key: d.key,
    // null = no delivery outcomes for this carrier; treat as 0 for the axis.
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
          unit="%"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={44}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Delay rate"]}
          cursor={{ fill: "var(--muted)" }}
        />
        <Bar dataKey="percent" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
