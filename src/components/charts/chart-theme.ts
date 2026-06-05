/**
 * Shared chart styling — one source of truth for every Recharts chart in the
 * app (the four dashboard charts and the Ask page's dynamic chart).
 *
 * Tooltips MUST use these styles: Recharts' default tooltip is a hardcoded
 * white box that ignores the theme entirely and is unreadable in dark mode.
 * Everything here resolves through CSS variables so charts follow light/dark
 * automatically.
 */

import type { CSSProperties } from "react";

import type { Status } from "@/lib/catalog";

/** One height everywhere so charts line up across pages. */
export const CHART_HEIGHT = 300;

/**
 * Series animation is OFF (`isAnimationActive={false}` on every Bar/Line).
 * Recharts' JS entrance animation starts series at zero geometry, and any
 * remount/resize re-runs it — observed in browser audits as charts whose axes
 * render but whose bars/lines are momentarily invisible. A data dashboard's
 * first paint should never depend on a JS animation finishing; entrance
 * motion lives at the panel level instead (CSS, reduced-motion aware).
 */
export const SERIES_ANIMATION_ACTIVE = false;

export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  fontSize: 12,
  borderRadius: 8,
  background: "var(--popover)",
  border: "1px solid var(--border)",
  color: "var(--popover-foreground)",
};

export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: "var(--popover-foreground)",
  fontWeight: 500,
};

export const TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: "var(--popover-foreground)",
};

/**
 * Semantic palette for the order lifecycle — mirrors the KPI math's
 * categorization (see src/db/schema.ts): success, late, in-flight, problem,
 * never-fulfilled. Uses the existing chart tokens so light/dark both work.
 */
export const STATUS_COLORS: Record<Status, string> = {
  delivered: "var(--chart-2)", // teal — terminal success
  delayed: "var(--chart-3)", // amber — terminal, not on-time
  in_transit: "var(--chart-1)", // indigo — in flight, no outcome yet
  exception: "var(--chart-4)", // red — problem state
  canceled: "var(--muted-foreground)", // gray — never fulfilled
};
