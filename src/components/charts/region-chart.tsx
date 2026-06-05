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

import {
  SERIES_ANIMATION_ACTIVE,
  CHART_HEIGHT,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/chart-theme";
import { fmtRate } from "@/lib/format";

/**
 * On-time rate by region with a 95% target reference line. The data lands ~85%,
 * so the visible gap to the target line is the story.
 *
 * Values stay FRACTIONS (0..1) all the way to the formatter — same convention
 * as every other surface, so the fixed [0, 1] domain and the 0.95 target line
 * live in the same coordinate space as the data.
 */
export function RegionChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  const chartData = data.map((d) => ({ key: d.key, value: d.value ?? 0 }));

  return (
    <div
      role="img"
      aria-label="Bar chart: on-time rate by region against a 95% target"
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
            domain={[0, 1]}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v: number) => fmtRate(v, 0)}
            // Percent ticks clip at the 44px default ("100%"-class labels).
            width={56}
          />
          <Tooltip
            formatter={(value) => [fmtRate(Number(value)), "On-time rate"]}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ fill: "var(--muted)" }}
          />
          <ReferenceLine
            y={0.95}
            stroke="var(--chart-4)"
            strokeDasharray="4 4"
            label={{
              value: "Target 95%",
              position: "insideTopRight",
              fontSize: 11,
              fill: "var(--muted-foreground)",
            }}
          />
          {/* Teal: on-time is a success metric — same token STATUS_COLORS uses
              for 'delivered', so this color means the same thing everywhere. */}
          <Bar
            dataKey="value"
            fill="var(--chart-2)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={SERIES_ANIMATION_ACTIVE}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
