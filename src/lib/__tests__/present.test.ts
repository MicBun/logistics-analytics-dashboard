import { describe, expect, it } from "vitest";

import {
  MAX_RANKING_GROUPS,
  chartForAnalytics,
  chartForForecast,
  groupedDisplayRows,
} from "@/lib/chart-select";
import { displayDimensionKey } from "@/lib/format";
import {
  fmtValue,
  summarizeAnalytics,
  summarizeForecast,
} from "@/lib/summarize";
import type {
  AggRow,
  AnalyticsResult,
  ForecastResult,
  MetricRow,
  ValidatedQueryParams,
} from "@/lib/types";

// --- tiny fixture builders (presentation only cares about key/value/unit) ---

function agg(over: Partial<AggRow> = {}): AggRow {
  return {
    key: "all",
    total: 0,
    delivered: 0,
    delayed: 0,
    exception: 0,
    canceled: 0,
    inTransit: 0,
    deliveredDaysSum: 0,
    valueSum: 0,
    unitsSum: 0,
    ...over,
  };
}

function row(key: string, value: number | null): MetricRow {
  return { key, value, agg: agg({ key }) };
}

function queryParams(over: Partial<ValidatedQueryParams> = {}): ValidatedQueryParams {
  return {
    metric: "order_count",
    dimension: "none",
    filters: {
      dateFrom: null,
      dateTo: null,
      carrier: null,
      region: null,
      warehouse: null,
      productCategory: null,
      status: null,
      isPromo: null,
    },
    sort: null,
    limit: null,
    relativeRange: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// fmtValue
// ---------------------------------------------------------------------------

describe("fmtValue", () => {
  it("formats each unit and null", () => {
    expect(fmtValue(0.847, "percent")).toBe("84.7%");
    expect(fmtValue(3.25, "days")).toBe("3.25 days");
    expect(fmtValue(1234.5, "usd")).toBe("$1,234.50");
    expect(fmtValue(1234, "orders")).toBe("1,234");
    expect(fmtValue(42, "units")).toBe("42");
    expect(fmtValue(null, "percent")).toBe("n/a");
  });
});

// ---------------------------------------------------------------------------
// displayDimensionKey — status tokens humanized, everything else untouched
// ---------------------------------------------------------------------------

describe("displayDimensionKey", () => {
  it("humanizes status tokens and passes other dimensions through", () => {
    expect(displayDimensionKey("in_transit", "status")).toBe("In transit");
    expect(displayDimensionKey("delivered", "status")).toBe("Delivered");
    expect(displayDimensionKey("GLS", "carrier")).toBe("GLS");
    expect(displayDimensionKey("2025-01", "month")).toBe("2025-01");
  });
});

// ---------------------------------------------------------------------------
// chartForAnalytics — chart type follows the result kind
// ---------------------------------------------------------------------------

describe("chartForAnalytics", () => {
  it("value result → 'value' chart with a single data point", () => {
    const result: AnalyticsResult = {
      kind: "value",
      metric: "order_count",
      dimension: "none",
      unit: "orders",
      rows: [row("all", 400)],
      value: 400,
    };
    const spec = chartForAnalytics(result, queryParams());
    expect(spec?.type).toBe("value");
    expect(spec?.data).toEqual([{ key: "all", value: 400 }]);
    expect(spec?.percent).toBe(false);
  });

  it("timeseries result → 'line' chart", () => {
    const result: AnalyticsResult = {
      kind: "timeseries",
      metric: "order_count",
      dimension: "month",
      unit: "orders",
      rows: [row("2025-01", 75), row("2025-02", 40)],
      value: null,
    };
    const spec = chartForAnalytics(result, queryParams({ dimension: "month" }));
    expect(spec?.type).toBe("line");
    expect(spec?.xKey).toBe("key");
    expect(spec?.data).toHaveLength(2);
  });

  it("grouped result → 'bar' chart", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "carrier",
      unit: "orders",
      rows: [row("UPS", 50), row("DHL", 30)],
      value: null,
    };
    const spec = chartForAnalytics(result, queryParams({ dimension: "carrier" }));
    expect(spec?.type).toBe("bar");
    expect(spec?.referenceLine).toBeUndefined();
  });

  it("sets percent=true for a rate metric", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "on_time_rate",
      dimension: "region",
      unit: "percent",
      rows: [row("EU", 0.9)],
      value: null,
    };
    const spec = chartForAnalytics(result, queryParams({ metric: "on_time_rate", dimension: "region" }));
    expect(spec?.percent).toBe(true);
  });

  it("adds the 95% target reference line for grouped on_time_rate", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "on_time_rate",
      dimension: "carrier",
      unit: "percent",
      rows: [row("UPS", 0.88), row("DHL", 0.81)],
      value: null,
    };
    const spec = chartForAnalytics(
      result,
      queryParams({ metric: "on_time_rate", dimension: "carrier" }),
    );
    expect(spec?.referenceLine).toEqual({ value: 0.95, label: "Target 95%" });
  });

  it("returns null when there are no rows", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "carrier",
      unit: "orders",
      rows: [],
      value: null,
    };
    expect(chartForAnalytics(result, queryParams({ dimension: "carrier" }))).toBeNull();
  });

  it("superlative (limit=1) charts the full ranking and highlights the winner", () => {
    const ranking = [row("GLS", 0.286), row("USPS", 0.239), row("UPS", 0.224)];
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "delay_rate",
      dimension: "carrier",
      unit: "percent",
      rows: [ranking[0]], // the ANSWER is just the winner...
      ranking, // ...but the chart should show the whole field
      value: null,
    };
    const spec = chartForAnalytics(
      result,
      queryParams({ metric: "delay_rate", dimension: "carrier", sort: "desc", limit: 1 }),
    );
    expect(spec?.type).toBe("bar");
    expect(spec?.data).toHaveLength(3); // all carriers, not just GLS
    expect(spec?.highlightKey).toBe("GLS");
  });

  it("humanizes status keys in grouped chart data", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "status",
      unit: "orders",
      rows: [row("delivered", 304), row("in_transit", 27)],
      value: null,
    };
    const spec = chartForAnalytics(result, queryParams({ dimension: "status" }));
    expect(spec?.data.map((d) => d.key)).toEqual(["Delivered", "In transit"]);
  });

  it("humanizes highlightKey consistently with the data keys (status superlative)", () => {
    // The renderer dims bars by comparing row key === highlightKey, so the two
    // MUST go through the same display mapping or highlighting silently breaks.
    const ranking = [row("in_transit", 27), row("exception", 11)];
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "status",
      unit: "orders",
      rows: [ranking[0]],
      ranking,
      value: null,
    };
    const spec = chartForAnalytics(
      result,
      queryParams({ dimension: "status", sort: "desc", limit: 1 }),
    );
    expect(spec?.highlightKey).toBe("In transit");
    expect(spec?.data[0].key).toBe("In transit"); // must match for the dimming
  });

  it("superlative over a single group → big number, not a lone bar", () => {
    const only = [row("UPS", 0.224)];
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "delay_rate",
      dimension: "carrier",
      unit: "percent",
      rows: only,
      ranking: only,
      value: null,
    };
    const spec = chartForAnalytics(
      result,
      queryParams({ metric: "delay_rate", dimension: "carrier", sort: "desc", limit: 1 }),
    );
    expect(spec?.type).toBe("value");
    expect(spec?.highlightKey).toBeUndefined();
  });
});

