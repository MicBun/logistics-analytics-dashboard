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
 * Distribution of orders across all five lifecycle states.
 * Deliberately a full breakdown (not a delivered-vs-delayed binary) so the
 * in-flight, canceled, and exception states excluded from rate math stay visible.
 */
export function StatusChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={36}
        />
        <Tooltip
          formatter={(value) => [`${Number(value)} orders`, "Orders"]}
          cursor={{ fill: "var(--muted)" }}
        />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
