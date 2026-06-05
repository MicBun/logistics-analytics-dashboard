/**
 * Validation layer (PURE — no db imports).
 *
 * This is step 2 of the AI-as-router pipeline (docs/.plan.md §2): the LLM emits
 * a RAW, snake_case parameter object; this module parses it loosely with zod,
 * then checks every enum against the catalog allowlists and normalizes the
 * result into the typed { Validated*Params } shape that the computation layer
 * consumes. Out-of-range values are either rejected with a helpful message
 * (listing the allowed values) or clamped with a warning — nothing unvalidated
 * ever reaches the database.
 *
 * Design choices worth calling out:
 * - We accept anything (loose/optional zod) and normalize afterwards rather
 *   than failing the whole parse on one bad key, because the LLM occasionally
 *   emits extra/loose fields and we want precise, user-facing error messages
 *   per field instead of a generic zod dump.
 * - All date math is done on yyyy-mm-dd strings in UTC (Date.UTC + toISOString)
 *   so there are zero local-timezone surprises across machines.
 */

import { z } from "zod";

import {
  CARRIERS,
  CATEGORIES,
  DATA_END,
  DATA_START,
  DEFAULT_FORECAST_HORIZON,
  DIMENSIONS,
  FORECAST_METHODS,
  FORECAST_TARGETS,
  MAX_FORECAST_HORIZON,
  MAX_LIMIT,
  METRICS,
  REFERENCE_DATE,
  REGIONS,
  RELATIVE_RANGE_DAYS,
  RELATIVE_RANGES,
  STATUSES,
  TIME_DIMENSIONS,
  WAREHOUSES,
} from "./catalog";
import type {
  Category,
  Dimension,
  ForecastMethod,
  ForecastTarget,
  Metric,
  Status,
} from "./catalog";
import type {
  Validation,
  ValidatedForecastParams,
  ValidatedQueryParams,
} from "./types";

// ---------------------------------------------------------------------------
// Date helpers — all UTC, all on yyyy-mm-dd strings.
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a strict yyyy-mm-dd string to a UTC-midnight epoch, or null if invalid. */
function parseIsoUtc(s: string): number | null {
  if (!ISO_DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const ts = Date.UTC(y, m - 1, d);
  const dt = new Date(ts);
  // Reject overflow dates (e.g. 2025-02-30 rolls over to March) by round-tripping.
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return ts;
}

const DAY_MS = 86_400_000;

/** Format a UTC epoch back to yyyy-mm-dd. */
function toIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function addDays(ts: number, days: number): number {
  return ts + days * DAY_MS;
}

const DATA_START_TS = parseIsoUtc(DATA_START)!;
const DATA_END_TS = parseIsoUtc(DATA_END)!;
const REFERENCE_TS = parseIsoUtc(REFERENCE_DATE)!;

// ---------------------------------------------------------------------------
// Allowlist helpers
// ---------------------------------------------------------------------------

/**
 * Look up `value` in `allowed` (case-insensitively, trimmed) and return the
 * canonical catalog spelling. Returns undefined when not found so the caller
 * can produce a helpful "unknown X (allowed: …)" error.
 */
function matchEnum<T extends string>(
  value: string,
  allowed: readonly T[],
): T | undefined {
  const needle = value.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === needle);
}

