"use client";

/**
 * Renders a server-chosen ChartSpec with Recharts.
 *
 * The chart TYPE is decided server-side from the result shape (see
 * src/lib/chart-select.ts) — this component is purely a renderer. It never
 * decides what to plot, only how. That keeps the "which chart" reasoning in one
 * deterministic place and the presentation dumb and testable.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
import { formatMetricValue } from "@/lib/format";
import type { ChartSpec } from "@/lib/types";

// Two series colors max (historical + forecast). Pulled from the theme so the
// chart matches the rest of the app in light/dark mode.
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)"] as const;

// Above this many x buckets we thin the ticks so labels stop overlapping.
const DENSE_X_THRESHOLD = 12;

export function DynamicChart({ spec }: { spec: ChartSpec }) {
  // Single-value answers (dimension 'none') get a big number, not a plot.
  if (spec.type === "value") {
    const v = spec.data[0]?.[spec.series[0]?.dataKey ?? "value"] ?? null;
    return (
      <div className="flex flex-col gap-1 py-2">
        <div className="text-4xl font-semibold tabular-nums">
          {formatMetricValue(v, spec.unit, { percent: spec.percent })}
        </div>
        <div className="text-sm text-muted-foreground">{spec.title}</div>
      </div>
    );
  }

  const dense = spec.data.length > DENSE_X_THRESHOLD;

  // Shared axis/tooltip config so every chart formats y the same way (via the
  // app-wide formatter in src/lib/format.ts — ticks compact, tooltips long).
  const yTickFormatter = (v: number) =>
    formatMetricValue(v, spec.unit, {
      percent: spec.percent,
      style: "compact",
      rateDecimals: 0,
    });
  const tooltipFormatter = (v: unknown) =>
    formatMetricValue(v as number | string | null, spec.unit, {
      percent: spec.percent,
    });
  // Percentages share a fixed 0..1 domain so small differences aren't
  // exaggerated and the reference line sits at a meaningful height.
  const yDomain: [number, number] | undefined = spec.percent ? [0, 1] : undefined;

  const xAxis = (
    <XAxis
      dataKey={spec.xKey}
      tick={{ fontSize: dense ? 10 : 12 }}
      interval={dense ? "preserveStartEnd" : 0}
      minTickGap={dense ? 16 : 5}
    />
  );
  const yAxis = (
    <YAxis
      tick={{ fontSize: 12 }}
      tickFormatter={yTickFormatter}
      domain={yDomain}
      // Width must fit the widest tick label: "$…" amounts and percent ticks
      // both overflow the 48px default.
      width={spec.unit === "usd" ? 72 : spec.percent ? 56 : 48}
    />
  );
  const tooltipProps = {
    formatter: tooltipFormatter,
    contentStyle: TOOLTIP_CONTENT_STYLE,
    labelStyle: TOOLTIP_LABEL_STYLE,
    itemStyle: TOOLTIP_ITEM_STYLE,
  };
  const refLine = spec.referenceLine ? (
    <ReferenceLine
      y={spec.referenceLine.value}
      stroke="var(--muted-foreground)"
      strokeDasharray="4 4"
      label={{
        value: spec.referenceLine.label,
        position: "insideTopRight",
        fontSize: 11,
        fill: "var(--muted-foreground)",
      }}
    />
  ) : null;

  return (
    <div className="w-full" aria-label={spec.title} role="img">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            {xAxis}
            {yAxis}
            <Tooltip {...tooltipProps} cursor={{ fill: "var(--muted)" }} />
            {refLine}
            {spec.series.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={SERIES_ANIMATION_ACTIVE}
              >
                {/* When a winner is highlighted (superlative answer), dim the
                    other bars so the answer reads at a glance. Per-cell styling
                    requires <Cell> children; set fill explicitly rather than
                    relying on inheritance from the parent <Bar>. */}
                {spec.highlightKey != null
                  ? spec.data.map((row) => (
                      <Cell
                        key={String(row[spec.xKey])}
                        fill={SERIES_COLORS[0]}
                        fillOpacity={
                          row[spec.xKey] === spec.highlightKey ? 1 : 0.3
                        }
                      />
                    ))
                  : null}
              </Bar>
            ))}
          </BarChart>
        ) : (
          // 'line' and 'forecast' share LineChart; 'forecast' just has a second,
          // dashed series for the projected points.
          <LineChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            {xAxis}
            {yAxis}
            <Tooltip {...tooltipProps} cursor={{ stroke: "var(--border)" }} />
            {refLine}
            {spec.series.map((s, i) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                strokeDasharray={s.kind === "forecast" ? "6 4" : undefined}
                dot={false}
                connectNulls
                isAnimationActive={SERIES_ANIMATION_ACTIVE}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
