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

import type { ChartSpec, Unit } from "@/lib/types";

// Two series colors max (historical + forecast). Pulled from the theme so the
// chart matches the rest of the app in light/dark mode.
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)"] as const;

const CHART_HEIGHT = 300;
// Above this many x buckets we thin the ticks so labels stop overlapping.
const DENSE_X_THRESHOLD = 12;

/**
 * Format a y value (axis tick or tooltip) for the spec's unit / percent flag.
 * Accepts the loose value types Recharts hands its formatters (including
 * arrays, which we don't plot — those fall through to a plain string).
 */
function formatValue(
  value: number | string | readonly (number | string)[] | null | undefined,
  unit: Unit,
  percent: boolean | undefined,
): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (Number.isNaN(n)) return String(value);

  if (percent) return `${(n * 100).toFixed(1)}%`;
  if (unit === "usd") return `$${n.toLocaleString()}`;
  if (unit === "days") return `${n.toLocaleString()} d`;
  return n.toLocaleString();
}

export function DynamicChart({ spec }: { spec: ChartSpec }) {
  // Single-value answers (dimension 'none') get a big number, not a plot.
  if (spec.type === "value") {
    const v = spec.data[0]?.[spec.series[0]?.dataKey ?? "value"] ?? null;
    return (
      <div className="flex flex-col gap-1 py-2">
        <div className="text-4xl font-semibold tabular-nums">
          {formatValue(v, spec.unit, spec.percent)}
        </div>
        <div className="text-sm text-muted-foreground">{spec.title}</div>
      </div>
    );
  }

  const dense = spec.data.length > DENSE_X_THRESHOLD;

  // Shared axis/tooltip config so every chart formats y the same way.
  const yTickFormatter = (v: number) => formatValue(v, spec.unit, spec.percent);
  const tooltipFormatter = (v: unknown) =>
    formatValue(v as number | string | null, spec.unit, spec.percent);
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
      // Width must fit the widest tick label: "$…" amounts and "100.0%" both
      // overflow the 48px default (the leading "1" of 100% gets clipped).
      width={spec.unit === "usd" ? 72 : spec.percent ? 56 : 48}
    />
  );
  const tooltip = (
    <Tooltip
      formatter={tooltipFormatter}
      contentStyle={{
        fontSize: 12,
        borderRadius: 8,
        background: "var(--popover)",
        border: "1px solid var(--border)",
        color: "var(--popover-foreground)",
      }}
    />
  );
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
            {tooltip}
            {refLine}
            {spec.series.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
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
            {tooltip}
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
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
