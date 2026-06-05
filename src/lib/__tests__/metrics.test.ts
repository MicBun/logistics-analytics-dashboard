/**
 * Unit tests for the pure metric layer. These are the "cheap insurance on data
 * correctness" called out in the brief (§12): they pin the locked KPI formulas
 * (§4) to the verified full-dataset numbers and exercise the null/empty cases.
 *
 * No database import — everything runs against hand-built AggRows.
 */

import { describe, expect, it } from "vitest";

import type { AggRow } from "@/lib/types";
import { computeMetric, deriveKpis, metricUnit } from "@/lib/metrics";

/**
 * The whole dataset as a single bucket, from the verified facts:
 * 400 rows; delivered 304, delayed 55, in_transit 27, exception 11, canceled 3;
 * Σ delivered delivery-days = 988 (→ mean 3.25). value/units sums are arbitrary
 * passthrough probes (the formulas just return them unchanged).
 */
const FULL: AggRow = {
  key: "all",
  total: 400,
  delivered: 304,
  delayed: 55,
  exception: 11,
  canceled: 3,
  inTransit: 27,
  deliveredDaysSum: 988,
  valueSum: 123456.78,
  unitsSum: 1500,
};

/** An empty bucket — every count zero — to drive the null/undefined cases. */
const EMPTY: AggRow = {
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
};

describe("computeMetric over the full dataset", () => {
  it("returns plain counts", () => {
    expect(computeMetric(FULL, "order_count")).toBe(400);
    expect(computeMetric(FULL, "delivered_count")).toBe(304);
    expect(computeMetric(FULL, "delayed_count")).toBe(55);
    expect(computeMetric(FULL, "exception_count")).toBe(11);
  });

  it("on_time_rate = delivered / (delivered + delayed) ≈ 84.68%", () => {
    // 304 / 359 — the headline 84.7% figure.
    expect(computeMetric(FULL, "on_time_rate")).toBeCloseTo(304 / 359, 3);
    expect(computeMetric(FULL, "on_time_rate")).toBeCloseTo(0.8468, 3);
  });

  it("delay_rate = delayed / (delivered + delayed) and complements on_time_rate", () => {
    expect(computeMetric(FULL, "delay_rate")).toBeCloseTo(55 / 359, 3);
    const onTime = computeMetric(FULL, "on_time_rate")!;
    const delay = computeMetric(FULL, "delay_rate")!;
    expect(onTime + delay).toBeCloseTo(1, 10);
  });

  it("exception_rate = exception / total = 2.75%", () => {
    expect(computeMetric(FULL, "exception_rate")).toBeCloseTo(0.0275, 10);
  });

  it("avg_delivery_time = deliveredDaysSum / delivered = 3.25 days", () => {
    // 988 / 304 = 3.25.
    expect(computeMetric(FULL, "avg_delivery_time")).toBeCloseTo(3.25, 10);
  });

  it("order_value_sum is a gross passthrough of valueSum", () => {
    expect(computeMetric(FULL, "order_value_sum")).toBe(123456.78);
  });
});

describe("computeMetric null cases (zero denominator)", () => {
  it("on_time_rate is null when delivered + delayed = 0", () => {
    expect(computeMetric(EMPTY, "on_time_rate")).toBeNull();
    // Even with non-settled rows present, the rate is undefined.
    const onlyOpen: AggRow = { ...EMPTY, total: 5, inTransit: 5 };
    expect(computeMetric(onlyOpen, "on_time_rate")).toBeNull();
  });

  it("delay_rate is null when delivered + delayed = 0", () => {
    expect(computeMetric(EMPTY, "delay_rate")).toBeNull();
  });

  it("avg_delivery_time is null when delivered = 0", () => {
    expect(computeMetric(EMPTY, "avg_delivery_time")).toBeNull();
  });

  it("exception_rate is null when total = 0", () => {
    expect(computeMetric(EMPTY, "exception_rate")).toBeNull();
  });
});

describe("metricUnit", () => {
  it("maps each metric to its catalog unit", () => {
    expect(metricUnit("order_count")).toBe("orders");
    expect(metricUnit("on_time_rate")).toBe("percent");
    expect(metricUnit("avg_delivery_time")).toBe("days");
    expect(metricUnit("order_value_sum")).toBe("usd");
  });
});

describe("deriveKpis", () => {
  it("maps the overall AggRow onto the dashboard KPI set", () => {
    const kpis = deriveKpis(FULL);
    expect(kpis.totalOrders).toBe(400);
    expect(kpis.deliveredOrders).toBe(304);
    expect(kpis.delayedOrders).toBe(55);
    expect(kpis.onTimeRate).toBeCloseTo(0.8468, 3);
    expect(kpis.avgDeliveryTime).toBeCloseTo(3.25, 10);
    expect(kpis.exceptionRate).toBeCloseTo(0.0275, 10);
    expect(kpis.openOrders).toBe(27); // in_transit, informational only
    expect(kpis.canceledOrders).toBe(3);
  });

  it("propagates nulls from an empty bucket", () => {
    const kpis = deriveKpis(EMPTY);
    expect(kpis.onTimeRate).toBeNull();
    expect(kpis.avgDeliveryTime).toBeNull();
    expect(kpis.exceptionRate).toBeNull();
    expect(kpis.openOrders).toBe(0);
  });
});
