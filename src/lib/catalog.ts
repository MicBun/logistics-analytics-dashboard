/**
 * The query catalog: the fixed vocabulary of metrics × dimensions × filters ×
 * granularities that the AI router is allowed to emit and the analytics
 * engine knows how to compute.
 *
 * This file is the single source of truth for every allowlist. The AI model
 * maps free-form questions INTO this vocabulary; the validation layer
 * (src/lib/validate.ts) rejects anything outside it before it can touch the
 * database. The model never emits SQL and never produces numbers.
 *
 * Dimension values (carriers, regions, …) are pinned constants derived from
 * the seeded dataset, which is read-only at runtime — so static allowlists
 * are exactly equivalent to validating against live DISTINCT queries.
 */

export const METRICS = [
  "order_count",
  "delivered_count",
  "delayed_count",
  "on_time_rate",
  "delay_rate",
  "exception_count",
  "exception_rate",
  "avg_delivery_time",
  "order_value_sum",
] as const;
export type Metric = (typeof METRICS)[number];

/** Human labels + units for each metric. Rates are FRACTIONS (0..1) in code; format as % only in the UI. */
export const METRIC_META: Record<
  Metric,
  { label: string; unit: "orders" | "days" | "percent" | "usd" }
> = {
  order_count: { label: "Total orders", unit: "orders" },
  delivered_count: { label: "Delivered orders", unit: "orders" },
  delayed_count: { label: "Delayed orders", unit: "orders" },
  on_time_rate: { label: "On-time delivery rate", unit: "percent" },
  delay_rate: { label: "Delay rate", unit: "percent" },
  exception_count: { label: "Exception orders", unit: "orders" },
  exception_rate: { label: "Exception rate", unit: "percent" },
  avg_delivery_time: { label: "Average delivery time", unit: "days" },
  order_value_sum: { label: "Total order value (gross)", unit: "usd" },
};

export const DIMENSIONS = [
  "none",
  "carrier",
  "region",
  "warehouse",
  "product_category",
  "destination_city",
  "origin_city",
  "status",
  "day",
  "week",
  "month",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Time dimensions double as granularities. `dimension ∈ TIME_DIMENSIONS` ⇒ result is a time series. */
export const TIME_DIMENSIONS = ["day", "week", "month"] as const;
export type TimeDimension = (typeof TIME_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  none: "Overall",
  carrier: "Carrier",
  region: "Region",
  warehouse: "Warehouse",
  product_category: "Product category",
  destination_city: "Destination city",
  origin_city: "Origin city",
  status: "Status",
  day: "Day",
  week: "Week",
  month: "Month",
};

// ---------------------------------------------------------------------------
// Dimension value allowlists (verified against data/mock_logistics_data.csv)
// ---------------------------------------------------------------------------

export const CARRIERS = [
  "DHL",
  "DPD",
  "FedEx",
  "GLS",
  "LaserShip",
  "OnTrac",
  "Royal Mail",
  "UPS",
  "USPS",
] as const;

export const REGIONS = ["EU", "UK", "US-C", "US-E", "US-W"] as const;

export const WAREHOUSES = [
  "AMS-FC1",
  "ATL-DC1",
  "BER-FC1",
  "CHI-DC1",
  "DFW-DC1",
  "EWR-DC1",
  "LAX-DC1",
  "LON-FC1",
  "SFO-DC2",
] as const;

export const CATEGORIES = [
  "BOOK",
  "BRUSH",
  "CRAYON",
  "MARKER",
  "PAINT",
  "PAPER",
  "PENCIL",
  "STICKER",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = [
  "delivered",
  "delayed",
  "in_transit",
  "exception",
  "canceled",
] as const;
export type Status = (typeof STATUSES)[number];

// ---------------------------------------------------------------------------
// Date handling
// ---------------------------------------------------------------------------

/** Dataset coverage (inclusive). All date filters are clamped to this window. */
export const DATA_START = "2025-01-01";
export const DATA_END = "2025-12-30";

/**
 * Anchor for relative date ranges. "Today" (real wall-clock) lies outside the
 * dataset's coverage, so relative ranges are interpreted as TRAILING WINDOWS
 * ending at the dataset's most recent order date. One uniform rule:
 *   last_month     → trailing 30 days  (2025-12-01 … 2025-12-30)
 *   last_3_months  → trailing 90 days  (2025-10-02 … 2025-12-30)
 *   last_6_months  → trailing 180 days
 *   last_n_days(N) → trailing N days
 *   this_year      → 2025-01-01 … 2025-12-30
 * This choice is surfaced in the explainability panel and documented in the
 * README. Resolution lives in src/lib/validate.ts (resolveDateRange).
 */
export const REFERENCE_DATE = DATA_END;

export const RELATIVE_RANGES = [
  "last_month",
  "last_3_months",
  "last_6_months",
  "this_year",
] as const;
export type RelativeRange = (typeof RELATIVE_RANGES)[number];

export const RELATIVE_RANGE_DAYS: Record<
  Exclude<RelativeRange, "this_year">,
  number
> = {
  last_month: 30,
  last_3_months: 90,
  last_6_months: 180,
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_LIMIT = 50;
export const DEFAULT_FORECAST_HORIZON = 4;
export const MAX_FORECAST_HORIZON = 12;
/** Safety factor applied to summed forecast demand for the inventory recommendation. */
export const SAFETY_FACTOR = 1.2;

export const FORECAST_TARGETS = ["total_orders", "category_demand"] as const;
export type ForecastTarget = (typeof FORECAST_TARGETS)[number];

export const FORECAST_METHODS = ["linear_regression", "moving_average"] as const;
export type ForecastMethod = (typeof FORECAST_METHODS)[number];

// ---------------------------------------------------------------------------
// Canned disclaimers (explainability panel / README share this wording)
// ---------------------------------------------------------------------------

export const DISCLAIMERS = {
  onTimeProxy:
    "On-time rate is a status-based proxy: delivered ÷ (delivered + delayed). The dataset has no promised/committed delivery date, so a true industry OTD cannot be computed. Exceptions are tracked separately via the exception rate. An alternative definition counting exceptions in the denominator yields 82.2% overall vs our 84.7%; we use one definition consistently.",
  rateExclusions:
    "In-flight (in_transit) and canceled orders are excluded from all rate and delivery-time math — they have no delivery outcome (their delivery_date is null).",
  grossValue:
    "Order value is gross (quantity × unit price). Promo discounts are not applied to it.",
  relativeDates: `Relative date ranges are trailing windows anchored to the dataset's last order date (${REFERENCE_DATE}), since today's real date lies outside the dataset coverage.`,
  forecastConfidence:
    "The monthly series is lumpy (Jan = 75 orders, Sep = 18), so forecasts are indicative, not precise. Treat them as directional planning inputs.",
} as const;
