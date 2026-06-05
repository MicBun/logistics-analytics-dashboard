import { describe, expect, it } from "vitest";

import {
  resolveDateRange,
  validateForecastParams,
  validateQueryParams,
} from "@/lib/validate";

// Helper: assert ok and narrow the union so we can read `.params`/`.warnings`.
function expectOk<T extends { ok: boolean }>(
  res: T,
): Extract<T, { ok: true }> {
  expect(res.ok).toBe(true);
  return res as Extract<T, { ok: true }>;
}

describe("resolveDateRange — relative ranges (trailing windows)", () => {
  it("last_month resolves to 2025-12-01..2025-12-30 (30-day trailing window)", () => {
    const r = resolveDateRange({ relative_range: "last_month" });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.from).toBe("2025-12-01");
    expect(r.to).toBe("2025-12-30");
    expect(r.relativeRange).toBe("last_month");
  });

  it("last_3_months resolves to 2025-10-02..2025-12-30 (90-day trailing window)", () => {
    const r = resolveDateRange({ relative_range: "last_3_months" });
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBe("2025-10-02");
    expect(r.to).toBe("2025-12-30");
    expect(r.relativeRange).toBe("last_3_months");
  });

  it("last_6_months resolves to 2025-07-04..2025-12-30 (180-day trailing window)", () => {
    const r = resolveDateRange({ relative_range: "last_6_months" });
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBe("2025-07-04");
    expect(r.to).toBe("2025-12-30");
  });

  it("this_year spans the full dataset coverage", () => {
    const r = resolveDateRange({ relative_range: "this_year" });
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBe("2025-01-01");
    expect(r.to).toBe("2025-12-30");
    expect(r.relativeRange).toBe("this_year");
  });

  it("last_n_days is a trailing window ending at the reference date, clamped 1..365", () => {
    const r = resolveDateRange({ last_n_days: 7 });
    if ("error" in r) throw new Error(r.error);
    // 7-day inclusive window ending 2025-12-30 ⇒ minus 6 days ⇒ 2025-12-24.
    expect(r.from).toBe("2025-12-24");
    expect(r.to).toBe("2025-12-30");
    expect(r.relativeRange).toBe("last_7_days");

    const big = resolveDateRange({ last_n_days: 9999 });
    if ("error" in big) throw new Error(big.error);
    expect(big.relativeRange).toBe("last_365_days");
  });

  it("warns when both relative and absolute dates are given, and the relative wins", () => {
    const r = resolveDateRange({
      relative_range: "last_month",
      date_from: "2025-01-01",
      date_to: "2025-06-30",
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBe("2025-12-01");
    expect(r.warnings.some((w) => w.toLowerCase().includes("ignoring"))).toBe(true);
  });
});

describe("resolveDateRange — absolute dates", () => {
  it("clamps out-of-range absolute dates into the dataset window with a warning", () => {
    const r = resolveDateRange({ date_from: "2024-01-01", date_to: "2099-12-31" });
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBe("2025-01-01");
    expect(r.to).toBe("2025-12-30");
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes("2025-01-01"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("2025-12-30"))).toBe(true);
  });

  it("rejects from > to", () => {
    const r = resolveDateRange({ date_from: "2025-06-01", date_to: "2025-03-01" });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toMatch(/after/i);
    }
  });

  it("rejects garbage / non-ISO dates with an error", () => {
    expect("error" in resolveDateRange({ date_from: "not-a-date" })).toBe(true);
    expect("error" in resolveDateRange({ date_from: "2025-13-01" })).toBe(true); // bad month
    expect("error" in resolveDateRange({ date_from: "2025-02-30" })).toBe(true); // overflow day
  });

  it("returns null/null with no warning when nothing is given (full dataset)", () => {
    const r = resolveDateRange({});
    if ("error" in r) throw new Error(r.error);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.relativeRange).toBeNull();
    expect(r.warnings).toEqual([]);
  });
});

describe("validateQueryParams — enums & messages", () => {
  it("accepts a minimal valid query", () => {
    const res = expectOk(validateQueryParams({ metric: "order_count" }));
    expect(res.params.metric).toBe("order_count");
    expect(res.params.dimension).toBe("none");
  });

  it("rejects an unknown carrier with a message listing the allowed carriers", () => {
    const res = validateQueryParams({
      metric: "order_count",
      filters: { carrier: "Aramex" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Message must enumerate the 9 allowed carriers.
      expect(res.error).toContain("DHL");
      expect(res.error).toContain("FedEx");
      expect(res.error).toContain("Royal Mail");
      expect(res.error).toContain("USPS");
    }
  });

  it("rejects an unknown metric", () => {
    const res = validateQueryParams({ metric: "profit_margin" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("order_count");
  });

  it("requires a metric", () => {
    const res = validateQueryParams({});
    expect(res.ok).toBe(false);
  });
});

describe("validateQueryParams — granularity / dimension normalization", () => {
  it("promotes granularity to the dimension when dimension is missing", () => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", granularity: "month" }),
    );
    expect(res.params.dimension).toBe("month");
  });

  it("promotes granularity to the dimension when dimension is 'none'", () => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", dimension: "none", granularity: "week" }),
    );
    expect(res.params.dimension).toBe("week");
  });

  it("dimension wins (with a warning) when a different granularity is also given", () => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", dimension: "week", granularity: "day" }),
    );
    expect(res.params.dimension).toBe("week");
    expect(res.warnings.some((w) => w.includes("week"))).toBe(true);
  });

  it("rejects a non-time granularity", () => {
    const res = validateQueryParams({ metric: "order_count", granularity: "carrier" });
    expect(res.ok).toBe(false);
  });
});

