/**
 * Forecasting math — PURE (no db imports).
 *
 * Projects the 12 observed 2025 monthly buckets forward over a horizon, using
 * either simple linear regression (OLS) or a flat moving-average baseline.
 * The series is small (12 points) and lumpy, so we deliberately keep the math
 * transparent and explainable rather than reaching for a heavier model — see
 * DISCLAIMERS.forecastConfidence, which we always attach to the methodology.
 */

import { linearRegression, linearRegressionLine, mean } from "simple-statistics";

import {
  DISCLAIMERS,
  DIMENSION_LABELS,
  SAFETY_FACTOR,
  type Category,
} from "./catalog";
import type {
  ForecastResult,
  MonthlyPoint,
  ValidatedForecastParams,
} from "./types";

/** How many trailing months the moving-average baseline averages over. */
const MOVING_AVERAGE_WINDOW = 3;

export function buildForecast(
  historical: MonthlyPoint[],
  params: ValidatedForecastParams,
): ForecastResult {
  const { target, category, method, horizonMonths, resolvedFromSku } = params;
  const values = historical.map((p) => p.value);
  const n = values.length;

  // Predict the raw (pre-clamp) value at a future month index.
  let predictAt: (index: number) => number;

  if (method === "moving_average") {
    // Flat projection: the mean of the LAST `window` observed months (or fewer
    // if the series is shorter). A naive, easy-to-explain baseline.
    const window = values.slice(Math.max(0, n - MOVING_AVERAGE_WINDOW));
    const baseline = window.length > 0 ? mean(window) : 0;
    predictAt = () => baseline;
  } else {
    // linear_regression (default): OLS over [index, value] pairs with index
    // 0..n-1, then extrapolate to future indices n..n+horizon-1.
    const pairs = values.map((v, i) => [i, v]);
    const line = linearRegressionLine(linearRegression(pairs));
    predictAt = (index) => line(index);
  }

  const lastMonth = historical[n - 1]?.month ?? "2025-12";
  const forecast: MonthlyPoint[] = [];
  for (let h = 1; h <= horizonMonths; h++) {
    const raw = predictAt(n + h - 1);
    // Clamp to a non-negative integer: order/unit counts can't be negative or
    // fractional, and the 2025 series trends down, so OLS can dip sub-zero on
    // longer horizons. round() also keeps the recommendation a whole number.
    const value = Math.max(0, Math.round(raw));
    forecast.push({ month: addMonths(lastMonth, h), value });
  }

  const unit = target === "total_orders" ? "orders" : "units";
  const recommendation = buildRecommendation(forecast, unit);
  const methodology = buildMethodology(
    method,
    n,
    horizonMonths,
    target === "category_demand" ? category : null,
    resolvedFromSku,
  );

  return {
    target,
    category,
    method,
    horizonMonths,
    unit,
    historical,
    forecast,
    recommendation,
    methodology,
  };
}

/**
 * Inventory recommendation: cover the summed forecast demand plus a small
 * safety buffer. Kept intentionally simple and the formula is spelled out so a
 * reviewer can verify the arithmetic by hand.
 */
function buildRecommendation(
  forecast: MonthlyPoint[],
  unit: "orders" | "units",
): { units: number; formula: string } {
  const sum = forecast.reduce((acc, p) => acc + p.value, 0);
  const recommended = Math.ceil(sum * SAFETY_FACTOR);
  const formula =
    `sum of the next ${forecast.length} forecast months (${sum}) ` +
    `× ${SAFETY_FACTOR} safety factor = ${recommended} ${unit}`;
  return { units: recommended, formula };
}

function buildMethodology(
  method: ValidatedForecastParams["method"],
  fittedMonths: number,
  horizonMonths: number,
  category: Category | null,
  resolvedFromSku: string | null,
): string {
  const methodName =
    method === "linear_regression"
      ? "Simple linear regression (OLS)"
      : `${MOVING_AVERAGE_WINDOW}-month moving average`;
  const subject = category
    ? `${DIMENSION_LABELS.product_category} ${category} demand`
    : "total order volume";

  const sentences = [
    `${methodName} fitted over the ${fittedMonths} monthly buckets of 2025 ${subject}.`,
    `Projected ${horizonMonths} month${horizonMonths === 1 ? "" : "s"} forward.`,
  ];

  // Surface the SKU→category fallback when we silently broadened the question.
  if (resolvedFromSku) {
    sentences.push(
      `SKU ${resolvedFromSku} has too few records to forecast on its own, ` +
        `so we forecast at the ${category ?? "product category"} level instead.`,
    );
  }

  // Always append the honest confidence caveat from the shared catalog.
  sentences.push(DISCLAIMERS.forecastConfidence);
  return sentences.join(" ");
}

/**
 * Advance a 'YYYY-MM' label by `offset` months, crossing year boundaries
 * (2025-12 → 2026-01). Pure string/integer math so it stays timezone-free.
 */
function addMonths(month: string, offset: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based for arithmetic
  const total = year * 12 + monthIndex + offset;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1; // back to 1-based
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}
