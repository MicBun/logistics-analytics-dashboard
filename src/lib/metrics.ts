/**
 * Pure metric computation over a single aggregation bucket (AggRow).
 *
 * This module is the deterministic source of truth for every KPI. It has NO
 * database import: it operates only on already-aggregated counts/sums, so it is
 * trivially unit-testable and reusable by both the dashboard and the NL query
 * path. The exact formulas are locked in docs/.plan.md §4 and the AggRow doc
 * block in types.ts — keep them identical there.
 *
 * Cross-cutting rule (§4): in-flight (`in_transit`) and canceled orders have no
 * delivery outcome, so they are excluded from every rate and delivery-time
 * metric BY CONSTRUCTION of the denominators below (we never put them in a
 * denominator). They surface only as their own informational counts.
 *
 * Rates are FRACTIONS in [0..1]; only the UI formats them as percentages.
 */

import { METRIC_META, type Metric } from "./catalog";
import type { AggRow, DashboardKpis, Unit } from "./types";

/**
 * Safe division: returns null when the denominator is 0 so callers render an
 * honest "—" instead of NaN/Infinity. A metric is genuinely undefined for a
 * bucket with no qualifying rows (e.g. on-time rate for a carrier that has only
 * in-transit orders), and null carries that meaning explicitly.
 */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Compute one metric for one aggregation bucket. Returns null when the metric's
 * denominator is 0 (no qualifying rows). See the AggRow doc block in types.ts
 * for the authoritative formula list.
 */
export function computeMetric(agg: AggRow, metric: Metric): number | null {
  switch (metric) {
    case "order_count":
      // All placed orders, including canceled — a cancellation is still demand.
      return agg.total;
    case "delivered_count":
      return agg.delivered;
    case "delayed_count":
      return agg.delayed;
    case "exception_count":
      return agg.exception;
    case "on_time_rate":
      // Status-based proxy: delivered ÷ (delivered + delayed). No promised date
      // exists in the dataset, so a true OTD is not computable (see README).
      return ratio(agg.delivered, agg.delivered + agg.delayed);
    case "delay_rate":
      // Shares the on-time denominator so the two rates sum to 1 over outcomes.
      return ratio(agg.delayed, agg.delivered + agg.delayed);
    case "exception_rate":
      // Exceptions are measured against ALL orders, not just settled ones, so
      // the rate reflects how often any order ends in an exception.
      return ratio(agg.exception, agg.total);
    case "avg_delivery_time":
      // Delivered rows only — delayed/exception have their own (slower) profiles
      // and blending them would distort the "normal fulfillment speed" headline.
      return ratio(agg.deliveredDaysSum, agg.delivered);
    case "order_value_sum":
      // Gross (quantity × unit price); promo discounts are not applied (§4).
      return agg.valueSum;
  }
}

/** Unit for a metric, sourced from the single catalog table (no duplication). */
export function metricUnit(metric: Metric): Unit {
  return METRIC_META[metric].unit;
}

/**
 * Derive the full dashboard KPI set from one overall (dimension='none') AggRow.
 * Reuses computeMetric so the cards and the NL answers can never diverge.
 * openOrders/canceledOrders are informational counts, deliberately kept out of
 * the rate math above.
 */
export function deriveKpis(agg: AggRow): DashboardKpis {
  return {
    totalOrders: agg.total,
    deliveredOrders: agg.delivered,
    delayedOrders: agg.delayed,
    onTimeRate: computeMetric(agg, "on_time_rate"),
    avgDeliveryTime: computeMetric(agg, "avg_delivery_time"),
    exceptionRate: computeMetric(agg, "exception_rate"),
    openOrders: agg.inTransit,
    canceledOrders: agg.canceled,
  };
}
