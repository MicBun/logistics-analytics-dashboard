"use client";

/**
 * The natural-language query interface.
 *
 * The page is a thin client: it sends the question to POST /api/query and
 * renders the returned AnswerEnvelope. It never computes analytics numbers —
 * every figure shown comes from the deterministic server pipeline. See
 * docs/.plan.md §2, §7, §8.
 */

import { useCallback, useState } from "react";

import {
  ChartColumn,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { AnswerEnvelope } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerPanel } from "@/components/ask/answer-panel";
import { QueryForm } from "@/components/ask/query-form";
import { QueryHistory, recordQuery } from "@/components/ask/query-history";

// A few representative questions covering both tools (analytics + forecast) and
// both result shapes (series, ranking, single value, grouped). Clicking one
// runs it immediately so reviewers can explore without typing.
// Chips use explicit 2025 dates rather than relative phrases ("last month"),
// because the dataset ends 2025-12-30 while the reader's "today" does not —
// relative phrasing remains fully supported (anchored to the dataset's end and
// disclosed in the explainability panel), the chips just avoid implying
// current-calendar data.
const EXAMPLE_QUESTIONS = [
  "Show delayed orders by week for October–December 2025",
  "Which carrier has the highest delay rate?",
  "How many orders were delivered late in December 2025?",
  "On-time rate by region",
  "Forecast PAPER demand for the first 4 months of 2026",
  "How much inventory should I plan for CRAYON?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [envelope, setEnvelope] = useState<AnswerEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    setQuestion(trimmed);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok) {
        // Non-200: surface a friendly message rather than raw status text. The
        // envelope's own 'unsupported'/'error' kinds are returned WITH 200, so
        // this branch is genuinely a transport/server failure.
        setError(
          "The server couldn't answer that question right now. Please try again.",
        );
        setEnvelope(null);
        return;
      }

      const data: AnswerEnvelope = await res.json();
      setEnvelope(data);
      // Record only questions that actually reached the server successfully —
      // the write itself notifies <QueryHistory> (external-store subscription).
      recordQuery(trimmed);
    } catch {
      // Network failure / JSON parse error.
      setError(
        "Couldn't reach the server. Check your connection and try again.",
      );
      setEnvelope(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectHistory = useCallback(
    (q: string) => {
      setQuestion(q);
      void ask(q);
    },
    [ask],
  );

  return (
    // The root layout's <main> already provides the width container
    // (max-w-7xl px-4) — adding another here gave this route a different
    // content width than the dashboard, so the two pages didn't line up.
    <div className="py-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Ask the data
            </h1>
            <p className="text-sm text-muted-foreground">
              Questions are interpreted by AI into validated query parameters —
              every number comes from deterministic computation, never from the
              model.
            </p>
          </header>

          <QueryForm
            value={question}
            onChange={setQuestion}
            onAsk={ask}
            loading={loading}
          />

          {/* Dataset-coverage note: relative phrases are anchored to the end
              of the data, not the reader's calendar — say so up front. */}
          <p className="-mt-3 text-xs text-muted-foreground">
            Dataset covers Jan 1 – Dec 30, 2025. Relative phrases like
            &ldquo;last month&rdquo; are interpreted against the end of the
            data, not today&rsquo;s date.
          </p>

          {/* Example-question chips. */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => {
                  setQuestion(q);
                  void ask(q);
                }}
              >
                {q}
              </Button>
            ))}
          </div>

          {/* Result region. aria-live so screen readers announce new answers. */}
          <div aria-live="polite" aria-busy={loading}>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Request failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {loading && !error && (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-[300px] w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}

            {!loading && !error && envelope && (
              <AnswerPanel envelope={envelope} />
            )}

            {/* Empty state: before the first question this region was a void
                of whitespace (visual-audit finding). Restate the architecture
                instead — it fills the page AND tells visitors what makes the
                answers trustworthy. */}
            {!loading && !error && !envelope && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <MessageSquareText
                    className="size-8 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">
                    Ask anything about the 2025 order data
                  </p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Your question becomes validated query parameters — every
                    number is computed deterministically from the database,
                    never by the model.
                  </p>
                  <div className="hidden items-center gap-6 text-xs text-muted-foreground sm:flex">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="size-3.5" aria-hidden /> AI interprets
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5" aria-hidden /> Parameters
                      validated
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ChartColumn className="size-3.5" aria-hidden /> Computed
                      &amp; charted
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Slim history column on lg+. Stacks below the main column on small
            screens. */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <QueryHistory onSelect={handleSelectHistory} />
        </aside>
      </div>
    </div>
  );
}
