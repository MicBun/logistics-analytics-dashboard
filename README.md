# Logistics Analytics Dashboard

An AI-powered analytics dashboard for a logistics client over a single unified dataset (400 orders, full year 2025). It pairs a traditional KPI/chart dashboard with a natural-language query interface where the AI acts strictly as a **router** — it interprets the question and emits validated structured parameters, but **every number comes from deterministic SQL or forecast math, never from the model**. Each answer ships with a chart chosen from the result shape and an explainability panel that shows the exact query plan, filters, underlying data, and metric-specific caveats.

**Live demo:** https://micbun-logistics-analytics-dashboard.vercel.app

---

## 1. Features at a glance

- **Descriptive dashboard** — KPI cards (total orders, delivered, delayed, on-time rate, avg delivery time, exception rate, open orders) plus four charts: order volume over time, full five-state delivery-performance breakdown, delay rate by carrier, and on-time rate by region against a 95% target line.
- **Natural-language queries** — ask in plain English ("which carrier has the highest delay rate?"); the AI maps it onto a fixed metric × dimension × filter vocabulary and returns a direct answer, a dynamically-typed chart, or both.
- **Dynamic charts** — chart type is chosen from the result shape: single value → big number; time series → line; categorical/ranking → bar; forecast → historical+forecast line.
- **Explainability on every answer** — the validated parameter object *is* the query plan; the panel also shows filters applied, metric/dimension, the underlying data table, and metric-specific disclaimers (e.g. the on-time proxy caveat).
- **Demand forecasting** — monthly OLS linear regression (or 3-month moving average) over total orders or a product category, with a historical+forecast chart, an inventory recommendation, and an honest confidence note.
- **Query history** — recent questions persisted in `localStorage` for one-click re-runs.
- **Tests** — Vitest unit tests over the pure KPI, validation, and forecast math.

---

## 2. Setup

### Prerequisites

- **Node.js 20+** and **pnpm** (`corepack enable` will provide pnpm).
- A **Neon Postgres** database (free tier is plenty for 400 rows).
- An **Anthropic API key** for the NL router.

### Steps

```bash
# 1. Clone and install
git clone <repo-url>
cd logistics-analytics-dashboard
pnpm install

# 2. Configure environment
cp .env.example .env.local
# then edit .env.local — see the two variables below

# 3. Create the schema and load the dataset (one-time)
pnpm db:push     # applies the Drizzle schema to your Neon database
pnpm db:seed     # loads data/mock_logistics_data.csv into Postgres

# 4. Run the app
pnpm dev         # http://localhost:3000
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string, used by the `@neondatabase/serverless` HTTP driver. Provisioned via the Vercel Marketplace Neon integration (auto-injected on Vercel) or copied from the Neon console. Format: `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`. |
| `ANTHROPIC_API_KEY` | Server-side key for the NL query router. Never exposed to the client. |

Both are blank in `.env.example`. **Never commit `.env.local` or any secret.**

The seed script **verifies the dataset's invariants on load** (row count, status distribution, the exact null-`delivery_date` set, and `order_value = quantity × unit_price`) and **fails loudly** if the CSV has drifted, so a bad load can never silently feed wrong numbers into the dashboard.

### Other scripts

```bash
pnpm test        # run the Vitest unit suite (pure KPI / validation / forecast math)
pnpm typecheck   # tsc --noEmit (strict)
pnpm build       # production build
```

---

## 3. Architecture

### System overview

One Next.js (App Router, TypeScript) application contains both the frontend and the API route handlers. A single read-only Postgres table (`orders`) backs everything. The dashboard reads aggregates directly through server components; the NL interface posts to an API route that runs the AI-as-router pipeline below.

### The AI-as-router data flow

```
User question
  → AI interpretation   (Anthropic tool use: choose a tool + emit structured PARAMS ONLY — no SQL, no numbers)
  → Validation          (params checked against catalog allowlists; dates resolved + clamped to data bounds; bad values rejected/clamped)
  → Computation         (deterministic: Drizzle parameterized SQL, or forecast math)
  → Result              (rows / aggregates / forecast points)
  → Explanation         (the validated params ARE the query plan; + filters + metric/dimension + data table + caveats)
  → Visualization       (chart type chosen from the result shape)
