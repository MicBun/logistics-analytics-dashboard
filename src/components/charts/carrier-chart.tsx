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

import {
  SERIES_ANIMATION_ACTIVE,
  CHART_HEIGHT,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/chart-theme";
import { fmtRate } from "@/lib/format";

/**
 * Delay rate by carrier, sorted desc (ordering is decided upstream by the
 * query's sort param; we render rows in the order received).
 *
 * Values stay FRACTIONS (0..1) all the way to the formatter — the same
 * convention as every other surface (Ask page chart, KPI tiles), so the same
 * number can never render two different ways.
 */
export function CarrierChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  // null = no delivery outcomes for this carrier; treat as 0 for the axis.
  const chartData = data.map((d) => ({ key: d.key, value: d.value ?? 0 }));

  return (
    <div
      role="img"
      aria-label="Bar chart: delay rate by carrier, sorted highest to lowest"
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v: number) => fmtRate(v, 0)}
            // Percent ticks clip at the 44px default ("100%"-class labels).
            width={56}
          />
          <Tooltip
            formatter={(value) => [fmtRate(Number(value)), "Delay rate"]}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ fill: "var(--muted)" }}
          />
          {/* Amber: delay is a problem metric — same token STATUS_COLORS uses
              for 'delayed', so this color means the same thing everywhere. */}
          <Bar
            dataKey="value"
            fill="var(--chart-3)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={SERIES_ANIMATION_ACTIVE}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
