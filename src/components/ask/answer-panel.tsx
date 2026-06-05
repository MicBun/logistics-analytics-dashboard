/**
 * Renders a single AnswerEnvelope. Pure presentation: every number/string here
 * was computed server-side — this component never does analytics math.
 *
 * Layout per kind:
 *   unsupported → a plain "Not supported" alert with the server's message.
 *   error       → a destructive alert.
 *   analytics / forecast → summary (+ warnings), the chart, and the
 *   always-present explainability panel.
 */

import type { AnswerEnvelope } from "@/lib/types";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DynamicChart } from "@/components/ask/dynamic-chart";
import { ExplainabilityPanel } from "@/components/ask/explainability-panel";

export function AnswerPanel({ envelope }: { envelope: AnswerEnvelope }) {
  if (envelope.kind === "unsupported") {
    return (
      <Alert>
        <AlertTitle>Not supported</AlertTitle>
        <AlertDescription>
          {envelope.message ??
            "That question is outside what this dashboard can answer."}
        </AlertDescription>
      </Alert>
    );
  }

  if (envelope.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          {envelope.message ?? "The query could not be completed."}
        </AlertDescription>
      </Alert>
    );
  }

  // analytics | forecast — a computed answer.
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">
            {envelope.summary}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Non-fatal notes: clamped dates, SKU→category fallback, etc. */}
          {envelope.warnings.length > 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTitle className="text-amber-700 dark:text-amber-400">
                Note
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {envelope.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {envelope.chart && <DynamicChart spec={envelope.chart} />}
        </CardContent>
      </Card>

      {/* Required for every computed answer (plan §7). */}
      <ExplainabilityPanel envelope={envelope} />
    </div>
  );
}
