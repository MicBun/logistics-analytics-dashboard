import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI for the dashboard. The page blocks on a six-query
 * Promise.all against Neon, and a serverless cold start there can take a few
 * seconds — without this the visitor stares at a blank screen. The skeleton
 * mirrors the real layout (heading, two KPI rows of four, 2×2 chart grid) so
 * nothing shifts when the data lands.
 *
 * Lives in the (dashboard) route group ON PURPOSE: a loading.tsx at the app
 * root would be the fallback for every route — including /ask, whose layout
 * looks nothing like this skeleton.
 */
export default function DashboardLoading() {
  return (
    // role="status": announce the loading state to assistive tech — the
    // pulsing tiles alone are silent for screen-reader users.
    <div role="status" aria-label="Loading dashboard" className="space-y-8 py-8">
      <span className="sr-only">Loading dashboard…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* Two KPI groups: label line + four tiles each. */}
      {[0, 1].map((group) => (
        <section key={group} className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card size="sm" key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-7 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {/* Charts grid (2×2 on lg) — heights match the real CHART_HEIGHT. */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
