import { describe, expect, it } from "vitest";

import { SAFETY_FACTOR } from "@/lib/catalog";
import { buildForecast } from "@/lib/forecast";
import type { MonthlyPoint, ValidatedForecastParams } from "@/lib/types";

/** Build a 12-month 2025 series (2025-01 .. 2025-12) from raw values. */
function series2025(values: number[]): MonthlyPoint[] {
  return values.map((value, i) => ({
    month: `2025-${String(i + 1).padStart(2, "0")}`,
    value,
  }));
}

const baseParams: ValidatedForecastParams = {
  target: "total_orders",
  category: null,
  horizonMonths: 4,
  method: "linear_regression",
  granularity: "month",
  resolvedFromSku: null,
};

describe("buildForecast — linear_regression", () => {
  it("extrapolates a perfect linear series", () => {
    // 10, 20, ..., 120 has slope 10; next four indices continue 130..160.
    const historical = series2025([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    const result = buildForecast(historical, baseParams);

    expect(result.forecast.map((p) => p.value)).toEqual([130, 140, 150, 160]);
  });

  it("clamps a steeply negative trend to 0 and never goes negative", () => {
    // Strong downward slope so OLS would predict sub-zero within the horizon.
    const historical = series2025([
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10,
    ]);
    const result = buildForecast(historical, {
      ...baseParams,
      horizonMonths: 6,
    });

    for (const point of result.forecast) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
    // The tail of the horizon is firmly past zero, so it must be clamped.
    expect(result.forecast.at(-1)?.value).toBe(0);
  });

  it("rounds and clamps every value to a non-negative integer", () => {
    const historical = series2025([
      75, 40, 35, 30, 28, 25, 22, 20, 18, 30, 45, 60,
    ]);
    const result = buildForecast(historical, baseParams);

    for (const point of result.forecast) {
      expect(Number.isInteger(point.value)).toBe(true);
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildForecast — moving_average", () => {
  it("projects the mean of the last 3 months flat across the horizon", () => {
    // Last three values are 30, 60, 90 → mean 60, repeated for every month.
    const historical = series2025([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 60, 90,
    ]);
    const result = buildForecast(historical, {
      ...baseParams,
      method: "moving_average",
    });

    expect(result.forecast.map((p) => p.value)).toEqual([60, 60, 60, 60]);
  });
});

describe("buildForecast — month labels", () => {
  it("continues monthly labels across the year boundary", () => {
    const historical = series2025([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    const result = buildForecast(historical, baseParams);

    // Last historical month is 2025-12, so the forecast starts at 2026-01.
    expect(result.forecast.map((p) => p.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });
});

describe("buildForecast — horizon", () => {
  it("respects the requested horizon length", () => {
    const historical = series2025([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    const result = buildForecast(historical, {
      ...baseParams,
      horizonMonths: 12,
    });

    expect(result.forecast).toHaveLength(12);
    expect(result.forecast.at(-1)?.month).toBe("2026-12");
  });
});

describe("buildForecast — recommendation", () => {
  it("computes ceil(sum × safety factor) with a matching formula", () => {
    const historical = series2025([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    const result = buildForecast(historical, baseParams);

    const sum = result.forecast.reduce((acc, p) => acc + p.value, 0);
    const expected = Math.ceil(sum * SAFETY_FACTOR);

    expect(result.recommendation.units).toBe(expected);
    // 130+140+150+160 = 580 → ceil(580 × 1.2) = 696.
    expect(result.recommendation.units).toBe(696);
    expect(result.recommendation.formula).toContain(String(sum));
    expect(result.recommendation.formula).toContain(String(expected));
    expect(result.recommendation.formula).toContain(String(SAFETY_FACTOR));
  });
});

describe("buildForecast — unit selection", () => {
  it("uses 'orders' for total_orders", () => {
    const result = buildForecast(series2025(Array(12).fill(50)), baseParams);
    expect(result.unit).toBe("orders");
    expect(result.recommendation.formula).toContain("orders");
  });

  it("uses 'units' for category_demand", () => {
    const result = buildForecast(series2025(Array(12).fill(50)), {
      ...baseParams,
      target: "category_demand",
      category: "PAPER",
    });
    expect(result.unit).toBe("units");
    expect(result.recommendation.formula).toContain("units");
  });
});

describe("buildForecast — methodology", () => {
  it("always includes the confidence caveat", () => {
    const result = buildForecast(series2025(Array(12).fill(50)), baseParams);
    expect(result.methodology).toContain("indicative, not precise");
  });

  it("mentions the SKU→category fallback when resolvedFromSku is set", () => {
    const result = buildForecast(series2025(Array(12).fill(50)), {
      ...baseParams,
      target: "category_demand",
      category: "PAPER",
      resolvedFromSku: "SKU-123",
    });
    expect(result.methodology).toContain("SKU-123");
    expect(result.methodology).toContain("PAPER");
  });
});
