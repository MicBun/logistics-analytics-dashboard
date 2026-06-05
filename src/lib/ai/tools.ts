/**
 * Anthropic tool definitions — the routing vocabulary the model is allowed to emit.
 *
 * The model NEVER writes SQL and NEVER produces numbers. Its only job is to map a
 * free-form question onto exactly one of these two tool calls, filling a typed
 * parameter object. Validation (src/lib/validate.ts) then checks every value against
 * the catalog allowlists before any database access.
 *
 * Enums are built FROM the catalog constants (spread) rather than retyped, so the
 * tool schemas and the validation allowlists can never drift apart — there is a
 * single source of truth.
 *
 * The DESCRIPTIONS are the routing-quality lever: Haiku decides which tool to call
 * and how to fill it almost entirely from the prose here, so they are deliberately
 * prescriptive with trigger phrases and worked question→params examples.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  CARRIERS,
  CATEGORIES,
  DIMENSIONS,
  FORECAST_METHODS,
  FORECAST_TARGETS,
  METRICS,
  REGIONS,
  RELATIVE_RANGES,
  STATUSES,
  WAREHOUSES,
} from "@/lib/catalog";

/** Time dimensions double as the granularity of a time series. */
const GRANULARITIES = ["day", "week", "month"] as const;

const queryAnalytics: Anthropic.Tool = {
  name: "query_analytics",
  description: `Compute a descriptive/diagnostic analytics metric over the logistics order dataset, optionally grouped by a dimension or time bucket and filtered. Call this for ANY question about counts, rates, averages, totals, rankings, breakdowns, or trends of orders.

WHEN TO CALL: the user asks "how many", "what is the rate of", "which X has the most/highest/lowest", "show me ... by carrier/region/warehouse/category/status/city", "... over time / by month / by week", "top N ...", "average delivery time", "on-time rate", "total order value", etc.

METRIC SELECTION (pick exactly one):
- "late", "overdue", "delayed", "delivered late" → status-based delayed metrics: delayed_count (how many) or delay_rate (what fraction).
- "on-time", "on time delivery", "SLA hit rate" → on_time_rate.
- "exceptions", "problem orders", "failed deliveries" → exception_count or exception_rate.
- "delivered" (count of successful) → delivered_count.
- "how many orders", "order volume", "number of orders", "total orders" → order_count.
- "how fast", "delivery speed", "average delivery time", "days to deliver" → avg_delivery_time.
- "revenue", "order value", "how much", "total value", "sales" → order_value_sum (gross value).

DIMENSION = the group-by. Use 'none' for a single overall number. Use a categorical dimension (carrier, region, warehouse, product_category, destination_city, origin_city, status) for a breakdown/ranking. Use a TIME dimension (day, week, month) for a trend over time — a time dimension IS the granularity, so set dimension=week for a weekly series (you do not also need 'granularity').

SORT + LIMIT express superlatives and top-N: "highest"/"most"/"worst"/"top" → sort=desc; "lowest"/"least"/"best on-time" → sort=asc; "the carrier with..." / "top 5" → set limit (1 for a single winner, N for top-N). Only meaningful with a categorical dimension.

FILTERS: relative_range maps "last month"→last_month, "last 3 months"→last_3_months, "last 6 months"→last_6_months, "this year"/"in 2025"→this_year. For an explicit span or named months use date_from/date_to (yyyy-mm-dd) — e.g. "in December 2025" → date_from=2025-12-01, date_to=2025-12-30; "October–December 2025" → date_from=2025-10-01, date_to=2025-12-30 (the dataset ends 2025-12-30). For "last N days" use last_n_days. Equality filters: carrier, region, warehouse, product_category, status, is_promo (true for promo orders). Only metric is required; omit anything not asked for.

EXAMPLE MAPPINGS:
- "Which carrier has the highest delay rate?" → metric=delay_rate, dimension=carrier, sort=desc, limit=1.
- "How many orders were delivered late last month?" → metric=delayed_count, filters.relative_range=last_month.
- "Show delayed orders by week for the last 3 months" → metric=delayed_count, dimension=week, filters.relative_range=last_3_months.
- "Show delayed orders by week for October–December 2025" → metric=delayed_count, dimension=week, filters.date_from=2025-10-01, filters.date_to=2025-12-30.
- "How many orders were delivered late in December 2025?" → metric=delayed_count, filters.date_from=2025-12-01, filters.date_to=2025-12-30.
- "On-time rate by region" → metric=on_time_rate, dimension=region.
- "Top 5 destinations by orders" → metric=order_count, dimension=destination_city, sort=desc, limit=5.
- "Order volume over time" → metric=order_count, dimension=month.
- "How many promo orders?" → metric=order_count, filters.is_promo=true.
- "Total revenue from PAPER" → metric=order_value_sum, filters.product_category=PAPER.`,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["metric"],
    properties: {
      metric: {
        type: "string",
        enum: [...METRICS],
        description: "The single quantity to compute. Required.",
      },
      dimension: {
        type: "string",
        enum: [...DIMENSIONS],
        description:
          "Group-by. 'none' = one overall number; categorical = breakdown/ranking; day|week|month = time series. Default 'none'.",
      },
      granularity: {
        type: "string",
        enum: [...GRANULARITIES],
        description:
          "Time bucket size for a trend. Redundant when dimension is already day|week|month; prefer setting the time dimension directly.",
      },
      sort: {
        type: "string",
        enum: ["asc", "desc"],
        description:
          "Order the grouped results by the metric. desc for highest/most/worst, asc for lowest/least.",
      },
      limit: {
        type: "integer",
        description: "Keep only the top-N rows after sorting (1 for a single winner).",
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          date_from: {
            type: "string",
            description: "Inclusive start date, yyyy-mm-dd.",
          },
          date_to: {
            type: "string",
            description: "Inclusive end date, yyyy-mm-dd.",
          },
          relative_range: {
            type: "string",
            enum: [...RELATIVE_RANGES],
            description:
              "Trailing window anchored to the dataset's last day. Use for 'last month', 'last 3 months', 'this year', etc.",
          },
          last_n_days: {
            type: "integer",
            description: "Trailing window of N days. Use for 'last N days'.",
          },
          carrier: { type: "string", enum: [...CARRIERS] },
          region: { type: "string", enum: [...REGIONS] },
          warehouse: { type: "string", enum: [...WAREHOUSES] },
          product_category: { type: "string", enum: [...CATEGORIES] },
          status: { type: "string", enum: [...STATUSES] },
          is_promo: {
            type: "boolean",
            description: "true to restrict to promotional orders.",
          },
        },
      },
    },
  },
};

