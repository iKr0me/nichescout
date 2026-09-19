/**
 * /api/evaluate — candidate funnel, deterministic scoring, ranking.
 *
 *  1. Search CJ for each search phrase (separate request, queued 1 req/sec)
 *  2. Pre-freight filters: variant price ≤ maxCost, weight>0, base variant
 *     has numeric cost (not zero)
 *  3. Trim to ≤5 finalists
 *  4. CJ freight for each finalist (filters by deliveryUpperDays ≤ max)
 *  5. Stock query for each variant that has freight
 *  6. Trends for the first phrase
 *  7. Shopping for the first phrase
 *  8. Deterministic scoring engine — emits ranked/needsMoreEvidence/rejected
 *  9. For each ranked candidate, sign an approval token
 *
 * No LLM usage here. At most two LLM calls happen in this workflow — one
 * before this route (interpret), one after approval (in /api/listing).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  calculateFreight, discoverFreightOptions, getProductDetail, getStock, searchProducts,
} from "@/lib/cj-client";
import { getShopping, getTrends, type ShoppingAnalysis } from "@/lib/serp-client";
import { ApiUsageTracker, cacheResetStats } from "@/lib/cache";
import {
  evaluateCandidate, MAX_FINALISTS,
} from "@/lib/evaluation-engine";
import { signApprovalPayload, TOKEN_TTL_SECONDS } from "@/lib/approval-token";
import { detectCurrency, validateConstraints } from "@/lib/validation";
import { linearRegressionSlope, coefficientOfVariation } from "@/lib/stats";
import { totalFreightCost } from "@/lib/cj-parse";
import { isRelevantProduct, relevanceScore } from "@/lib/relevance";
import { broadenPhrase } from "@/lib/phrase-broaden";
import type {
  ApiUsage, CJCandidate, EvaluateRequest, EvaluateResponse, Evaluation,
  SearchSummary,
} from "@/lib/types";
import { SCORING_VERSION } from "@/lib/scoring";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const constraints = validateConstraints(body?.constraints);

    cacheResetStats();
    const usage = new ApiUsageTracker();
    const evidenceTs = new Date().toISOString();

    // 1. Search CJ for each phrase. Take until we have ~20 candidates.
    //    Filter by relevance so CJ's loose full-text search doesn't surface
    //    unrelated products (e.g. "desk accessory" → beaded shoe parts).
    const dedupePids = new Set<string>();
    const candidates: Array<CJCandidate & { relevance: number }> = [];
    let cjSearchesUsed = 0;
    let totalCjResults = 0;
    let passedRelevance = 0;
    let passedPrice = 0;
    let minDeliveryUpper: number | null = null;
    for (const phrase of constraints.searchPhrases) {
      if (cjSearchesUsed >= 3) break;            // plan: ≤3 separate CJ searches
      cjSearchesUsed++;
      try {
        const hits = await searchProducts(phrase, 20, usage);
        totalCjResults += hits.length;
        for (const hit of hits) {
          if (!hit.pid || dedupePids.has(hit.pid)) continue;
          // Relevance gate: drop products whose titles don't share a content
          // word with the search phrase. This catches the common CJ failure
          // where "desk accessory" returns hair bands and shoe charms.
          if (!isRelevantProduct(phrase, hit.title)) continue;
          passedRelevance++;
          dedupePids.add(hit.pid);
          if (candidates.length >= 25) break;        // cap before product details
          const detail = await getProductDetail(hit.pid, usage);
          if (!detail) continue;
          for (const v of detail.variants ?? []) {
            const price = Number(v?.variantSellPrice);
            if (!Number.isFinite(price) || price <= 0) continue;
            if (Number(price) > constraints.maxProductCost) continue;
            passedPrice++;
            const variant = {
              vid: String(v.vid ?? ""),
              pid: hit.pid,
              variantSku: typeof v.variantSku === "string" ? v.variantSku : null,
              variantSellPrice: price,
              variantWeight:
                typeof v.variantWeight === "number" && Number.isFinite(v.variantWeight)
                  ? v.variantWeight
                  : null,
              variantImage: typeof v.variantImage === "string" ? v.variantImage : null,
              variantNameEn: typeof v.variantNameEn === "string" ? v.variantNameEn : null,
              inventory: null,
            };
            if (!variant.vid || !variant.variantImage) continue;
            candidates.push({
              pid: hit.pid,
              title: hit.title,
              image: hit.image,
              variant,
              freight: null,
              relevance: relevanceScore(phrase, hit.title),
            });
            if (candidates.length >= 25) break;
          }
        }
      } catch {
        // continue — next phrase
      }
    }

    // 4. CJ freight for the first MAX_FINALISTS eligible candidates.
    //    Sort by relevance first so the most on-niche products are evaluated.
    candidates.sort((a, b) => b.relevance - a.relevance);
    const finalists: CJCandidate[] = [];
    for (const c of candidates) {
      if (finalists.length >= MAX_FINALISTS) break;
      try {
        const f = await calculateFreight(
          c.variant.vid,
          "CN",
          constraints.destinationCountry,
          constraints.maxShippingDays,
          usage,
        );
        if (!f) {
          // No option within the delivery limit. Discover the shortest
          // available delivery so we can tell the user why nothing qualified.
          if (minDeliveryUpper === null) {
            try {
              const allOpts = await discoverFreightOptions(
                c.variant.vid, "CN", constraints.destinationCountry, usage,
              );
              const uppers = allOpts
                .map((o: any) => {
                  const m = String(o?.logisticAging || "").match(/(\d+)\s*[-–—]\s*(\d+)/);
                  return m ? parseInt(m[2]) : null;
                })
                .filter((n: number | null): n is number => n !== null);
              if (uppers.length) minDeliveryUpper = Math.min(...uppers);
            } catch {}
          }
          continue;
        }
        if (f.deliveryUpperDays !== null) {
          if (minDeliveryUpper === null || f.deliveryUpperDays < minDeliveryUpper) {
            minDeliveryUpper = f.deliveryUpperDays;
          }
        }
        finalists.push({ ...c, freight: f });
      } catch {
        // continue
      }
    }

    // 5. Stock for each finalist. Stored on the variant itself so the
    //    engine can use both the CJ-held vs factory distinction.
    for (const f of finalists) {
      try {
        const inv = await getStock(f.variant.vid, "CN", usage);
        f.variant.inventory = inv;
      } catch {
        f.variant.inventory = null;
      }
    }

    // 6. Trends for the first phrase only (budget: 1 call). Per-phrase
    //    batching is enabled in the client; single phrase is the simplest
    //    case.
    // 6+7. Market data (Trends + Shopping).
    //
    // The interpretation LLM often produces a very specific first phrase
    // (e.g. "lightweight desk organizers") for which Google Shopping returns
    // ZERO results, while a broader sibling phrase ("desk organizer") returns
    // a full page. Only ever querying searchPhrases[0] therefore produces a
    // spurious "needs more evidence" for every candidate.
    //
    // Strategy: try each phrase in order, keeping the first that yields a
    // usable sample (>= MIN_SHOPPING_RESULTS priced results). If none of the
    // supplied phrases work, broaden them (drop modifiers, singularise) and
    // try again — Google Shopping returns zero results for over-specific
    // queries like "lightweight desk organizers" while "desk organizer" has a
    // full page.
    const supplied = constraints.searchPhrases.slice(0, 3);
    const broadened: string[] = [];
    for (const p of supplied) {
      for (const v of broadenPhrase(p)) {
        if (!supplied.includes(v) && !broadened.includes(v)) broadened.push(v);
      }
    }
    const phraseCandidates = [...supplied, ...broadened].slice(0, 7);

    let shopping: ShoppingAnalysis | null = null;
    let shoppingPhrase: string | null = null;
    let bestSoFar: ShoppingAnalysis | null = null;
    let bestPhrase: string | null = null;

    for (const phrase of phraseCandidates) {
      const attempt = await getShopping(phrase, usage).catch(() => null);
      if (!attempt) continue;
      if (attempt.sampleSize >= 5 && attempt.medianPrice !== null) {
        shopping = attempt;
        shoppingPhrase = phrase;
        break;
      }
      if (!bestSoFar || attempt.sampleSize > bestSoFar.sampleSize) {
        bestSoFar = attempt;
        bestPhrase = phrase;
      }
    }
    // No phrase yielded a usable sample — keep the best attempt for diagnostics.
    if (!shopping && bestSoFar) {
      shopping = bestSoFar;
      shoppingPhrase = bestPhrase;
    }

    let trends: Awaited<ReturnType<typeof getTrends>> | null = null;
    let trendsPhrase: string | null = null;
    let bestTrends: Awaited<ReturnType<typeof getTrends>> | null = null;
    for (const phrase of phraseCandidates) {
      const attempt = await getTrends(phrase, usage).catch(() => null);
      if (!attempt) continue;
      if (attempt.points.length >= 12) {
        trends = attempt;
        trendsPhrase = phrase;
        break;
      }
      if (!bestTrends || attempt.points.length > bestTrends.points.length) {
        bestTrends = attempt;
      }
    }
    if (!trends && bestTrends) trends = bestTrends;

    // 8. Evaluate each finalist. Partition outcomes.
    const ranked: Evaluation[] = [];
    const needsMore: { productId: string; variantId: string; reason: string }[] = [];
    const rejected: { productId: string; variantId: string; reasons: string[] }[] = [];

    const trendsSummary = trends
      ? (() => {
          const slope = linearRegressionSlope(trends.points);
          const cv = trends.points.length ? coefficientOfVariation(trends.points) : null;
          return {
            slope,
            stability: cv,
            direction: slope === null ? null : (Math.abs(slope) <= 0.25 ? 50 : slope > 0 ? 100 : 0),
            strongDecline: slope !== null && slope <= -3,
            risingQueries: trends.risingQueries,
            fetchedAt: trends.fetchedAt,
          };
        })()
      : null;

    for (const cand of finalists) {
      const evaluated = evaluateCandidate(
        cand,
        constraints,
        shopping,
        trendsSummary,
        cand.variant.inventory,
        evidenceTs,
      );
      if (evaluated.approved) {
        // Sign an approval token for this ranked product.
        try {
          const token = signApprovalPayload(
            {
              productId: cand.pid,
              variantId: cand.variant.vid,
              productCost: cand.variant.variantSellPrice,
              freightCost: totalFreightCost(cand.freight),
              marketMedianPrice: evaluated.evaluation.marketMedianPrice,
              suggestedPrice: evaluated.evaluation.suggestedPrice,
              minSellingPrice: evaluated.evaluation.minSellingPrice,
              margin: evaluated.evaluation.expectedMargin,
              currency: evaluated.evaluation.currency,
              destinationCountry: constraints.destinationCountry,
              minMargin: constraints.minMargin,
              maxShippingDays: constraints.maxShippingDays,
              scoringVersion: SCORING_VERSION,
              evaluatedAt: Math.floor(Date.now() / 1000),
              expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
            },
            constraints,
          );
          const rankedE = { ...evaluated.evaluation, approvalToken: token };
          ranked.push(rankedE);
        } catch {
          // signature secret missing — skip token but still keep ranked.
          ranked.push(evaluated.evaluation);
        }
      } else if (evaluated.needsMoreEvidenceReason) {
        needsMore.push({
          productId: cand.pid,
          variantId: cand.variant.vid,
          reason: evaluated.needsMoreEvidenceReason,
        });
      } else {
        rejected.push({
          productId: cand.pid,
          variantId: cand.variant.vid,
          reasons: evaluated.rejectionReasons,
        });
      }
    }

    // 9. Sort ranked by composite descending.
    ranked.sort((a, b) => (b.scores.composite ?? -1) - (a.scores.composite ?? -1));
    const finalRanked = ranked.slice(0, MAX_FINALISTS);

    const apiUsage: ApiUsage = {
      cjCalls: usage.cjCalls,
      serpApiCalls: usage.serpApiCalls,
      openaiCalls: usage.openaiCalls,
      cacheHits: 0,
      cacheMisses: 0,
      llmInputTokens: usage.llmInputTokens,
      llmOutputTokens: usage.llmOutputTokens,
      llmModel: usage.llmModel,
    };

    // Build a search summary explaining the funnel outcome.
    let noCandidatesReason: string | null = null;
    const marketMissing =
      shopping === null || shopping.sampleSize < 5 || shopping.medianPrice === null;

    if (finalists.length === 0) {
      if (totalCjResults === 0) {
        noCandidatesReason = "CJ returned no products for this search phrase. Try a different or broader niche description.";
      } else if (marketMissing) {
        // Market data is the blocker, not the supplier side. Say so plainly —
        // this is the most common cause of "needs more evidence everywhere".
        noCandidatesReason =
          `No market prices found for ${JSON.stringify(shoppingPhrase ?? constraints.searchPhrases[0])}. ` +
          `Google Shopping returned ${shopping?.sampleSize ?? 0} usable result(s). ` +
          "Try a simpler, more generic product phrase (for example \"desk organizer\" instead of \"lightweight desk organizers\").";
      } else if (passedRelevance === 0) {
        noCandidatesReason = `${totalCjResults} product(s) found on CJ, but none matched your niche closely enough. Try a more specific search phrase.`;
      } else if (passedPrice === 0) {
        noCandidatesReason = `${passedRelevance} relevant product(s) found, but all exceeded your max cost of $${constraints.maxProductCost}. Try increasing the cost limit.`;
      } else if (minDeliveryUpper !== null) {
        noCandidatesReason = `Shipping to ${constraints.destinationCountry} takes at least ${minDeliveryUpper} days — exceeding your ${constraints.maxShippingDays}-day limit. Try increasing max shipping days to ${minDeliveryUpper} or more.`;
      } else {
        noCandidatesReason = `No shipping methods available to ${constraints.destinationCountry}. This destination may not be supported by CJ's logistics network.`;
      }
    }
    const searchSummary: SearchSummary = {
      cjResultsFound: totalCjResults,
      passedRelevance,
      passedPrice,
      hadValidFreight: finalists.length,
      minDeliveryDaysFound: minDeliveryUpper,
      noCandidatesReason,
    };

    const res: EvaluateResponse = {
      rankedProducts: finalRanked,
      needsMoreEvidenceProducts: needsMore,
      rejectedProducts: rejected,
      searchSummary,
      apiUsage,
    };
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evaluate failed" },
      { status: 400 },
    );
  }
}

