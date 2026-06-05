/**
 * Presentation selection (pure): turn a computed result into a renderer-agnostic
 * ChartSpec. The chart TYPE is derived from the RESULT SHAPE, not from the
 * question — single value → big number, time series → line, categorical → bar,
 * forecast → the dedicated historical+forecast view (docs/.plan.md §8).
 *
 * No data is recomputed here: rows arrive already sorted/limited/gap-filled from
 * analytics.ts and forecast.ts. We only reshape them for the chart renderer.
 */

import { DIMENSION_LABELS, METRIC_META } from "./catalog";
import type {
  AnalyticsResult,
  ChartSpec,
  ForecastResult,
  MetricRow,
  ValidatedQueryParams,
} from "./types";

/** Above this many groups a ranking chart/table is capped for readability. */
export const MAX_RANKING_GROUPS = 12;

/**
 * The rows to DISPLAY for a grouped result (shared by the chart and the
 * explainability table so they always agree).
 *
 * A superlative question ("which carrier has the highest delay rate?") resolves
 * to limit=1, so the ANSWER (`result.rows`) is a single winner — but a lone bar
 * conveys nothing. For that case we show the full sorted ranking (capped),
 * letting the reader see *how much* the winner leads. Every other limit shows
 * exactly the rows that were asked for ("top 5" → 5 bars). The answer set is
 * never altered; this only affects presentation.
 */
export function groupedDisplayRows(
  result: AnalyticsResult,
  params: ValidatedQueryParams,
): MetricRow[] {
  const ranking = result.ranking ?? result.rows;
  if (params.limit === 1 && ranking.length > 1) {
    return ranking.slice(0, MAX_RANKING_GROUPS);
  }
  return result.rows;
}

export function chartForAnalytics(
  result: AnalyticsResult,
  params: ValidatedQueryParams,
): ChartSpec | null {
  // No rows means nothing to plot — the caller renders the summary/table only.
  if (result.rows.length === 0) return null;

  const metricLabel = METRIC_META[result.metric].label;
  // Rates are fractions in code; the renderer multiplies by 100 when this is set.
  const percent = result.unit === "percent";

  // Common reshape: every analytics row plots a single { key, value } point.
  const data = result.rows.map((r) => ({ key: r.key, value: r.value }));

  if (result.kind === "value") {
    // Single aggregate (dimension 'none'): a KPI-style big number, no axes.
    return {
      type: "value",
      title: metricLabel,
      xKey: "key",
      series: [{ dataKey: "value", label: metricLabel }],
      data,
      percent,
      unit: result.unit,
    };
  }

  const title = `${metricLabel} by ${DIMENSION_LABELS[result.dimension]}`;

  if (result.kind === "timeseries") {
    // Already sorted ascending and gap-filled by analytics.ts.
    return {
      type: "line",
      title,
      xKey: "key",
      series: [{ dataKey: "value", label: metricLabel }],
      data,
      percent,
      unit: result.unit,
    };
  }

  // kind === 'grouped' — categorical breakdown / ranking.
  const displayRows = groupedDisplayRows(result, params);
  const groupedData = displayRows.map((r) => ({ key: r.key, value: r.value }));

  // A single group offers nothing to compare against — a one-bar chart is just
  // noise. Render the scalar as a big number instead (the question already has
  // a clear textual answer; the explainability table still lists the figure).
  if (displayRows.length <= 1) {
    return {
      type: "value",
      title: metricLabel,
      xKey: "key",
      series: [{ dataKey: "value", label: metricLabel }],
      data: groupedData,
      percent,
      unit: result.unit,
    };
  }

  const spec: ChartSpec = {
    type: "bar",
    title,
    xKey: "key",
    series: [{ dataKey: "value", label: metricLabel }],
    data: groupedData,
    percent,
    unit: result.unit,
  };

  // Superlative (limit=1): the winner is the answer, so emphasize its bar within
  // the full field. result.rows[0] is the single answer row.
  if (params.limit === 1 && result.rows.length > 0) {
    spec.highlightKey = result.rows[0].key;
  }

  // The on-time chart carries a 95% target line for visual context — our data
  // lands ~85%, so the gap is the informative part (docs/.plan.md §8).
  if (params.metric === "on_time_rate") {
    spec.referenceLine = { value: 0.95, label: "Target 95%" };
  }

  return spec;
}

export function chartForForecast(result: ForecastResult): ChartSpec {
  // Two distinct series on shared months: solid historical line + dashed forecast.
  const historicalData = result.historical.map((p) => ({
    month: p.month,
    historical: p.value,
  }));
  const forecastData = result.forecast.map((p) => ({
    month: p.month,
    forecast: p.value,
  }));

  const data: Record<string, string | number | null>[] = [
    ...historicalData,
    ...forecastData,
  ];

  // Seed the forecast series on the LAST historical month so the dashed line
  // starts where the solid line ends — otherwise there is a visual gap at the
  // boundary. Both keys live on that one row.
  if (historicalData.length > 0) {
    const lastHistorical = data[historicalData.length - 1];
    lastHistorical.forecast = lastHistorical.historical;
  }

  // Title reflects what is being forecast: a named category or total orders.
  const subject =
    result.target === "category_demand" && result.category
      ? `${result.category} demand`
      : "Total orders";
  const title = `${subject} — history + ${result.horizonMonths}-month forecast`;

  return {
    type: "forecast",
    title,
    xKey: "month",
    series: [
      { dataKey: "historical", label: "Historical", kind: "historical" },
      { dataKey: "forecast", label: "Forecast", kind: "forecast" },
    ],
    data,
    unit: result.unit,
  };
}
