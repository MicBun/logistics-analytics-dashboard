/**
 * POST /api/query — the natural-language query endpoint.
 *
 * Accepts { question: string }, routes it through the AI-as-router pipeline, and
 * returns an AnswerEnvelope the UI renders directly.
 *
 * Note on status codes: routing failures (an unsupported question, or an upstream
 * API/DB error) are PRODUCT STATES carried inside the envelope (kind 'unsupported' |
 * 'error'), not transport errors — so those still return HTTP 200. We reserve 400
 * for a genuinely malformed request (missing/oversized/non-string question), which
 * never reached the router.
 */

import { NextResponse } from "next/server";

import { answerQuestion } from "@/lib/ai/router";

// The single Anthropic call plus DB work can take a few seconds (and longer on a
// Neon cold start); give the function headroom beyond the default.
export const maxDuration = 30;

/** Reject absurdly long inputs before spending a model call on them. */
const MAX_QUESTION_LENGTH = 500;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const question = (body as { question?: unknown })?.question;
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'question' string." },
      { status: 400 },
    );
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const envelope = await answerQuestion(question.trim());
  return NextResponse.json(envelope);
}
