import { runAnalyticsQuery } from "@/lib/analytics";
import { deriveKpis } from "@/lib/metrics";
import { STATUSES } from "@/lib/catalog";
import type {
  AggRow,
  DashboardKpis,
  MetricRow,
  ValidatedQueryParams,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { VolumeChart } from "@/components/charts/volume-chart";
import { StatusChart } from "@/components/charts/status-chart";
import { CarrierChart } from "@/components/charts/carrier-chart";
import { RegionChart } from "@/components/charts/region-chart";

// The seeded dataset is read-only after the one-time seed, so the dashboard is
// effectively static. ISR (revalidate hourly) is our whole caching story: the
// page is rendered once and reused, and a stale cache here is harmless.
export const revalidate = 3600;

/**
 * Build a fully-validated query with every filter unset. The dashboard
 * dogfoods the SAME deterministic engine the AI router uses — instead of
 * bespoke dashboard SQL, every card and chart is just a literal
 * ValidatedQueryParams run through runAnalyticsQuery, so the numbers can never
 * drift from what the natural-language interface would compute.
 */
function query(
  partial: Pick<ValidatedQueryParams, "metric" | "dimension"> &
    Partial<Pick<ValidatedQueryParams, "sort" | "limit">>,
): ValidatedQueryParams {
  return {
    metric: partial.metric,
    dimension: partial.dimension,
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
    sort: partial.sort ?? null,
    limit: partial.limit ?? null,
    relativeRange: null,
  };
}

/** MetricRow[] → the thin { key, value }[] the chart components expect. */
function toSeries(rows: MetricRow[]): { key: string; value: number | null }[] {
  return rows.map((r) => ({ key: r.key, value: r.value }));
}

const ZERO_AGG: AggRow = {
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

// Number formatters — values are formatted to strings BEFORE reaching KpiCard.
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtRate = (r: number | null, decimals = 1) =>
  r === null ? "—" : `${(r * 100).toFixed(decimals)}%`;
const fmtDays = (d: number | null) => (d === null ? "—" : `${d.toFixed(2)} days`);

export default async function DashboardPage() {
  const [kpiRes, volumeRes, statusRes, carrierRes, regionRes] =
    await Promise.all([
      runAnalyticsQuery(query({ metric: "order_count", dimension: "none" })),
      runAnalyticsQuery(query({ metric: "order_count", dimension: "month" })),
      runAnalyticsQuery(query({ metric: "order_count", dimension: "status" })),
      runAnalyticsQuery(
        query({ metric: "delay_rate", dimension: "carrier", sort: "desc" }),
      ),
      runAnalyticsQuery(query({ metric: "on_time_rate", dimension: "region" })),
    ]);

  // dimension 'none' → kind 'value' with one row keyed 'all'; fall back to a
  // zero aggregate so an empty database renders zeros instead of crashing.
  const agg = kpiRes.rows[0]?.agg ?? ZERO_AGG;
  const kpis: DashboardKpis = deriveKpis(agg);

  // Show every lifecycle state, in lifecycle order, even if a status is absent
  // from the data (the grouped result only contains statuses that occur).
  const statusByKey = new Map(statusRes.rows.map((r) => [r.key, r.value]));
  const statusData = STATUSES.map((s) => ({
    key: s,
    value: statusByKey.get(s) ?? 0,
  }));

  return (
    <div className="space-y-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Descriptive analytics over the full order dataset (Jan 1 – Dec 30, 2025).
        </p>
      </div>

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <KpiCard title="Total orders" value={fmtInt(kpis.totalOrders)} />
        <KpiCard title="Delivered" value={fmtInt(kpis.deliveredOrders)} />
        <KpiCard title="Delayed" value={fmtInt(kpis.delayedOrders)} />
        <KpiCard
          title="On-time rate"
          value={fmtRate(kpis.onTimeRate)}
          subtitle="delivered ÷ (delivered + delayed) — status-based proxy"
        />
        <KpiCard
          title="Avg delivery time"
          value={fmtDays(kpis.avgDeliveryTime)}
          subtitle="delivered orders only"
        />
        {/* 2 decimals: 2.75% is exact; 1 decimal rounds to 2.8%, which matches
            nothing in the README's locked KPI table. */}
        <KpiCard title="Exception rate" value={fmtRate(kpis.exceptionRate, 2)} />
        <KpiCard
          title="Open orders"
          value={fmtInt(kpis.openOrders)}
          subtitle="in transit — excluded from rates"
        />
      </section>

      {/* Charts grid (2×2 on lg) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Order volume over time"
          description="Orders placed per month."
        >
          <VolumeChart data={toSeries(volumeRes.rows)} />
        </ChartCard>

        <ChartCard
          title="Delivery performance breakdown"
          description="Orders by lifecycle status — the full distribution."
        >
          <StatusChart data={statusData} />
        </ChartCard>

        <ChartCard
          title="Delay rate by carrier"
          description="Share of resolved orders that were delayed, by carrier (sorted high to low)."
        >
          <CarrierChart data={toSeries(carrierRes.rows)} />
        </ChartCard>

        <ChartCard
          title="On-time rate by region"
          description="On-time rate per region against a 95% target — the gap to target is the story."
        >
          <RegionChart data={toSeries(regionRes.rows)} />
        </ChartCard>
      </section>

      <p className="text-xs text-muted-foreground">
        On-time rate is a status-based proxy: delivered ÷ (delivered + delayed).
        The dataset has no promised delivery date, so a true industry OTD cannot
        be computed; in-flight and canceled orders carry no outcome and are
        excluded from all rate math. Ask a question on the Ask page to see each
        answer&rsquo;s full query plan, filters, and caveats.
      </p>
    </div>
  );
}

/** Card wrapper for a single chart with a title and one-line description. */
function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
