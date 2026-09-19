/**
 * /api/listing — server-signed, server-validated listing generation.
 *
 * Thin HTTP wrapper around lib/run-listing.ts, which:
 *   1. verifies the approval token (signature + expiry + scoring version),
 *   2. re-fetches CJ product/variant/freight/stock using values bound IN the token,
 *   3. runs the pure guard (shipping, stock, cost, currency, delivery, margin),
 *   4. only on success calls the LLM (Call 2) with the SIGNED price + currency.
 *
 * No fallback prices; no re-derived currency; the original signed constraint
 * fingerprint is preserved verbatim.
 */

import { NextRequest, NextResponse } from "next/server";
import { refetchApprovedCandidate } from "@/lib/cj-client";
import { ApiUsageTracker, cacheResetStats } from "@/lib/cache";
import { generateListing } from "@/lib/llm";
import { verifyApprovalToken } from "@/lib/approval-token";
import { guardListing } from "@/lib/listing-guard";
import { runListing } from "@/lib/run-listing";
import { SCORING_VERSION } from "@/lib/scoring";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  cacheResetStats();
  const usage = new ApiUsageTracker();

  const body = await req.json().catch(() => null);
  const productId = String(body?.productId || "");
  const variantId = String(body?.variantId || "");
  const approvalToken = String(body?.approvalToken || "");

  const result = await runListing(
    {
      verifyToken: (t) => verifyApprovalToken(t),
      refetch: (p, v, country, days) =>
        refetchApprovedCandidate(p, v, country, "CN", days, usage),
      guard: guardListing,
      generateListing: (d) =>
        generateListing(
          { ...d, currency: d.currency as "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY" | "CNY" | "UNKNOWN" },
          usage,
        ),
      expectedScoringVersion: SCORING_VERSION,
    },
    { productId, variantId, approvalToken },
  );

  if (!result.ok) {
    return NextResponse.json(
      result.reasons
        ? { error: result.error, reasons: result.reasons }
        : { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ...result.response,
    apiUsage: {
      cjCalls: usage.cjCalls,
      serpApiCalls: usage.serpApiCalls,
      openaiCalls: usage.openaiCalls,
      llmInputTokens: usage.llmInputTokens,
      llmOutputTokens: usage.llmOutputTokens,
      llmModel: usage.llmModel,
      cacheHits: 0,
      cacheMisses: 0,
    },
  });
}
