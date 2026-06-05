"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  SERIES_ANIMATION_ACTIVE,
  CHART_HEIGHT,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/chart-theme";
import { fmtInt } from "@/lib/format";

/**
 * Monthly order-volume line chart.
 * Props are intentionally a thin, serializable shape so the parent server
 * component can pass plain data without leaking the analytics layer here.
 */
export function VolumeChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  return (
    <div role="img" aria-label="Line chart: orders placed per month across 2025">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={36}
          />
          <Tooltip
            formatter={(value) => [`${fmtInt(Number(value))} orders`, "Orders"]}
            labelFormatter={(label) => `Month ${label}`}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ stroke: "var(--border)" }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive={SERIES_ANIMATION_ACTIVE}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
