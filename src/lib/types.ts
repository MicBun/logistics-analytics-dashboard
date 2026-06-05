/**
 * Shared type contracts for the whole app.
 *
 * Data flow (the AI-as-router pattern):
 *
 *   question ──► AI interpretation (src/lib/ai/router.ts — Anthropic tool use,
 *                emits RAW params only: no SQL, no numbers)
 *            ──► validation (src/lib/validate.ts — allowlists, clamping)
 *            ──► computation (src/lib/analytics.ts Drizzle parameterized
 *                queries / src/lib/forecast.ts deterministic math)
 *            ──► presentation (src/lib/chart-select.ts + src/lib/summarize.ts)
 *            ──► AnswerEnvelope (the validated params double as the
 *                explainability "query plan")
 *
 * Module responsibilities & required exports (implementations code against
 * these signatures — keep them exact):
 *
 * src/lib/validate.ts (PURE — no db import):
 *   validateQueryParams(raw: unknown): Validation<ValidatedQueryParams>
 *   validateForecastParams(raw: unknown): Validation<ValidatedForecastParams>
 *   resolveDateRange(f: { date_from?: string; date_to?: string; relative_range?: string; last_n_days?: number }):
 *     { from: string | null; to: string | null; warnings: string[]; relativeRange: string | null } | { error: string }
 *
 * src/lib/metrics.ts (PURE — no db import):
 *   computeMetric(agg: AggRow, metric: Metric): number | null   // exact formulas below
 *   metricUnit(metric: Metric): Unit
 *   deriveKpis(agg: AggRow): DashboardKpis
 *
 * src/lib/analytics.ts (DB — imports getDb()):
 *   runAnalyticsQuery(params: ValidatedQueryParams): Promise<AnalyticsResult>
 *   getMonthlySeries(params: ValidatedForecastParams): Promise<MonthlyPoint[]>  // 12 points, zero-filled
 *
 * src/lib/forecast.ts (PURE — no db import):
 *   buildForecast(historical: MonthlyPoint[], params: ValidatedForecastParams): ForecastResult
 *
 * src/lib/chart-select.ts (PURE):
 *   chartForAnalytics(result: AnalyticsResult, params: ValidatedQueryParams): ChartSpec | null
 *   chartForForecast(result: ForecastResult): ChartSpec
 *
 * src/lib/summarize.ts (PURE):
 *   summarizeAnalytics(result: AnalyticsResult, params: ValidatedQueryParams): string
 *   summarizeForecast(result: ForecastResult): string
 *
 * src/lib/ai/router.ts:
 *   answerQuestion(question: string): Promise<AnswerEnvelope>
 */

import type {
  Category,
  Dimension,
  ForecastMethod,
  ForecastTarget,
  Metric,
  Status,
} from "./catalog";

