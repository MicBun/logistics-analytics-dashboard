/**
 * Deterministic, templated one-liner summaries of ALREADY-COMPUTED numbers.
 *
 * Design decision: the build brief (§2) permits a second LLM call to phrase the
 * summary, but we template it instead. This is a deliberate zero-hallucination
 * choice — every number and label in the sentence comes straight from the
 * computed result, so the summary can never drift from the data it describes
 * (and it is free + instant + testable). The router still uses the LLM for the
 * hard part: interpreting the question into validated params.
 */

import { DIMENSION_LABELS, METRIC_META } from "./catalog";
import { displayDimensionKey } from "./format";
import type {
  AnalyticsResult,
  ForecastResult,
  Unit,
  ValidatedQueryParams,
} from "./types";

// ---------------------------------------------------------------------------
// Formatting (exported — the UI and tests format values through these)
// ---------------------------------------------------------------------------

/** Format a metric value for its unit. null → 'n/a' (undefined-for-bucket). */
export function fmtValue(value: number | null, unit: Unit): string {
  if (value === null) return "n/a";

  switch (unit) {
    case "percent":
      // Stored as a fraction (0..1); shown as a percentage with 1 decimal.
      return `${(value * 100).toFixed(1)}%`;
    case "days":
      return `${value.toFixed(2)} days`;
    case "usd":
      return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    case "orders":
    case "units":
      // Counts are integers; group with thousands separators.
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}

// ---------------------------------------------------------------------------
// Filter clause — describes the slice the metric was computed over
// ---------------------------------------------------------------------------

/**
 * Build a human clause for the active filters, e.g.
 *   " between 2025-12-01 and 2025-12-30 for carrier UPS".
 * Returns "" when no filters are set. Leading space included so callers can
 * splice it directly after the metric label.
 */
function filterClause(params: ValidatedQueryParams): string {
  const f = params.filters;
  const parts: string[] = [];

  // Date range: only mention the bounds that are actually set.
  if (f.dateFrom && f.dateTo) {
    parts.push(`between ${f.dateFrom} and ${f.dateTo}`);
  } else if (f.dateFrom) {
    parts.push(`from ${f.dateFrom}`);
  } else if (f.dateTo) {
    parts.push(`through ${f.dateTo}`);
  }

  // Equality filters, in a stable order.
  if (f.carrier) parts.push(`for carrier ${f.carrier}`);
  if (f.region) parts.push(`for region ${f.region}`);
  if (f.warehouse) parts.push(`for warehouse ${f.warehouse}`);
  if (f.productCategory) parts.push(`for category ${f.productCategory}`);
  if (f.status) parts.push(`with status ${f.status}`);
  if (f.isPromo !== null) {
    parts.push(f.isPromo ? "for promo orders" : "for non-promo orders");
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** Lowercase the first letter so a label reads naturally mid-sentence. */
function lc(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

// ---------------------------------------------------------------------------
// Analytics summary
// ---------------------------------------------------------------------------

export function summarizeAnalytics(
  result: AnalyticsResult,
  params: ValidatedQueryParams,
): string {
  const meta = METRIC_META[result.metric];
  const label = meta.label;
  const unit = result.unit;
  const clause = filterClause(params);

  if (result.kind === "value") {
    return `${label}${clause} was ${fmtValue(result.value, unit)}.`;
  }

  if (result.kind === "timeseries") {
    const rows = result.rows;
    const granularity =
      result.dimension === "week"
        ? "week"
        : result.dimension === "month"
          ? "month"
          : "day";

    // Average-type metrics (rates, avg delivery days) don't sum meaningfully —
    // average the buckets that have a value instead. Counts/values sum.
    const isAverageMetric = unit === "percent" || unit === "days";
    let headline: number | null;
    if (isAverageMetric) {
      const present = rows.filter((r) => r.value !== null) as {
        value: number;
      }[];
      headline =
        present.length > 0
          ? present.reduce((s, r) => s + r.value, 0) / present.length
          : null;
    } else {
      headline = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    }
    const totalLabel = isAverageMetric ? "average" : "total";

    // Peak = bucket with the highest value (nulls ignored).
    const peak = rows.reduce<(typeof rows)[number] | null>((best, r) => {
      if (r.value === null) return best;
      if (best === null || (best.value ?? -Infinity) < r.value) return r;
      return best;
    }, null);

    const peakClause = peak
      ? `, peaking at ${peak.key} (${fmtValue(peak.value, unit)})`
      : "";

    return `${label} per ${granularity}${clause}: ${totalLabel} ${fmtValue(
      headline,
      unit,
    )} across ${rows.length} buckets${peakClause}.`;
  }

  // kind === 'grouped'
  const rows = result.rows;
  const dimLabel = DIMENSION_LABELS[result.dimension];

  // Group keys are humanized for display (status tokens → "In transit") —
  // same mapping the chart and table use, so all three surfaces agree.
  if (params.sort && params.limit) {
    // Explicit ranking (e.g. "which carrier has the highest delay rate?").
    const top = rows[0];
    const superlative = params.sort === "desc" ? "highest" : "lowest";
    const second = rows[1];
    const tail = second
      ? `, followed by ${displayDimensionKey(second.key, result.dimension)} (${fmtValue(second.value, unit)})`
      : "";
    return `${displayDimensionKey(top.key, result.dimension)} has the ${superlative} ${lc(label)} at ${fmtValue(
      top.value,
      unit,
    )}${tail}.`;
  }

  // Grouped without an explicit ranking request: describe the breakdown.
  // rows are still value-sorted by default, so rows[0] is the top group.
  const top = rows[0];
  return `${label} by ${lc(dimLabel)}: top is ${displayDimensionKey(
    top.key,
    result.dimension,
  )} (${fmtValue(top.value, unit)}) across ${rows.length} groups.`;
}

// ---------------------------------------------------------------------------
// Forecast summary
// ---------------------------------------------------------------------------

export function summarizeForecast(result: ForecastResult): string {
  const unit = result.unit;
  const h = result.horizonMonths;

  const subject =
    result.target === "category_demand" && result.category
      ? `${result.category} demand`
      : "total orders";

  const sum = result.forecast.reduce((s, p) => s + p.value, 0);

  // Spell out each forecast month so the headline number is auditable.
  const breakdown = result.forecast
    .map((p) => `${p.month}: ${fmtValue(p.value, unit)}`)
    .join(", ");

  return (
    `Forecast ${subject} for the next ${h} months totals ~${fmtValue(
      sum,
      unit,
    )} ${unit} (${breakdown}). ` +
    `Recommended inventory: ${fmtValue(
      result.recommendation.units,
      unit,
    )} ${unit} (forecast sum × 1.2 safety factor).`
  );
}