describe("groupedDisplayRows", () => {
  it("expands a limit=1 superlative to the full ranking", () => {
    const ranking = [row("GLS", 0.286), row("USPS", 0.239), row("UPS", 0.224)];
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "delay_rate",
      dimension: "carrier",
      unit: "percent",
      rows: [ranking[0]],
      ranking,
      value: null,
    };
    const out = groupedDisplayRows(result, queryParams({ sort: "desc", limit: 1 }));
    expect(out.map((r) => r.key)).toEqual(["GLS", "USPS", "UPS"]);
  });

  it("keeps exactly the requested rows for top-N (limit>1)", () => {
    const ranking = [row("A", 5), row("B", 4), row("C", 3), row("D", 2)];
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "destination_city",
      unit: "orders",
      rows: ranking.slice(0, 2),
      ranking,
      value: null,
    };
    const out = groupedDisplayRows(result, queryParams({ sort: "desc", limit: 2 }));
    expect(out.map((r) => r.key)).toEqual(["A", "B"]);
  });

  it("caps the displayed ranking at MAX_RANKING_GROUPS, keeping the winner", () => {
    const ranking = Array.from({ length: 20 }, (_, i) => row(`c${i}`, 20 - i));
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "destination_city",
      unit: "orders",
      rows: [ranking[0]],
      ranking,
      value: null,
    };
    const out = groupedDisplayRows(result, queryParams({ sort: "desc", limit: 1 }));
    expect(out).toHaveLength(MAX_RANKING_GROUPS);
    expect(out[0].key).toBe("c0");
  });
});

// ---------------------------------------------------------------------------
// chartForForecast — boundary connection
// ---------------------------------------------------------------------------

function forecastResult(over: Partial<ForecastResult> = {}): ForecastResult {
  return {
    target: "category_demand",
    category: "PAPER",
    method: "linear_regression",
    horizonMonths: 4,
    unit: "units",
    historical: [
      { month: "2025-11", value: 30 },
      { month: "2025-12", value: 36 },
    ],
    forecast: [
      { month: "2026-01", value: 40 },
      { month: "2026-02", value: 42 },
      { month: "2026-03", value: 44 },
      { month: "2026-04", value: 46 },
    ],
    recommendation: { units: 206, formula: "ceil(172 × 1.2)" },
    methodology: "linear regression; lumpy series — indicative only.",
    ...over,
  };
}

