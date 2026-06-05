"use client";

/**
 * The natural-language input. Controlled by the page so example chips and
 * history clicks can populate it and submit through the same `onAsk` path.
 */

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_LENGTH = 500;

export function QueryForm({
  value,
  onChange,
  onAsk,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Submit handler — receives the trimmed question. */
  onAsk: (question: string) => void;
  loading: boolean;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q || loading) return;
    onAsk(q);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <div className="flex-1">
        <label htmlFor="ask-input" className="sr-only">
          Ask a question about the logistics data
        </label>
        <Input
          id="ask-input"
          name="question"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Which carrier has the highest delay rate?"
          maxLength={MAX_LENGTH}
          disabled={loading}
          autoComplete="off"
          aria-label="Ask a question about the logistics data"
          // Native Enter-to-submit works because this lives in a <form>.
        />
      </div>
      <Button type="submit" disabled={loading || value.trim().length === 0}>
        {loading ? "Thinking…" : "Ask"}
      </Button>
    </form>
  );
}