describe("validateQueryParams — sort & limit", () => {
  it("clamps limit into 1..MAX_LIMIT with a warning", () => {
    const res = expectOk(
      validateQueryParams({
        metric: "order_count",
        dimension: "carrier",
        sort: "desc",
        limit: 9999,
      }),
    );
    expect(res.params.limit).toBe(50);
    expect(res.warnings.some((w) => w.toLowerCase().includes("limit"))).toBe(true);
  });

  it("ignores a non-integer limit", () => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", dimension: "carrier", limit: 5.5 }),
    );
    expect(res.params.limit).toBeNull();
  });

  it("drops sort (with a warning) when dimension is 'none'", () => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", dimension: "none", sort: "desc" }),
    );
    expect(res.params.sort).toBeNull();
    expect(res.warnings.some((w) => w.toLowerCase().includes("sort"))).toBe(true);
  });

  it("keeps sort for a categorical dimension", () => {
    const res = expectOk(
      validateQueryParams({ metric: "delay_rate", dimension: "carrier", sort: "desc", limit: 1 }),
    );
    expect(res.params.sort).toBe("desc");
    expect(res.params.limit).toBe(1);
  });
});

describe("validateQueryParams — is_promo coercion", () => {
  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ["1", true],
    ["0", false],
    ["true", true],
    ["false", false],
  ])("coerces is_promo %p -> %p", (input, expected) => {
    const res = expectOk(
      validateQueryParams({ metric: "order_count", filters: { is_promo: input } }),
    );
    expect(res.params.filters.isPromo).toBe(expected);
  });
});

describe("validateQueryParams — date filter propagation", () => {
  it("propagates resolved dates and relativeRange from resolveDateRange", () => {
    const res = expectOk(
      validateQueryParams({
        metric: "delayed_count",
        dimension: "week",
        filters: { relative_range: "last_3_months" },
      }),
    );
    expect(res.params.filters.dateFrom).toBe("2025-10-02");
    expect(res.params.filters.dateTo).toBe("2025-12-30");
    expect(res.params.relativeRange).toBe("last_3_months");
  });

  it("propagates a clamp warning from the date layer", () => {
    const res = expectOk(
      validateQueryParams({
        metric: "order_count",
        filters: { date_from: "2020-01-01", date_to: "2025-12-30" },
      }),
    );
    expect(res.warnings.some((w) => w.includes("2025-01-01"))).toBe(true);
  });

  it("surfaces a date error as a validation failure", () => {
    const res = validateQueryParams({
      metric: "order_count",
      filters: { date_from: "2025-06-01", date_to: "2025-01-01" },
    });
    expect(res.ok).toBe(false);
  });
});

describe("validateForecastParams — SKU fallback", () => {
  it("resolves PAPER-0197 to category PAPER with a warning and switches target", () => {
    const res = expectOk(validateForecastParams({ sku: "PAPER-0197" }));
    expect(res.params.target).toBe("category_demand");
    expect(res.params.category).toBe("PAPER");
    expect(res.params.resolvedFromSku).toBe("PAPER-0197");
    expect(res.params.granularity).toBe("month");
    expect(
      res.warnings.some((w) => w.includes("PAPER-0197") && w.includes("PAPER")),
    ).toBe(true);
  });

  it("rejects a SKU whose prefix is not a known category", () => {
    const res = validateForecastParams({ sku: "WIDGET-0001" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("PAPER");
  });
});

describe("validateForecastParams — targets & category", () => {
  it("defaults to total_orders with no input", () => {
    const res = expectOk(validateForecastParams({}));
    expect(res.params.target).toBe("total_orders");
    expect(res.params.category).toBeNull();
    expect(res.params.method).toBe("linear_regression");
    expect(res.params.horizonMonths).toBe(4);
  });

  it("requires a category when target is category_demand", () => {
    const res = validateForecastParams({ target: "category_demand" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("PENCIL");
  });

  it("switches total_orders -> category_demand when a category is supplied", () => {
    const res = expectOk(
      validateForecastParams({ target: "total_orders", category: "BOOK" }),
    );
    expect(res.params.target).toBe("category_demand");
    expect(res.params.category).toBe("BOOK");
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("rejects an unknown category", () => {
    const res = validateForecastParams({ target: "category_demand", category: "GADGET" });
    expect(res.ok).toBe(false);
  });
});

describe("validateForecastParams — horizon & method", () => {
  it("clamps the horizon into 1..MAX_FORECAST_HORIZON with a warning", () => {
    const res = expectOk(validateForecastParams({ horizon_months: 99 }));
    expect(res.params.horizonMonths).toBe(12);
    expect(res.warnings.some((w) => w.toLowerCase().includes("horizon"))).toBe(true);

    const low = expectOk(validateForecastParams({ horizon_months: 0 }));
    expect(low.params.horizonMonths).toBe(1);
  });

  it("accepts moving_average as a method", () => {
    const res = expectOk(validateForecastParams({ method: "moving_average" }));
    expect(res.params.method).toBe("moving_average");
  });

  it("rejects an unknown method", () => {
    const res = validateForecastParams({ method: "arima" });
    expect(res.ok).toBe(false);
  });
});