const forecastDemand: Anthropic.Tool = {
  name: "forecast_demand",
  description: `Project future monthly demand from the 12 observed 2025 monthly aggregates and return an inventory recommendation. Call this for forward-looking questions, NOT historical ones.

WHEN TO CALL: the user asks to "forecast", "predict", "project", "estimate next quarter/month", "how much should we stock/order", "expected demand", "demand planning", or "inventory recommendation".

TARGET: use total_orders to forecast overall order volume. Use category_demand (and set the category) when the user names a product category — e.g. "forecast PAINT demand". If the user names a specific SKU (like PAPER-0123), pass it in the sku field; the system resolves the SKU to its product category and forecasts at the category level, because per-SKU history is too sparse to forecast.

HORIZON: horizon_months is how many months ahead of the dataset's last month (2025-12). "next quarter" → 3, "next half year" → 6. A NAMED future range converts to a month count after 2025-12: "first 4 months of 2026" / "Jan–Apr 2026" → 4; "first half of 2026" → 6. If the user does NOT state a horizon, OMIT horizon_months entirely — the system defaults to 4 months. NEVER ask the user to pick a horizon; the default exists precisely so you can answer immediately.

METHOD: linear_regression (default — a trend line) or moving_average (smooths recent months). Pick moving_average only if the user explicitly asks for a moving average or "recent average".

EXAMPLE MAPPINGS:
- "Forecast order volume for the next 3 months" → target=total_orders, horizon_months=3.
- "How many PAINT units will we need next quarter?" → target=category_demand, category=PAINT, horizon_months=3.
- "Predict demand for SKU PAPER-0123" → sku=PAPER-0123 (resolved to its category; target=category_demand).
- "What's the inventory recommendation for STICKER for the next 6 months?" → target=category_demand, category=STICKER, horizon_months=6.
- "How much inventory should I plan for CRAYON?" → target=category_demand, category=CRAYON (no horizon stated → omit horizon_months, default applies).
- "Forecast PAPER demand for the first 4 months of 2026" → target=category_demand, category=PAPER, horizon_months=4.
- "Project demand using a moving average" → target=total_orders, method=moving_average.`,
  input_schema: {
    type: "object",
    additionalProperties: false,
    // No required fields: validation defaults target to total_orders and, when a
    // sku is given, resolves it to a category.
    properties: {
      target: {
        type: "string",
        enum: [...FORECAST_TARGETS],
        description:
          "total_orders for overall volume, category_demand for a single product category.",
      },
      category: {
        type: "string",
        enum: [...CATEGORIES],
        description: "Required when target=category_demand.",
      },
      sku: {
        type: "string",
        description:
          "A specific SKU the user named. The system resolves it to its product category and forecasts that category.",
      },
      horizon_months: {
        type: "integer",
        description: "Months to forecast ahead. Default 4.",
      },
      method: {
        type: "string",
        enum: [...FORECAST_METHODS],
        description: "Forecasting method. Default linear_regression.",
      },
    },
  },
};

/** The full tool list handed to the Anthropic Messages API. */
export const TOOLS: Anthropic.Tool[] = [queryAnalytics, forecastDemand];
