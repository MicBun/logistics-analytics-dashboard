"use client";

/**
 * Query history (bonus feature). Persists the last 20 questions in
 * localStorage so they survive reloads.
 *
 * Prop contract:
 *   - `refreshSignal`: a counter the page bumps each time it records a new
 *     question (via the exported `recordQuery` helper). Bumping it tells this
 *     component to re-read localStorage. We keep the WRITE on the page (right
 *     after a successful ask) and the READ here, so history reflects only
 *     questions that actually ran — and there's a single source of truth for
 *     the storage shape (this file's helpers).
 *   - `onSelect(question)`: re-run a past question (the page feeds it back
 *     through the same ask path).
 *
 * All localStorage access is SSR-guarded (`typeof window`) and wrapped in
 * try/catch — private-mode / quota / disabled-storage failures degrade to an
 * empty, harmless history rather than crashing the page.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STORAGE_KEY = "ladb-query-history";
const MAX_ENTRIES = 20;

export interface HistoryEntry {
  question: string;
  /** epoch ms */
  ts: number;
}

function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter: ignore anything that isn't the shape we expect.
    return parsed.filter(
      (e): e is HistoryEntry =>
        e &&
        typeof e.question === "string" &&
        typeof e.ts === "number",
    );
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable/full — history is non-essential, so swallow.
  }
}

/**
 * Append a question to history (newest first, capped, consecutive-duplicate
 * deduped). Exported so the page records on a *successful* ask without this
 * component needing to own the ask flow.
 */
export function recordQuery(question: string): void {
  const q = question.trim();
  if (!q) return;
  const existing = readHistory();
  // Skip if it repeats the most recent entry — avoids spamming history when a
  // user re-runs the same question back-to-back.
  if (existing[0]?.question === q) return;
  const next = [{ question: q, ts: Date.now() }, ...existing].slice(
    0,
    MAX_ENTRIES,
  );
  writeHistory(next);
}

export function QueryHistory({
  refreshSignal,
  onSelect,
}: {
  refreshSignal: number;
  onSelect: (question: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  // Re-read on mount and whenever the page signals a new question was recorded.
  // (localStorage can't be read during render/SSR, so we hydrate in an effect.)
  useEffect(() => {
    setEntries(readHistory());
  }, [refreshSignal]);

  function handleClear() {
    writeHistory([]);
    setEntries([]);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Recent questions</CardTitle>
        {entries.length > 0 && (
          <CardAction>
            <Button variant="ghost" size="xs" onClick={handleClear}>
              Clear
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your asked questions will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((e) => (
              <li key={`${e.ts}-${e.question}`}>
                <button
                  type="button"
                  onClick={() => onSelect(e.question)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  title={e.question}
                >
                  <span className="line-clamp-1 text-sm">{e.question}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
