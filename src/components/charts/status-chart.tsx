"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  SERIES_ANIMATION_ACTIVE,
  CHART_HEIGHT,
  STATUS_COLORS,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/chart-theme";
import { STATUS_LABELS, type Status } from "@/lib/catalog";
import { fmtInt } from "@/lib/format";

/**
 * Distribution of orders across all five lifecycle states.
 * Deliberately a full breakdown (not a delivered-vs-delayed binary) so the
 * in-flight, canceled, and exception states excluded from rate math stay visible.
 *
 * Each bar is colored by what the state MEANS (STATUS_COLORS mirrors the
 * lifecycle categorization in src/db/schema.ts): success teal, late amber,
 * in-flight indigo, problem red, canceled muted. The axis label and tooltip
 * carry the same information, so color is reinforcement — never the only
 * encoding.
 */
export function StatusChart({
  data,
}: {
  data: { key: string; value: number | null }[];
}) {
  // Keys arrive as raw enum tokens (page.tsx builds them from STATUSES). Keep
  // the token for the color lookup; show the human label on the axis.
  const chartData = data.map((d) => ({
    ...d,
    label: STATUS_LABELS[d.key as Status] ?? d.key,
  }));

  return (
    <div role="img" aria-label="Bar chart: orders by lifecycle status">
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
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={36}
          />
          <Tooltip
            formatter={(value) => [`${fmtInt(Number(value))} orders`, "Orders"]}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ fill: "var(--muted)" }}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            isAnimationActive={SERIES_ANIMATION_ACTIVE}
          >
            {chartData.map((d) => (
              // Canceled stays full-opacity: the muted gray already reads as
              // "out of the game" next to the saturated bars, and fading it
              // further dropped it below comfortable contrast on light cards.
              <Cell
                key={d.key}
                fill={STATUS_COLORS[d.key as Status] ?? "var(--chart-1)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