export type Unit = "orders" | "days" | "percent" | "usd" | "units";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type Validation<T> =
  | { ok: true; params: T; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validated, normalized analytics query — the explainability "query plan".
 * Invariants guaranteed by validate.ts:
 * - every enum checked against catalog allowlists;
 * - dates resolved (relative → absolute) and clamped to DATA_START..DATA_END;
 * - if a time granularity was given with dimension 'none', dimension is set to
 *   that granularity; a time dimension IS the granularity;
 * - limit clamped to 1..MAX_LIMIT; sort ignored (with warning) when dimension
 *   is 'none'.
 */
export interface ValidatedQueryParams {
  metric: Metric;
  dimension: Dimension;
  filters: {
    /** ISO yyyy-mm-dd, inclusive, clamped. null = unbounded (full dataset). */
    dateFrom: string | null;
    dateTo: string | null;
    carrier: string | null;
    region: string | null;
    warehouse: string | null;
    productCategory: Category | null;
    status: Status | null;
    isPromo: boolean | null;
  };
  sort: "asc" | "desc" | null;
  limit: number | null;
  /** Provenance: the relative range keyword the dates were resolved from, if any. */
  relativeRange: string | null;
}

export interface ValidatedForecastParams {
  target: ForecastTarget;
  /** Required (non-null) when target === 'category_demand'. */
  category: Category | null;
  /** 1..MAX_FORECAST_HORIZON, default DEFAULT_FORECAST_HORIZON. */
  horizonMonths: number;
  method: ForecastMethod;
  granularity: "month";
  /** When the user asked about a SKU: the SKU we resolved to its category (with a warning). */
  resolvedFromSku: string | null;
}

// ---------------------------------------------------------------------------
// Analytics computation
// ---------------------------------------------------------------------------

/**
 * One aggregation bucket as returned by the single SQL shape in analytics.ts.
 * All numbers are plain JS numbers (cast from SQL counts/sums).
 *
 * Metric formulas over an AggRow (implemented in metrics.ts — keep exact):
 *   order_count        = total            (all rows incl. canceled — they were placed)
 *   delivered_count    = delivered
 *   delayed_count      = delayed
 *   exception_count    = exception
 *   on_time_rate       = delivered / (delivered + delayed)      — null if denom 0
 *   delay_rate         = delayed   / (delivered + delayed)      — null if denom 0
 *   exception_rate     = exception / total                      — null if total 0
 *   avg_delivery_time  = deliveredDaysSum / delivered           — null if delivered 0  (days, delivered only)
 *   order_value_sum    = valueSum                               (gross)
 * Rates are fractions (0..1). In-flight & canceled orders are excluded from
 * rate/time math BY CONSTRUCTION of these formulas (per docs/.plan.md §4).
 */
export interface AggRow {
  /** Group key: dimension value, or time-bucket label, or 'all' when dimension='none'. */
  key: string;
  total: number;
  delivered: number;
  delayed: number;
  exception: number;
  canceled: number;
  inTransit: number;
  /** Σ (delivery_date − order_date) in days over delivered rows only. */
  deliveredDaysSum: number;
  /** Σ order_value_usd (gross). */
  valueSum: number;
  /** Σ quantity. */
  unitsSum: number;
}

export interface MetricRow {
  key: string;
  /** computeMetric(agg, metric) — null when the metric is undefined for the bucket. */
  value: number | null;
  agg: AggRow;
}

/**
 * Result of runAnalyticsQuery.
 * - kind 'value':      dimension='none'. rows has exactly 1 entry (key 'all'); value = rows[0].value.
 * - kind 'timeseries': dimension ∈ day|week|month. rows sorted by key asc and
 *   GAP-FILLED with zero buckets between the resolved range bounds
 *   (intersection of date filters and dataset coverage). Bucket labels:
 *   day 'YYYY-MM-DD', week = ISO week start 'YYYY-MM-DD', month 'YYYY-MM'.
 * - kind 'grouped':    categorical dimension. rows sorted by params.sort on
 *   value (nulls last) or value desc by default; params.limit applied.
 *   `ranking` holds the FULL sorted group list before the limit cut, so a
 *   superlative ("highest", limit=1) can be answered by `rows` but charted/
 *   tabulated against the whole field for context.
 */
export interface AnalyticsResult {
  kind: "value" | "grouped" | "timeseries";
  metric: Metric;
  dimension: Dimension;
  unit: Unit;
  rows: MetricRow[];
  value: number | null;
  /** grouped only: the full sorted ranking before params.limit was applied. */
  ranking?: MetricRow[];
}

export interface DashboardKpis {
  totalOrders: number;
  deliveredOrders: number;
  delayedOrders: number;
  /** Fraction 0..1. */
  onTimeRate: number | null;
  /** Days, delivered only. */
  avgDeliveryTime: number | null;
  /** Fraction 0..1, denominator = all orders. */
  exceptionRate: number | null;
  /** in_transit count — informational card, excluded from rate math. */
  openOrders: number;
  canceledOrders: number;
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

/** month: 'YYYY-MM'. value: order count (total_orders) or units (category_demand). */
export interface MonthlyPoint {
  month: string;
  value: number;
}

export interface ForecastResult {
  target: ForecastTarget;
  category: Category | null;
  method: ForecastMethod;
  horizonMonths: number;
  unit: "orders" | "units";
  /** The 12 observed 2025 months (zero-filled). */
  historical: MonthlyPoint[];
  /** horizonMonths points continuing after 2025-12 (2026-01, …); clamped ≥ 0, rounded to integers. */
  forecast: MonthlyPoint[];
  /** ceil(Σ forecast × SAFETY_FACTOR) plus the formula spelled out. */
  recommendation: { units: number; formula: string };
  /** Plain-language method note INCLUDING the lumpy-data confidence caveat. */
  methodology: string;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Renderer-agnostic chart description; src/components/ask/dynamic-chart.tsx
 * renders it with Recharts. Chart type is chosen from the RESULT SHAPE:
 *   value → 'value' (big number, no axes); timeseries → 'line';
 *   grouped/ranking → 'bar'; forecast → 'forecast' (historical+forecast line).
 */
export interface ChartSpec {
  type: "line" | "bar" | "value" | "forecast";
  title: string;
  /** Key into data rows used for the x axis (e.g. 'key' or 'month'). */
  xKey: string;
  /** One entry per plotted series; 'forecast'-kind series render dashed. */
  series: { dataKey: string; label: string; kind?: "historical" | "forecast" }[];
  data: Record<string, string | number | null>[];
  /** Format y values as percentages (values are fractions 0..1). */
  percent?: boolean;
  unit: Unit;
  /** Optional benchmark line (e.g. 95% on-time target). Value in same scale as data. */
  referenceLine?: { value: number; label: string };
  /** Bar charts only: the x-key whose bar is emphasized (e.g. the superlative winner). */
  highlightKey?: string;
}

// ---------------------------------------------------------------------------
// The envelope returned by POST /api/query — UI renders ONLY from this.
// ---------------------------------------------------------------------------

export interface AnswerTable {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface AnswerEnvelope {
  kind: "analytics" | "forecast" | "unsupported" | "error";
  question: string;
  /** Which tool the AI selected; null when it (correctly) declined. */
  tool: "query_analytics" | "forecast_demand" | null;
  /** The validated params — THE query plan shown in the explainability panel. */
  params: ValidatedQueryParams | ValidatedForecastParams | null;
  /** Validation/clamping/fallback notes (e.g. "SKU X → category PAPER"). */
  warnings: string[];
  /** Deterministic, templated one-liner about the computed numbers. */
  summary: string;
  /** Metric-dependent caveats (on-time proxy, gross value, relative-date anchor…). */
  disclaimers: string[];
  chart: ChartSpec | null;
  /** Underlying data for the explainability panel. */
  table: AnswerTable | null;
  analytics?: AnalyticsResult;
  forecast?: ForecastResult;
  /** For kind 'unsupported' | 'error': human-readable explanation + what IS supported. */
  message?: string;
}
