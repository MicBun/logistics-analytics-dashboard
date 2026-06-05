import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A single KPI tile. Values are formatted by the caller (rates ×100 with one
 * decimal, days to two decimals) so this stays a dumb presentational component
 * with no knowledge of metric units.
 */
export function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </div>
        {subtitle ? (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