function unknownValueError(
  label: string,
  value: unknown,
  allowed: readonly string[],
): string {
  return `Unknown ${label} "${String(value)}". Allowed values: ${allowed.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// is_promo coercion — the LLM may emit boolean, 0/1, or "true"/"false"/"0"/"1".
// ---------------------------------------------------------------------------

function coerceBoolish(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveDateRange
// ---------------------------------------------------------------------------

type DateRangeInput = {
  date_from?: string;
  date_to?: string;
  relative_range?: string;
  last_n_days?: number;
};

type DateRangeResult =
  | {
      from: string | null;
      to: string | null;
      warnings: string[];
      relativeRange: string | null;
    }
  | { error: string };

/**
 * Resolve the (possibly relative) date filter into absolute, clamped
 * yyyy-mm-dd bounds. See catalog.ts (REFERENCE_DATE block) for the anchoring
 * rules: relative ranges are TRAILING windows ending at the dataset's last
 * order date, because "today" lies outside the dataset's coverage.
 *
 * Precedence: relative_range / last_n_days win over absolute date_from/date_to
 * (we warn if both are supplied so the user understands which one took effect).
 */
export function resolveDateRange(f: DateRangeInput): DateRangeResult {
  const warnings: string[] = [];

  const hasRelative =
    (typeof f.relative_range === "string" && f.relative_range.trim() !== "") ||
    f.last_n_days != null;
  const hasAbsolute =
    (typeof f.date_from === "string" && f.date_from.trim() !== "") ||
    (typeof f.date_to === "string" && f.date_to.trim() !== "");

  // --- Relative ranges take precedence ---------------------------------------
  if (hasRelative) {
    if (hasAbsolute) {
      warnings.push(
        "Both relative and absolute date filters were given; using the relative range and ignoring the absolute dates.",
      );
    }

    // last_n_days has priority over a relative keyword when both are present.
    if (f.last_n_days != null) {
      const raw = Number(f.last_n_days);
      if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
        return { error: `last_n_days must be an integer, got "${String(f.last_n_days)}".` };
      }
      const clamped = Math.min(365, Math.max(1, raw));
      if (clamped !== raw) {
        warnings.push(
          `last_n_days ${raw} clamped to ${clamped} (allowed range 1..365).`,
        );
      }
      // Trailing window ending at REFERENCE_DATE inclusive ⇒ minus (N − 1).
      const fromTs = addDays(REFERENCE_TS, -(clamped - 1));
      return {
        from: toIso(fromTs),
        to: toIso(REFERENCE_TS),
        warnings,
        relativeRange: `last_${clamped}_days`,
      };
    }

    const keyword = matchEnum(f.relative_range!, RELATIVE_RANGES);
    if (!keyword) {
      return {
        error: unknownValueError("relative_range", f.relative_range, [
          ...RELATIVE_RANGES,
          "last_N_days",
        ]),
      };
    }

    if (keyword === "this_year") {
      return {
        from: DATA_START,
        to: DATA_END,
        warnings,
        relativeRange: keyword,
      };
    }

    // Trailing N-day window ending at REFERENCE_DATE inclusive ⇒ minus (N − 1).
    const days = RELATIVE_RANGE_DAYS[keyword];
    const fromTs = addDays(REFERENCE_TS, -(days - 1));
    return {
      from: toIso(fromTs),
      to: toIso(REFERENCE_TS),
      warnings,
      relativeRange: keyword,
    };
  }

  // --- Absolute dates --------------------------------------------------------
  if (hasAbsolute) {
    let fromTs: number | null = null;
    let toTs: number | null = null;

    if (typeof f.date_from === "string" && f.date_from.trim() !== "") {
      fromTs = parseIsoUtc(f.date_from.trim());
      if (fromTs == null) {
        return { error: `Invalid date_from "${f.date_from}" — expected ISO yyyy-mm-dd.` };
      }
    }
    if (typeof f.date_to === "string" && f.date_to.trim() !== "") {
      toTs = parseIsoUtc(f.date_to.trim());
      if (toTs == null) {
        return { error: `Invalid date_to "${f.date_to}" — expected ISO yyyy-mm-dd.` };
      }
    }

    // from > to is a contradiction the caller must fix; clamping would hide it.
    if (fromTs != null && toTs != null && fromTs > toTs) {
      return {
        error: `date_from (${toIso(fromTs)}) is after date_to (${toIso(toTs)}).`,
      };
    }

    // Clamp each bound into the dataset coverage, naming what we clamped.
    if (fromTs != null && fromTs < DATA_START_TS) {
      warnings.push(`date_from clamped to dataset start ${DATA_START}.`);
      fromTs = DATA_START_TS;
    }
    if (fromTs != null && fromTs > DATA_END_TS) {
      warnings.push(`date_from clamped to dataset end ${DATA_END}.`);
      fromTs = DATA_END_TS;
    }
    if (toTs != null && toTs > DATA_END_TS) {
      warnings.push(`date_to clamped to dataset end ${DATA_END}.`);
      toTs = DATA_END_TS;
    }
    if (toTs != null && toTs < DATA_START_TS) {
      warnings.push(`date_to clamped to dataset start ${DATA_START}.`);
      toTs = DATA_START_TS;
    }

    return {
      from: fromTs != null ? toIso(fromTs) : null,
      to: toTs != null ? toIso(toTs) : null,
      warnings,
      relativeRange: null,
    };
  }

  // --- Nothing given ⇒ full dataset, no warning ------------------------------
  return { from: null, to: null, warnings: [], relativeRange: null };
}

// ---------------------------------------------------------------------------
// validateQueryParams
// ---------------------------------------------------------------------------

// Loose, fully-optional schema: we never reject on an unexpected key here; the
// per-field allowlist checks below produce the precise, user-facing errors.
const rawFiltersSchema = z
  .object({
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    relative_range: z.string().optional(),
    last_n_days: z.coerce.number().optional(),
    carrier: z.string().optional(),
    region: z.string().optional(),
    warehouse: z.string().optional(),
    product_category: z.string().optional(),
    status: z.string().optional(),
    is_promo: z.unknown().optional(),
  })
  .passthrough();

const rawQuerySchema = z
  .object({
    metric: z.string().optional(),
    dimension: z.string().optional(),
    granularity: z.string().optional(),
    sort: z.string().optional(),
    limit: z.coerce.number().optional(),
    filters: rawFiltersSchema.optional(),
  })
  .passthrough();

export function validateQueryParams(
  raw: unknown,
): Validation<ValidatedQueryParams> {
  const parsed = rawQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Malformed query parameters." };
  }
  const r = parsed.data;
  const warnings: string[] = [];

  // --- metric (required) -----------------------------------------------------
  if (r.metric == null || r.metric.trim() === "") {
    return {
      ok: false,
      error: `A metric is required. Allowed values: ${METRICS.join(", ")}.`,
    };
  }
  const metric = matchEnum(r.metric, METRICS) as Metric | undefined;
  if (!metric) {
    return { ok: false, error: unknownValueError("metric", r.metric, METRICS) };
  }

  // --- dimension / granularity normalization ---------------------------------
  // A time dimension IS the granularity. Rules:
  //  - dimension given & valid → use it; if it's a time dim and a *different*
  //    granularity was also given, dimension wins (with a warning).
  //  - dimension missing/'none' but granularity given → dimension = granularity.
  let dimension: Dimension;

  let granularity: Dimension | undefined;
  if (r.granularity != null && r.granularity.trim() !== "") {
    const g = matchEnum(r.granularity, DIMENSIONS);
    if (!g || !(TIME_DIMENSIONS as readonly string[]).includes(g)) {
      return {
        ok: false,
        error: unknownValueError("granularity", r.granularity, TIME_DIMENSIONS),
      };
    }
    granularity = g;
  }

  if (r.dimension != null && r.dimension.trim() !== "") {
    const d = matchEnum(r.dimension, DIMENSIONS) as Dimension | undefined;
    if (!d) {
      return {
        ok: false,
        error: unknownValueError("dimension", r.dimension, DIMENSIONS),
      };
    }
    dimension = d;

    // If a time dimension was given alongside a different granularity, the
    // dimension is authoritative — warn so the discrepancy is visible.
    if (
      (TIME_DIMENSIONS as readonly string[]).includes(d) &&
      granularity != null &&
      granularity !== d
    ) {
      warnings.push(
        `Granularity "${granularity}" differs from the time dimension "${d}"; using the dimension "${d}".`,
      );
    }
  } else if (granularity != null) {
    // No (real) dimension but a granularity ⇒ the granularity becomes the dim.
    dimension = granularity;
  } else {
    dimension = "none";
  }

  // If the dimension is 'none' but a granularity was provided, promote it.
  if (dimension === "none" && granularity != null) {
    dimension = granularity;
  }

  // --- filters ---------------------------------------------------------------
  const rf = r.filters ?? {};

  const dateRange = resolveDateRange({
    date_from: rf.date_from,
    date_to: rf.date_to,
    relative_range: rf.relative_range,
    last_n_days: rf.last_n_days,
  });
  if ("error" in dateRange) {
    return { ok: false, error: dateRange.error };
  }
  warnings.push(...dateRange.warnings);

  // Equality filters — each validated against its allowlist.
  let carrier: string | null = null;
  if (rf.carrier != null && rf.carrier.trim() !== "") {
    const c = matchEnum(rf.carrier, CARRIERS);
    if (!c) return { ok: false, error: unknownValueError("carrier", rf.carrier, CARRIERS) };
    carrier = c;
  }

  let region: string | null = null;
  if (rf.region != null && rf.region.trim() !== "") {
    const c = matchEnum(rf.region, REGIONS);
    if (!c) return { ok: false, error: unknownValueError("region", rf.region, REGIONS) };
    region = c;
  }

  let warehouse: string | null = null;
  if (rf.warehouse != null && rf.warehouse.trim() !== "") {
    const c = matchEnum(rf.warehouse, WAREHOUSES);
    if (!c) return { ok: false, error: unknownValueError("warehouse", rf.warehouse, WAREHOUSES) };
    warehouse = c;
  }

  let productCategory: Category | null = null;
  if (rf.product_category != null && rf.product_category.trim() !== "") {
    const c = matchEnum(rf.product_category, CATEGORIES) as Category | undefined;
    if (!c) {
      return {
        ok: false,
        error: unknownValueError("product_category", rf.product_category, CATEGORIES),
      };
    }
    productCategory = c;
  }

  let status: Status | null = null;
  if (rf.status != null && rf.status.trim() !== "") {
    const c = matchEnum(rf.status, STATUSES) as Status | undefined;
    if (!c) return { ok: false, error: unknownValueError("status", rf.status, STATUSES) };
    status = c;
  }

  let isPromo: boolean | null = null;
  if (rf.is_promo != null) {
    const b = coerceBoolish(rf.is_promo);
    if (b == null) {
      return {
        ok: false,
        error: `Invalid is_promo "${String(rf.is_promo)}" — expected a boolean, 0/1, or "true"/"false".`,
      };
    }
    isPromo = b;
  }

  // --- sort / limit ----------------------------------------------------------
  let sort: "asc" | "desc" | null = null;
  if (r.sort != null && r.sort.trim() !== "") {
    const s = r.sort.trim().toLowerCase();
    if (s !== "asc" && s !== "desc") {
      return { ok: false, error: unknownValueError("sort", r.sort, ["asc", "desc"]) };
    }
    sort = s;
  }

  // Sorting only makes sense across grouped buckets; a single 'none' bucket has
  // nothing to rank, so we drop the sort (with a warning) rather than error.
  if (sort != null && dimension === "none") {
    warnings.push(
      "Sort was dropped because the dimension is 'none' (a single overall value has nothing to rank).",
    );
    sort = null;
  }

  let limit: number | null = null;
  if (r.limit != null) {
    // Ignore non-integers silently — the LLM occasionally emits e.g. 5.0/"five".
    if (Number.isFinite(r.limit) && Number.isInteger(r.limit)) {
      const clamped = Math.min(MAX_LIMIT, Math.max(1, r.limit));
      if (clamped !== r.limit) {
        warnings.push(`limit ${r.limit} clamped to ${clamped} (allowed range 1..${MAX_LIMIT}).`);
      }
      limit = clamped;
    }
  }

  const params: ValidatedQueryParams = {
    metric,
    dimension,
    filters: {
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      carrier,
      region,
      warehouse,
      productCategory,
      status,
      isPromo,
    },
    sort,
    limit,
    relativeRange: dateRange.relativeRange,
  };

  return { ok: true, params, warnings };
}

// ---------------------------------------------------------------------------
// validateForecastParams
// ---------------------------------------------------------------------------

const rawForecastSchema = z
  .object({
    target: z.string().optional(),
    category: z.string().optional(),
    sku: z.string().optional(),
    horizon_months: z.coerce.number().optional(),
    method: z.string().optional(),
  })
  .passthrough();

export function validateForecastParams(
  raw: unknown,
): Validation<ValidatedForecastParams> {
  const parsed = rawForecastSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Malformed forecast parameters." };
  }
  const r = parsed.data;
  const warnings: string[] = [];

  // Resolve target (may be overridden by the SKU fallback / category presence).
  let target: ForecastTarget | undefined;
  if (r.target != null && r.target.trim() !== "") {
    const t = matchEnum(r.target, FORECAST_TARGETS) as ForecastTarget | undefined;
    if (!t) {
      return { ok: false, error: unknownValueError("target", r.target, FORECAST_TARGETS) };
    }
    target = t;
  }

  let category: Category | null = null;
  if (r.category != null && r.category.trim() !== "") {
    const c = matchEnum(r.category, CATEGORIES) as Category | undefined;
    if (!c) {
      return { ok: false, error: unknownValueError("category", r.category, CATEGORIES) };
    }
    category = c;
  }

  let resolvedFromSku: string | null = null;

  // --- SKU fallback (plan §6) ------------------------------------------------
  // Per-SKU forecasting is meaningless here (355 unique SKUs, ≤3 orders each),
  // so a SKU resolves to its product-category prefix and we forecast that.
  if (r.sku != null && r.sku.trim() !== "") {
    const sku = r.sku.trim();
    const prefix = sku.split("-")[0]?.toUpperCase() ?? "";
    const skuCategory = matchEnum(prefix, CATEGORIES) as Category | undefined;
    if (!skuCategory) {
      return {
        ok: false,
        error: `Could not resolve SKU "${sku}" to a product category (prefix "${prefix}" is not one of: ${CATEGORIES.join(", ")}).`,
      };
    }
    target = "category_demand";
    category = skuCategory;
    resolvedFromSku = sku;
    warnings.push(
      `SKU ${sku} has too few historical records to forecast individually (355 unique SKUs, at most 3 orders each); forecasting at the ${skuCategory} category level instead.`,
    );
  }

  // A category alongside total_orders implies the user actually wants
  // category-level demand — switch the target (with a warning) rather than
  // silently ignoring the category.
  if (category != null && target === "total_orders") {
    warnings.push(
      `A category (${category}) was given with target total_orders; forecasting category_demand for ${category} instead.`,
    );
    target = "category_demand";
  }

  // Default target when none was supplied (and no SKU/category forced it).
  if (target == null) {
    target = category != null ? "category_demand" : "total_orders";
  }

  // category is required when forecasting category demand.
  if (target === "category_demand" && category == null) {
    return {
      ok: false,
      error: `Forecasting category demand requires a category. Choose one of: ${CATEGORIES.join(", ")}.`,
    };
  }

  // --- horizon ---------------------------------------------------------------
  let horizonMonths = DEFAULT_FORECAST_HORIZON;
  if (r.horizon_months != null && Number.isFinite(r.horizon_months)) {
    // Round non-integers to the nearest month rather than reject (LLM noise).
    const requested = Math.round(r.horizon_months);
    const clamped = Math.min(MAX_FORECAST_HORIZON, Math.max(1, requested));
    if (clamped !== requested) {
      warnings.push(
        `horizon_months ${requested} clamped to ${clamped} (allowed range 1..${MAX_FORECAST_HORIZON}).`,
      );
    }
    horizonMonths = clamped;
  }

  // --- method ----------------------------------------------------------------
  let method: ForecastMethod = "linear_regression";
  if (r.method != null && r.method.trim() !== "") {
    const m = matchEnum(r.method, FORECAST_METHODS) as ForecastMethod | undefined;
    if (!m) {
      return { ok: false, error: unknownValueError("method", r.method, FORECAST_METHODS) };
    }
    method = m;
  }

  const params: ValidatedForecastParams = {
    target,
    category: target === "category_demand" ? category : null,
    horizonMonths,
    method,
    granularity: "month",
    resolvedFromSku,
  };

  return { ok: true, params, warnings };
}
