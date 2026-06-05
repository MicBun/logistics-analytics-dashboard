/**
 * "How this answer was computed" — the required explainability surface (plan §7).
 *
 * Everything here is derived from the AnswerEnvelope the server already
 * produced; this component renders, it does not compute. The validated
 * parameter object (envelope.params) IS the query plan, shown verbatim, so the
 * reviewer can see exactly what the AI emitted and that no SQL or numbers came
 * from the model.
 */

import {
  DIMENSION_LABELS,
  METRIC_META,
  REFERENCE_DATE,
} from "@/lib/catalog";
import type {
  AnswerEnvelope,
  ValidatedForecastParams,
  ValidatedQueryParams,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// A forecast envelope carries ValidatedForecastParams (has `target`); an
// analytics one carries ValidatedQueryParams (has `metric`). We discriminate
// on those keys rather than on envelope.kind so TypeScript narrows for us.
function isForecastParams(
  p: ValidatedQueryParams | ValidatedForecastParams,
): p is ValidatedForecastParams {
  return "target" in p;
}

/** One labeled key/value row inside a section. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium break-words">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

const FORECAST_METHOD_LABELS: Record<string, string> = {
  linear_regression: "Linear regression",
  moving_average: "Moving average",
};

const FORECAST_TARGET_LABELS: Record<string, string> = {
  total_orders: "Total orders",
  category_demand: "Category demand",
};

/** Humanized "Filters applied" rows for an analytics query plan. */
function analyticsFilters(params: ValidatedQueryParams) {
  const f = params.filters;
  const rows: { label: string; value: string }[] = [];

  // Date range. null/null = no bounds = whole dataset.
  if (f.dateFrom || f.dateTo) {
    rows.push({
      label: "Date range",
      value: `${f.dateFrom ?? "start"} → ${f.dateTo ?? "end"}`,
    });
  } else {
    rows.push({ label: "Date range", value: "entire dataset (2025)" });
  }

  // Provenance for relative ranges, so the trailing-window anchoring is visible
  // (it's a deliberate choice — see catalog.ts REFERENCE_DATE).
  if (params.relativeRange) {
    rows.push({
      label: "Relative range",
      value: `'${params.relativeRange}' → trailing window, anchored to dataset end ${REFERENCE_DATE}`,
    });
  }

  // Each non-null equality filter becomes its own row.
  const equality: [string, string | boolean | null][] = [
    ["Carrier", f.carrier],
    ["Region", f.region],
    ["Warehouse", f.warehouse],
    ["Product category", f.productCategory],
    ["Status", f.status],
  ];
  for (const [label, value] of equality) {
    if (value !== null) rows.push({ label, value: String(value) });
  }
  if (f.isPromo !== null) {
    rows.push({ label: "Promo orders", value: f.isPromo ? "yes" : "no" });
  }

  return rows;
}

export function ExplainabilityPanel({ envelope }: { envelope: AnswerEnvelope }) {
  const params = envelope.params;
  // Defensive: computed answers always carry params, but render nothing rather
  // than crash if a malformed envelope ever reaches us.
  if (!params) return null;

  const forecast = isForecastParams(params);

  return (
    <Card>
      <CardHeader>
        <CardTitle>How this answer was computed</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* 1. Filters applied */}
        <Section title="Filters applied">
          {forecast ? (
            <Row label="Scope">
              {params.category
                ? `Category ${params.category}`
                : "All orders (total demand)"}
            </Row>
          ) : (
            <div className="flex flex-col gap-1.5">
              {analyticsFilters(params).map((r) => (
                <Row key={r.label} label={r.label}>
                  {r.value}
                </Row>
              ))}
            </div>
          )}
        </Section>

        <Separator />

        {/* 2. Metric & dimension (analytics) or target/method/horizon (forecast) */}
        <Section title={forecast ? "Forecast setup" : "Metric & dimension"}>
          {forecast ? (
            <div className="flex flex-col gap-1.5">
              <Row label="Target">
                {FORECAST_TARGET_LABELS[params.target] ?? params.target}
              </Row>
              <Row label="Method">
                {FORECAST_METHOD_LABELS[params.method] ?? params.method}
              </Row>
              <Row label="Horizon">
                {params.horizonMonths} month
                {params.horizonMonths === 1 ? "" : "s"}
              </Row>
              {params.resolvedFromSku && (
                <Row label="Resolved from SKU">{params.resolvedFromSku}</Row>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Row label="Metric">
                {METRIC_META[params.metric].label}
              </Row>
              <Row label="Grouped by">
                {DIMENSION_LABELS[params.dimension]}
              </Row>
              {params.sort && <Row label="Sort">{params.sort}</Row>}
              {params.limit !== null && (
                <Row label="Limit">top {params.limit}</Row>
              )}
            </div>
          )}
        </Section>

        <Separator />

        {/* 3. Query plan — the validated params, verbatim. */}
        <Section title="Query plan">
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(params, null, 2)}
          </pre>
          <p className="text-xs text-muted-foreground">
            The validated parameter object — the AI emits only these parameters;
            SQL is built from them with bound parameters. No AI-generated SQL, no
            AI-generated numbers.
          </p>
        </Section>

        {/* 4. Methodology (forecast only). */}
        {forecast && envelope.forecast && (
          <>
            <Separator />
            <Section title="Methodology">
              <p className="text-sm text-muted-foreground">
                {envelope.forecast.methodology}
              </p>
              <Row label="Recommendation">
                {envelope.forecast.recommendation.formula}
              </Row>
            </Section>
          </>
        )}

        {/* 5. Caveats — canned disclaimers for the chosen metric/forecast. */}
        {envelope.disclaimers.length > 0 && (
          <>
            <Separator />
            <Section title="Caveats">
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {envelope.disclaimers.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {/* 6. Underlying data — the actual rows the numbers came from. */}
        {envelope.table && envelope.table.rows.length > 0 && (
          <>
            <Separator />
            <Section title="Underlying data">
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {envelope.table.columns.map((c) => (
                        <TableHead key={c}>{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {envelope.table.rows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell key={j} className="tabular-nums">
                            {cell === null ? "—" : String(cell)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