describe("chartForForecast", () => {
  it("produces a 'forecast' chart with both series", () => {
    const spec = chartForForecast(forecastResult());
    expect(spec.type).toBe("forecast");
    expect(spec.xKey).toBe("month");
    expect(spec.series.map((s) => s.dataKey)).toEqual(["historical", "forecast"]);
    expect(spec.series[1].kind).toBe("forecast");
  });

  it("connects the boundary: last historical row carries BOTH keys", () => {
    const spec = chartForForecast(forecastResult());
    // Last historical month is 2025-12 with value 36.
    const boundary = spec.data.find((d) => d.month === "2025-12");
    expect(boundary?.historical).toBe(36);
    expect(boundary?.forecast).toBe(36); // seeded so the dashed line connects
  });

  it("titles total-orders forecasts distinctly from category forecasts", () => {
    const cat = chartForForecast(forecastResult());
    expect(cat.title).toContain("PAPER demand");

    const total = chartForForecast(
      forecastResult({ target: "total_orders", category: null }),
    );
    expect(total.title).toContain("Total orders");
  });
});

// ---------------------------------------------------------------------------
// summarizeAnalytics — a couple of robust (toContain) assertions
// ---------------------------------------------------------------------------

describe("summarizeAnalytics", () => {
  it("value summary mentions the metric, filter range, and formatted value", () => {
    const result: AnalyticsResult = {
      kind: "value",
      metric: "delayed_count",
      dimension: "none",
      unit: "orders",
      rows: [row("all", 12)],
      value: 12,
    };
    const params = queryParams({
      metric: "delayed_count",
      filters: {
        dateFrom: "2025-12-01",
        dateTo: "2025-12-30",
        carrier: "UPS",
        region: null,
        warehouse: null,
        productCategory: null,
        status: null,
        isPromo: null,
      },
    });
    const s = summarizeAnalytics(result, params);
    expect(s).toContain("Delayed orders");
    expect(s).toContain("between 2025-12-01 and 2025-12-30");
    expect(s).toContain("for carrier UPS");
    expect(s).toContain("12");
  });

  it("grouped+sort+limit summary names the superlative and the runner-up", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "delay_rate",
      dimension: "carrier",
      unit: "percent",
      rows: [row("OnTrac", 0.22), row("LaserShip", 0.18)],
      value: null,
    };
    const params = queryParams({
      metric: "delay_rate",
      dimension: "carrier",
      sort: "desc",
      limit: 1,
    });
    const s = summarizeAnalytics(result, params);
    expect(s).toContain("OnTrac has the highest");
    expect(s).toContain("22.0%");
    expect(s).toContain("LaserShip");
  });

  it("humanizes status keys in grouped summaries", () => {
    const result: AnalyticsResult = {
      kind: "grouped",
      metric: "order_count",
      dimension: "status",
      unit: "orders",
      rows: [row("in_transit", 27), row("exception", 11)],
      value: null,
    };
    const s = summarizeAnalytics(result, queryParams({ dimension: "status" }));
    expect(s).toContain("In transit");
    expect(s).not.toContain("in_transit");
  });

  it("timeseries summary reports total and peak for count metrics", () => {
    const result: AnalyticsResult = {
      kind: "timeseries",
      metric: "order_count",
      dimension: "month",
      unit: "orders",
      rows: [row("2025-01", 75), row("2025-02", 40), row("2025-03", 50)],
      value: null,
    };
    const s = summarizeAnalytics(result, queryParams({ dimension: "month" }));
    expect(s).toContain("per month");
    expect(s).toContain("total 165");
    expect(s).toContain("across 3 buckets");
    expect(s).toContain("peaking at 2025-01");
  });

  it("timeseries summary averages (not sums) rate metrics", () => {
    const result: AnalyticsResult = {
      kind: "timeseries",
      metric: "on_time_rate",
      dimension: "month",
      unit: "percent",
      rows: [row("2025-01", 0.8), row("2025-02", 0.9)],
      value: null,
    };
    const s = summarizeAnalytics(result, queryParams({ metric: "on_time_rate", dimension: "month" }));
    expect(s).toContain("average 85.0%");
  });

  it("timeseries summary averages (not sums) avg_delivery_time", () => {
    // Regression: per-bucket delivery-time AVERAGES must not be summed into a
    // meaningless "total N days" headline.
    const result: AnalyticsResult = {
      kind: "timeseries",
      metric: "avg_delivery_time",
      dimension: "month",
      unit: "days",
      rows: [row("2025-01", 3.0), row("2025-02", 4.0)],
      value: null,
    };
    const s = summarizeAnalytics(
      result,
      queryParams({ metric: "avg_delivery_time", dimension: "month" }),
    );
    expect(s).toContain("average 3.50 days");
    expect(s).not.toContain("total");
  });
});

// ---------------------------------------------------------------------------
// summarizeForecast
// ---------------------------------------------------------------------------

describe("summarizeForecast", () => {
  it("states the horizon, total, breakdown and inventory recommendation", () => {
    const s = summarizeForecast(forecastResult());
    expect(s).toContain("next 4 months");
    expect(s).toContain("PAPER demand");
    expect(s).toContain("172"); // 40+42+44+46
    expect(s).toContain("Recommended inventory");
    expect(s).toContain("206");
    expect(s).toContain("safety factor");
  });
});
