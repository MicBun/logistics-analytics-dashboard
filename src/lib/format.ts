/**
 * Shared display formatters — the single place numbers become strings.
 *
 * Every surface (dashboard KPI tiles, dashboard charts, the Ask page's dynamic
 * chart and tables) formats through these helpers so the same value can never
 * render two different ways. Rates are FRACTIONS (0..1) everywhere in code and
 * become percentages only here.
 */

import { STATUS_LABELS, type Dimension } from "@/lib/catalog";
import type { Unit } from "@/lib/types";

/** Integer count, locale-grouped: 1234 → "1,234". */
export const fmtInt = (n: number): string => n.toLocaleString("en-US");

/** Fraction (0..1) → percent string: 0.847 → "84.7%". */
export const fmtRate = (r: number | null, decimals = 1): string =>
  r === null ? "—" : `${(r * 100).toFixed(decimals)}%`;

/**
 * Days, two display styles:
 *   long    → "3.25 days"  (KPI tiles, tooltips — room to be explicit)
 *   compact → "3.3d"       (axis ticks — every character costs plot width)
 */
export const fmtDays = (
  d: number | null,
  style: "long" | "compact" = "long",
): string => {
  if (d === null) return "—";
  return style === "compact"
    ? `${Number(d.toFixed(1))}d`
    : `${d.toFixed(2)} days`;
};

/**
 * US dollars, locale-grouped, two decimals by default — exactly matching
 * summarize.ts fmtValue so the KPI tile, chart tooltip, and explainability
 * table can never disagree on the same amount: 12400.5 → "$12,400.50".
 * Pass decimals=0 for whole-dollar axis ticks where width is at a premium.
 */
export const fmtUsd = (n: number, decimals = 2): string =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

/**
 * Unit-aware dispatcher for chart ticks and tooltips. Accepts the loose value
 * types Recharts hands its formatters (strings, arrays — which we don't plot —
 * and nulls) and falls back to a plain string for anything non-numeric.
 */
export function formatMetricValue(
  value: number | string | readonly (number | string)[] | null | undefined,
  unit: Unit,
  opts: {
    /** ChartSpec.percent — rate metrics plotted as fractions. */
    percent?: boolean;
    style?: "long" | "compact";
    /** Decimals for percent values (ticks read better with 0). */
    rateDecimals?: number;
  } = {},
): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (Number.isNaN(n)) return String(value);

  const style = opts.style ?? "long";
  if (opts.percent || unit === "percent") return fmtRate(n, opts.rateDecimals ?? 1);
  if (unit === "usd") return fmtUsd(n, style === "compact" ? 0 : 2);
  if (unit === "days") return fmtDays(n, style);
  return fmtInt(n);
}

/**
 * Humanize a dimension key for display. Status values are stored as enum
 * tokens ("in_transit") — every user-facing surface shows the label
 * ("In transit") instead. All other dimensions display their keys as-is.
 */
export function displayDimensionKey(key: string, dimension: Dimension): string {
  if (dimension === "status") {
    return (STATUS_LABELS as Record<string, string>)[key] ?? key;
  }
  return key;
}
