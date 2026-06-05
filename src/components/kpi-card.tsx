import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Icon accent tones — deliberately the SAME chart tokens the charts use
 * (teal = good, amber = late, red = problem), so KPI accents and chart colors
 * tell one consistent story across the whole dashboard.
 */
const TONE_CLASSES = {
  default: "text-muted-foreground",
  positive: "text-[var(--chart-2)]",
  warning: "text-[var(--chart-3)]",
  danger: "text-[var(--chart-4)]",
} as const;

/**
 * A single KPI tile. Values are formatted by the caller (via src/lib/format)
 * so this stays a dumb presentational component with no knowledge of metric
 * units. The optional icon + tone add scannable hierarchy to the KPI rows.
 */
export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {Icon ? (
          <CardAction>
            <Icon className={`size-4 ${TONE_CLASSES[tone]}`} aria-hidden />
          </CardAction>
        ) : null}
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