```

### Key design decisions (and why)

**(a) Postgres over an in-memory store.** A durable, deployable, read-only store lets reviewers use the live URL with zero local setup, lets us write real *parameterized* SQL (the "structured query generation" the brief asks for), and costs nothing on Neon's free tier. We use the `@neondatabase/serverless` **HTTP driver** rather than a long-lived `pg` pool because Vercel serverless functions would otherwise exhaust connections.

**(b) No raw AI-generated SQL.** The model never writes SQL. It only fills a typed parameter object (metric, dimension, filters, sort/limit, or forecast target/method/horizon). Those params are validated against the catalog allowlists, then queries are built with **Drizzle bound parameters**. This removes the entire class of SQL-injection / hallucinated-column risks that raw AI SQL carries.

**(c) The validated param object doubles as the explainability artifact.** Because validation produces a normalized, allowlisted parameter object, we get the "query plan" for free — there is no separate explainability subsystem to keep in sync. What ran is exactly what's displayed.

**(d) Deterministic templated summaries, not a second LLM call.** The one-line natural-language summary of each answer is produced by a template fed the already-computed numbers. This keeps the **zero-hallucination guarantee** end-to-end: no model ever sees a number it could misstate.

**(e) Clear separation of concerns**, matching the brief's "separate AI interpretation / data computation / business logic":

| Concern | Location |
|---|---|
| AI interpretation (tool use, params only) | `src/lib/ai/router.ts` |
| Validation (allowlists, clamping) | `src/lib/validate.ts` |
| Computation (deterministic) | `src/lib/analytics.ts`, `src/lib/forecast.ts`, `src/lib/metrics.ts` |
| Presentation (chart + summary) | `src/lib/chart-select.ts`, `src/lib/summarize.ts` |

The five pure modules (`validate`, `metrics`, `forecast`, `chart-select`, `summarize`) import no database, which is what makes them cheap to unit-test.

**(f) ISR caching (`revalidate = 3600`).** The dataset is read-only, so dashboard pages are cached and revalidated hourly rather than recomputed on every request — fast for reviewers, and correct because the underlying data never changes at runtime.

### Project structure

```
src/
  app/                # Next.js App Router: dashboard page, /api/query route, layout
  components/
    ui/               # shadcn/ui primitives (card, button, table, badge, alert, …)
    ask/              # NL query box, dynamic chart, explainability panel
  db/
    schema.ts         # Drizzle schema (orders table + status enum)
    client.ts         # getDb() — lazy Neon HTTP client
  lib/
    catalog.ts        # the fixed vocabulary: allowlists, date rules, disclaimers
    types.ts          # shared type contracts + metric formulas
    validate.ts       # param validation + date resolution/clamping (pure)
    metrics.ts        # KPI formulas (pure)
    analytics.ts      # Drizzle parameterized aggregation queries (db)
    forecast.ts       # linear regression / moving average (pure)
    chart-select.ts   # result shape → chart spec (pure)
    summarize.ts      # templated summaries (pure)
    ai/router.ts      # Anthropic tool-use router → AnswerEnvelope
scripts/
  seed.ts             # one-time CSV → Postgres loader with invariant checks
