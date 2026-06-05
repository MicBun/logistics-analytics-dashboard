/**
 * The AI router — the heart of the "AI-as-router" pattern.
 *
 * answerQuestion() runs ONE Anthropic tool-use call to interpret the question into
 * structured params (no SQL, no numbers from the model), validates those params
 * against the catalog allowlists, then dispatches to deterministic computation and
 * presentation. The returned AnswerEnvelope carries the validated params as the
 * explainability "query plan", plus the computed result, chart, table, summary, and
 * metric-specific disclaimers.
 *
 * Failure modes are PRODUCT STATES, not thrown errors: a question the vocabulary
 * can't express returns kind 'unsupported'; an infrastructure/API failure returns
 * kind 'error' with a generic safe message (the real cause is logged server-side).
 */

import Anthropic from "@anthropic-ai/sdk";

import { runAnalyticsQuery, getMonthlySeries } from "@/lib/analytics";
import {
  DISCLAIMERS,
  DIMENSION_LABELS,
  METRIC_META,
} from "@/lib/catalog";
import {
  chartForAnalytics,
  chartForForecast,
  groupedDisplayRows,
} from "@/lib/chart-select";
import { buildForecast } from "@/lib/forecast";
import { fmtValue, summarizeAnalytics, summarizeForecast } from "@/lib/summarize";
import type {
  AnalyticsResult,
  AnswerEnvelope,
  AnswerTable,
  ForecastResult,
  ValidatedQueryParams,
} from "@/lib/types";
import { validateForecastParams, validateQueryParams } from "@/lib/validate";

import { TOOLS } from "./tools";

export const SYSTEM_PROMPT = `You are the query router for a logistics analytics dashboard. Dataset: 400 orders placed 2025-01-01..2025-12-30 across 9 carriers, 5 regions, 9 warehouses, 8 product categories (BOOK, BRUSH, CRAYON, MARKER, PAINT, PAPER, PENCIL, STICKER); order statuses: delivered, delayed, in_transit, exception, canceled.

Your ONLY job is to map the user's question onto exactly one tool call using the fixed vocabulary — you never compute, estimate, or state numbers, and you never write SQL.

Treat 'today' as 2025-12-30 (the dataset's last day); map phrases like 'last month' / 'last 3 months' / 'recent' to filters.relative_range. 'Late' or 'overdue' means status delayed; on-time questions use on_time_rate; revenue/value questions use order_value_sum.

For demand/inventory/forecast questions use forecast_demand; if the user names a SKU (like PAPER-0123) pass it in the sku field — the system resolves it to a category.

Never ask clarifying questions for parameters that have defaults (forecast horizon defaults to 4 months, method to linear_regression, dates to the full dataset). If the question names a metric/category/target you can map, CALL THE TOOL with what you know and simply omit unspecified optional parameters — the system fills in the defaults and discloses them in the answer.

If the question cannot be expressed in the vocabulary (causal 'why' analysis, profit/cost/margin, customer demographics, promised-date OTD, data modification, off-topic chit-chat), do NOT call a tool: reply in 1-3 sentences that it isn't supported, briefly why, and suggest 2-3 example questions that ARE supported. Never fabricate data or numbers in text replies.`;

/** Two supported questions appended to validation-failure messages, so the user gets a path forward. */
const EXAMPLE_QUESTIONS = [
  "Which carrier has the highest delay rate?",
  "Show order volume by month.",
];

/** Cap on the text we echo back from an unsupported (no-tool) reply. */
const UNSUPPORTED_TEXT_CAP = 700;

export async function answerQuestion(question: string): Promise<AnswerEnvelope> {
  // Guard early: without a key we can't call the model. Surface a clean product
  // state rather than letting the SDK throw an opaque auth error.
  if (!process.env.ANTHROPIC_API_KEY) {
    return errorEnvelope(
      question,
      "The question service is not configured. Please set ANTHROPIC_API_KEY.",
    );
  }

  try {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
      tools: TOOLS,
      // Routing is a single-tool decision; disable parallel tool use so we get at
      // most one tool_use block to dispatch on.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");

    // No tool call → the model (correctly) declined. Echo its explanation.
    if (!toolUse) {
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ")
        .trim();
      return unsupportedEnvelope(question, capText(text) || fallbackUnsupportedMessage());
    }

    // block.input is already a parsed object from the SDK — never re-parse or
    // string-match it.
    if (toolUse.name === "query_analytics") {
      return await handleAnalytics(question, toolUse.input);
    }
    if (toolUse.name === "forecast_demand") {
      return await handleForecast(question, toolUse.input);
    }

    // Unknown tool name — should be impossible given our TOOLS, but stay safe.
    return unsupportedEnvelope(question, fallbackUnsupportedMessage());
  } catch (err) {
    // Log the real cause server-side; return a generic, safe message to the client.
    console.error("[answerQuestion] failed:", err);
    return errorEnvelope(question, safeErrorMessage(err));
  }
}

// ---------------------------------------------------------------------------
// Dispatch handlers
// ---------------------------------------------------------------------------

async function handleAnalytics(
  question: string,
  rawInput: unknown,
): Promise<AnswerEnvelope> {
  const validation = validateQueryParams(rawInput);
  if (!validation.ok) {
    // Validation rejected something outside the allowlist — explain and point the
    // user at supported questions, rather than guessing.
    const message = `${validation.error} Try one of: ${EXAMPLE_QUESTIONS.join(" ")}`;
    return unsupportedEnvelope(question, message, "query_analytics");
  }

  const params = validation.params;
  const result = await runAnalyticsQuery(params);

  return {
    kind: "analytics",
    question,
    tool: "query_analytics",
    params,
    warnings: validation.warnings,
    summary: summarizeAnalytics(result, params),
    disclaimers: analyticsDisclaimers(params),
    chart: chartForAnalytics(result, params),
    table: buildAnalyticsTable(result, params),
    analytics: result,
  };
}

