/**
 * /api/interpret — Call 1: free-text goal → structured Constraints.
 *
 * Server-side:
 *   - validates the LLM output via validateConstraints (throws on bad ranges)
 *   - the caller edits the returned constraints on a confirmation screen
 *   - the rendered constraints are then submitted to /api/evaluate
 */

import { NextRequest, NextResponse } from "next/server";
import { interpretGoal } from "@/lib/llm";
import { ApiUsageTracker, cacheResetStats } from "@/lib/cache";
import { validateConstraints } from "@/lib/validation";
import type { InterpretResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json({ error: "goal: required non-empty string" }, { status: 400 });
    }
    cacheResetStats();
    const usage = new ApiUsageTracker();
    const c = await interpretGoal(goal, usage);

    // Final server-side validation pass. interpretGoal already calls the
    // validator internally; this guard catches any drift between schema and
    // runtime validation.
    validateConstraints(c);

    const res: InterpretResponse = { constraints: c };
    return NextResponse.json({
      ...res,
      apiUsage: {
        cjCalls: usage.cjCalls,
        serpApiCalls: usage.serpApiCalls,
        openaiCalls: usage.openaiCalls,
        llmInputTokens: usage.llmInputTokens,
        llmOutputTokens: usage.llmOutputTokens,
        llmModel: usage.llmModel,
        cacheHits: 0,
        cacheMisses: 0,
        cacheMode: "none",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "interpret failed" },
      { status: 400 },
    );
  }
}
