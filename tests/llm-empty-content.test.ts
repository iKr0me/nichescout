import test from "node:test";
import assert from "node:assert/strict";
import { interpretGoal } from "../lib/llm.ts";
import { ApiUsageTracker } from "../lib/cache.ts";

/**
 * Regression test for the live integration bug found on 2026-09-19:
 * gpt-5-mini returned HTTP 200 with EMPTY content (reasoning tokens consumed
 * the completion budget), which surfaced as a confusing
 * "constraints.searchPhrases: must be array of 1–3 strings" validation error.
 *
 * The fix: callLLM must throw a clear error naming the finish_reason when the
 * content is empty/unparseable, instead of passing null downstream.
 */

function mockOpenAI(content: string, finishReason = "length") {
  const orig = globalThis.fetch;
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { input_tokens: 10, output_tokens: 400 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
    if (origKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origKey;
  };
}

test("interpretGoal: empty LLM content raises a clear error, not a validation error", async () => {
  const restore = mockOpenAI("", "length");
  try {
    await assert.rejects(
      interpretGoal("desk accessories under $12", new ApiUsageTracker()),
      /no parseable JSON content.*finish_reason=length/i,
    );
  } finally {
    restore();
  }
});

test("interpretGoal: unparseable (non-JSON) content raises the same clear error", async () => {
  const restore = mockOpenAI("not json at all", "stop");
  try {
    await assert.rejects(
      interpretGoal("desk accessories under $12", new ApiUsageTracker()),
      /no parseable JSON content.*finish_reason=stop/i,
    );
  } finally {
    restore();
  }
});