async function handleForecast(
  question: string,
  rawInput: unknown,
): Promise<AnswerEnvelope> {
  const validation = validateForecastParams(rawInput);
  if (!validation.ok) {
    const message = `${validation.error} Try one of: ${EXAMPLE_QUESTIONS.join(" ")}`;
    return unsupportedEnvelope(question, message, "forecast_demand");
  }

  const params = validation.params;
  const historical = await getMonthlySeries(params);
  const result = buildForecast(historical, params);

  return {
    kind: "forecast",
    question,
    tool: "forecast_demand",
    params,
    warnings: validation.warnings,
    summary: summarizeForecast(result),
    disclaimers: [DISCLAIMERS.forecastConfidence],
    chart: chartForForecast(result),
    table: buildForecastTable(result),
    forecast: result,
  };
}

// ---------------------------------------------------------------------------
// Disclaimers — metric-dependent caveats surfaced in the explainability panel.
// ---------------------------------------------------------------------------

function analyticsDisclaimers(params: ValidatedQueryParams): string[] {
  const out: string[] = [];

  // On-time-proxy + rate-exclusion caveats apply to the status-based rate/count
  // metrics that depend on the delivered-vs-delayed framing.
  const proxyMetrics = new Set([
    "on_time_rate",
    "delay_rate",
    "delayed_count",
    "delivered_count",
  ]);
  if (proxyMetrics.has(params.metric)) {
    out.push(DISCLAIMERS.onTimeProxy, DISCLAIMERS.rateExclusions);
  }
  // Avg delivery time excludes in-flight/canceled by construction — explain that.
  if (params.metric === "avg_delivery_time") {
    out.push(DISCLAIMERS.rateExclusions);
  }
  // Order value is gross (no promo discount applied).
  if (params.metric === "order_value_sum") {
    out.push(DISCLAIMERS.grossValue);
  }
  // Relative date anchoring is non-obvious (today is outside the dataset).
  if (params.relativeRange) {
    out.push(DISCLAIMERS.relativeDates);
  }

  // Dedupe while preserving order.
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Human-readable tables for the explainability panel.
// ---------------------------------------------------------------------------

function buildAnalyticsTable(
  result: AnalyticsResult,
  params: ValidatedQueryParams,
): AnswerTable {
  const metricLabel = METRIC_META[result.metric].label;

  if (result.kind === "value") {
    return {
      columns: ["Metric", "Value"],
      rows: [[metricLabel, fmtValue(result.value, result.unit)]],
    };
  }

  // grouped | timeseries: one row per bucket, with the metric value plus the raw
  // underlying counts so the reviewer can see what the metric was computed from.
  // For a grouped result we show the same rows the chart does (the full ranking
  // for a superlative), so the table and chart never disagree.
  const dimensionLabel = DIMENSION_LABELS[result.dimension];
  const tableRows =
    result.kind === "grouped"
      ? groupedDisplayRows(result, params)
      : result.rows;
  return {
    columns: [
      dimensionLabel,
      metricLabel,
      "Orders",
      "Delivered",
      "Delayed",
      "Exceptions",
    ],
    rows: tableRows.map((row) => [
      row.key,
      fmtValue(row.value, result.unit),
      row.agg.total,
      row.agg.delivered,
      row.agg.delayed,
      row.agg.exception,
    ]),
  };
}

function buildForecastTable(result: ForecastResult): AnswerTable {
  const historicalRows = result.historical.map(
    (point) => [point.month, "Historical", point.value] as (string | number)[],
  );
  const forecastRows = result.forecast.map(
    (point) => [point.month, "Forecast", point.value] as (string | number)[],
  );
  return {
    columns: ["Month", "Type", "Value"],
    rows: [...historicalRows, ...forecastRows],
  };
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function unsupportedEnvelope(
  question: string,
  message: string,
  tool: AnswerEnvelope["tool"] = null,
): AnswerEnvelope {
  return {
    kind: "unsupported",
    question,
    tool,
    params: null,
    warnings: [],
    summary: "This question isn't supported by the analytics vocabulary.",
    disclaimers: [],
    chart: null,
    table: null,
    message,
  };
}

function errorEnvelope(question: string, message: string): AnswerEnvelope {
  return {
    kind: "error",
    question,
    tool: null,
    params: null,
    warnings: [],
    summary: "Something went wrong answering this question.",
    disclaimers: [],
    chart: null,
    table: null,
    message,
  };
}

function fallbackUnsupportedMessage(): string {
  return `That question isn't supported. Try one of: ${EXAMPLE_QUESTIONS.join(" ")}`;
}

function capText(text: string): string {
  if (text.length <= UNSUPPORTED_TEXT_CAP) return text;
  return `${text.slice(0, UNSUPPORTED_TEXT_CAP).trimEnd()}…`;
}

/**
 * Map a thrown error to a generic, safe client message. We use the SDK's typed
 * error classes for slightly more specific wording, but never leak details (stack,
 * request body, provider internals) to the client.
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The question service rejected our credentials. Please check the server configuration.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "The question service is busy right now. Please try again in a moment.";
  }
  if (err instanceof Anthropic.APIError) {
    return "The question service is temporarily unavailable. Please try again.";
  }
  return "Something went wrong answering this question. Please try again.";
}