```

---

## 4. AI approach

### How questions are interpreted

A single Anthropic **`claude-haiku-4-5`** call is made with two tool definitions, `query_analytics` and `forecast_demand`. The tool descriptions are **prescriptive**: they enumerate exactly which metrics, dimensions, filters, and forecast options are valid, so the model maps free-form phrasing into our fixed vocabulary instead of inventing fields. `tool_choice` is set to **auto**, so the model can *decline* a question it can't satisfy and answer in plain text rather than forcing a tool call.

### How tools are selected

- A descriptive/aggregation question ("delayed orders by week", "on-time rate by region", "top 5 destinations") → `query_analytics`.
- A forward-looking question ("predict demand for the next 4 months", "how much inventory should I plan?") → `forecast_demand`.
- Anything outside the vocabulary → the model declines, and the app returns a graceful "not supported" message with suggested example questions.

### The fixed vocabulary (from `src/lib/catalog.ts`)

| Axis | Allowed values |
|---|---|
| **Metrics** | `order_count`, `delivered_count`, `delayed_count`, `on_time_rate`, `delay_rate`, `exception_count`, `exception_rate`, `avg_delivery_time`, `order_value_sum` |
| **Dimensions** | `none`, `carrier`, `region`, `warehouse`, `product_category`, `destination_city`, `origin_city`, `status`, `day`, `week`, `month` |
| **Filters** | date range (absolute `from`/`to`, or relative `last_month` / `last_3_months` / `last_6_months` / `this_year`); equality on `carrier`, `region`, `warehouse`, `product_category`, `status`, `is_promo` |
| **Forecast** | `target` ∈ {`total_orders`, `category_demand`}; `category` (8 categories); `horizon_months` (default 4); `method` ∈ {`linear_regression`, `moving_average`}; `granularity` = `month` |

### Out-of-vocabulary questions

Anything the vocabulary can't express (a missing field, a causal "why", a free-form request) yields a clear **"not supported"** response plus a short list of supported example questions — never a guessed or fabricated answer.

### Hard rules

1. The model **never emits SQL and never produces a numeric answer.** It only fills a typed parameter object.
2. **Every parameter is validated against an allowlist before it touches the database.** Out-of-range values are rejected or clamped, with a message.
3. The **validated parameter object is the explainability artifact** — displayed as the query plan.

---

## 5. Assumptions

### Locked KPI definitions (with this dataset's values)

| KPI | Definition | Value |
|---|---|---|
| Total orders | `COUNT(*)` (all rows incl. canceled — they were placed) | **400** |
| Delivered orders | `status = 'delivered'` | **304** |
| Delayed orders | `status = 'delayed'` | **55** |
| On-time delivery rate | `delivered ÷ (delivered + delayed)` | **84.7%** |
| Average delivery time | `AVG(delivery_date − order_date)` over **delivered only**, days | **3.25 days** |
| Exception rate | `exception_count ÷ total_orders` | **2.75%** |

### On-time rate: 84.7% vs 82.2% — the choice, spelled out

We define on-time rate as **`delivered ÷ (delivered + delayed) = 304 ÷ 359 = 84.7%`**. This matches the spec's own "delayed vs on-time" framing and is the simplest to explain. Exceptions are not hidden — they are surfaced separately through the **exception-rate** KPI and the five-state status breakdown. An alternative definition that counts exceptions in the denominator yields **`304 ÷ 370 = 82.2%`**. Both are defensible; we **pick one and apply it consistently**, and the explainability panel states the proxy nature explicitly.

### Other assumptions

- **`delayed` comes from the `status` field only.** We do **not** invent an SLA/threshold (e.g. ">5 days = late") — the dataset has no promised/committed delivery date, so a date-derived lateness rule cannot be defined.
- **`order_value_usd` is GROSS** (`quantity × unit_price`). The promo discount is **not** applied to it. (Only 22 of 400 orders are promos.)
- **Relative dates are trailing windows** anchored to the dataset's last order date, **2025-12-30**, because the real "today" lies outside the data. `last_month` = trailing 30 days, `last_3_months` = trailing 90 days, `last_6_months` = trailing 180 days, `this_year` = the full 2025 window. This anchoring is surfaced in the explainability panel, and a coverage note on the Ask page states it up front. The UI's example questions deliberately use explicit 2025 dates ("in December 2025") instead of relative phrases, so they never imply current-calendar data — relative phrasing remains fully supported for typed questions.
- **In-flight (`in_transit`) and canceled orders are excluded from all rate and delivery-time math** — they have no delivery outcome (and a null `delivery_date`). Open orders (27) get their own informational KPI card; canceled (3) appears in the status-breakdown chart.
- **The demand forecast counts orders PLACED**, regardless of their eventual outcome (a placed order is a unit of demand).
- **Cosmetic quirk:** `order_id` strings read `ORD-2026-*` while the actual `order_date` values are in 2025. We treat `order_id` as an **opaque identifier** and rely on `order_date` for all time logic.

---

## 6. Limitations

- **On-time rate is a status-based proxy, not a true OTD.** Industry on-time delivery compares actual delivery against the *promised/committed* date; this dataset has no such field, so true OTD is impossible. The panel and the assumptions above state this plainly.
- **No per-SKU forecasting.** There are 355 unique SKUs with a median of 1 record each (max 3) — far too sparse to forecast. A SKU-level question falls back to that SKU's **product category** with an explicit caveat.
- **Not computable from this dataset** (no supporting fields): OTIF / DIFOT, first-attempt delivery rate, cost-per-delivery, profit/margin, and customer demographics.
- **Forecast confidence is limited** by lumpy monthly volumes (e.g. Jan = 75 orders vs Sep = 18), so forecasts are directional, not precise.
- **Unsupported query types:** causal "why" questions, free-form requests outside the metric/dimension vocabulary, and any write/mutation (the data is read-only).

---

## 7. Forecasting

- **Methods:** OLS **linear regression** (default) or a **3-month moving average**, fit over the 12 monthly order aggregates for 2025.
- **Granularity:** monthly (fixed) — the only level with usable signal in this data.
- **Horizon:** default **4 months** (configurable up to 12), continuing after 2025-12.
- **Inventory recommendation:** `ceil(Σ(forecast over the horizon) × 1.2)` — the sum of forecast demand with a small **1.2 safety factor**. The formula is shown verbatim alongside the number.
- **Confidence note:** every forecast includes an honest caveat that the monthly series is lumpy (Jan 75, Sep 18), so the output is an indicative planning input, not a precise prediction.
- **Returns:** forecast values, a chart of **historical + forecast** on one series, the inventory recommendation, and a methodology note — all four required outputs.

---

## 8. Future improvements

- **Multi-turn query refinement** — let users iterate ("now break that down by carrier") with conversational context.
- **Streaming responses** — stream the router/summary for snappier perceived latency.
- **LLM-judge eval suite for the router** — automated grading of question → expected-tool/params mappings to catch routing regressions.
- **A promised/committed-date field** — would unlock a *true* OTD metric instead of the status-based proxy.
- **Auth + saved dashboards** — per-user pinned views and saved queries.
- **CI pipeline + Docker compose** — run typecheck/tests on every push, and a one-command local Postgres for offline development.

---

## 9. Bonus items implemented

- **Query history** — recent questions stored in `localStorage`, re-runnable in one click.
- **Unit tests** — Vitest over the pure KPI, validation, and forecast math (the modules where data correctness lives).
- **Caching** — ISR (`revalidate = 3600`) on the read-only dashboard.
- **Ambiguous / unsupported-query handling** — graceful "not supported" responses with suggested questions, plus SKU→category forecast fallback.
- **Advanced explainability** — query plan + filters + metric/dimension + underlying data table + metric-specific caveats on every answer.

---

## 10. AI usage disclosure

This is explicit, per the assignment's note that undisclosed AI usage is treated negatively:

- **Building the project:** this codebase was developed with AI assistance (Claude Code / Claude Opus).
- **In the running application:** the app calls the Anthropic API (`claude-haiku-4-5`) **strictly as a router** that emits structured parameters. **All analytics and forecast numbers come from deterministic SQL and math — never from the model.** The model never sees or produces a final number, and never writes SQL.

---

## 11. Tech stack & deployment

### Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict, React 19) |
| Styling / UI | Tailwind v4, shadcn/ui |
| Database | Neon Postgres (free tier) |
| DB driver | `@neondatabase/serverless` (HTTP) |
| ORM / query builder | Drizzle ORM (parameterized SQL) |
| AI | `@anthropic-ai/sdk` with tool use (`claude-haiku-4-5`) |
| Charts | Recharts |
| Forecast math | `simple-statistics` |
| Validation | Zod |
| Tests | Vitest |
| Hosting | Vercel |

### Deployment (Vercel + Neon)

1. Provision **Neon** through the **Vercel Marketplace native integration**, which auto-injects `DATABASE_URL` into the project.
2. Add **`ANTHROPIC_API_KEY`** as a Vercel environment variable.
3. Run the one-time **`pnpm db:push`** then **`pnpm db:seed`** against the Neon database to create the schema and load the dataset.
4. Deploy. The app is fully usable from the public URL with no local setup or authentication.

> Neon's free tier scales to zero when idle, so the first request after a period of inactivity may incur a sub-second cold start — acceptable for a reviewer's use.
