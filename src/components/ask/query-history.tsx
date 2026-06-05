"use client";

/**
 * Query history (bonus feature). Persists the last 20 questions in
 * localStorage so they survive reloads.
 *
 * localStorage is an EXTERNAL store, so the component reads it through
 * useSyncExternalStore — the canonical React API for this — rather than
 * mirroring it into useState from an effect (which lints as a cascading-render
 * hazard and needed a manual refresh signal from the page). Subscribing gives
 * us same-tab updates (via a custom event dispatched on every write) and
 * cross-tab updates (via the browser's native 'storage' event) for free.
 *
 * Prop contract:
 *   - `onSelect(question)`: re-run a past question (the page feeds it back
 *     through the same ask path).
 * The page records questions with the exported `recordQuery` helper after a
 * successful ask; the write itself notifies this component — no signal prop.
 *
 * All localStorage access is SSR-guarded and wrapped in try/catch —
 * private-mode / quota / disabled-storage failures degrade to an empty,
 * harmless history rather than crashing the page.
 */

import { useSyncExternalStore } from "react";

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
// Same-tab writes don't fire the browser's cross-tab 'storage' event, so every
// write dispatches this custom event to notify subscribers in this tab.
const CHANGE_EVENT = "ladb-query-history-change";

export interface HistoryEntry {
  question: string;
  /** epoch ms */
  ts: number;
}

/** Defensive parse: ignore anything that isn't the shape we expect. */
function parseEntries(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        e && typeof e.question === "string" && typeof e.ts === "number",
    );
  } catch {
    return [];
  }
}

function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parseEntries(window.localStorage.getItem(STORAGE_KEY));
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
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// --- useSyncExternalStore plumbing -----------------------------------------

/**
 * getSnapshot must return a referentially STABLE value while the underlying
 * data is unchanged, or useSyncExternalStore re-renders forever — so the
 * parsed array is cached against the raw string it came from.
 */
let snapshot: { raw: string | null; entries: HistoryEntry[] } = {
  raw: null,
  entries: [],
};

function getSnapshot(): HistoryEntry[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== snapshot.raw) {
    snapshot = { raw, entries: parseEntries(raw) };
  }
  return snapshot.entries;
}

const NO_ENTRIES: HistoryEntry[] = [];
/** The server has no storage — render the empty state until the client syncs. */
function getServerSnapshot(): HistoryEntry[] {
  return NO_ENTRIES;
}

function subscribe(onStoreChange: () => void): () => void {
  // 'storage' covers writes from OTHER tabs; CHANGE_EVENT covers this tab.
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

// ---------------------------------------------------------------------------

/**
 * Append a question to history (newest first, capped, consecutive-duplicate
 * deduped). Exported so the page records on a *successful* ask; the write
 * notifies <QueryHistory> directly via CHANGE_EVENT.
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
  onSelect,
}: {
  onSelect: (question: string) => void;
}) {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function handleClear() {
    writeHistory([]);
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
