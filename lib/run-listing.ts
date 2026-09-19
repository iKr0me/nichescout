/**
 * Listing orchestration with injected dependencies, so tests can prove that
 * failed approval checks NEVER call the LLM.
 *
 * runListing(deps, request):
 *   1. verify the token (via deps.verifyToken)
 *   2. re-fetch CJ data (deps.refetch)
 *   3. run the pure guard (deps.guard)
 *   4. ONLY if the guard passes, call the LLM (deps.generateListing)
 *
 * Returns a discriminated result so the route can map it to HTTP responses.
 */

import type { CJFreight, CJVariant } from "./types.ts";
import type { ListingResponse } from "./types.ts";
import type { GuardFresh, GuardToken } from "./listing-guard.ts";
import { totalFreightCost } from "./cj-parse.ts";

export type RunDeps = {
  verifyToken: (token: string) => {
    productId: string;
    variantId: string;
    productCost: number;
    freightCost: number | null;
    marketMedianPrice: number | null;
    suggestedPrice: number | null;
    minSellingPrice: number;
    margin: number | null;
    currency: string;
    destinationCountry: string;
    minMargin: number;
    maxShippingDays: number;
    scoringVersion: string;
    constraintFingerprint: string;
  };
  refetch: (
    productId: string,
    variantId: string,
    destinationCountry: string,
    maxShippingDays: number,
  ) => Promise<{
    variant: CJVariant;
    freight: CJFreight | null;
    inventory: CJVariant["inventory"];
    title: string;
    image: string | null;
  } | null>;
  guard: (token: GuardToken, fresh: GuardFresh) => { ok: boolean; reasons?: string[] };
  generateListing: (data: {
    productTitle: string;
    variantNameEn: string | null;
    brand: string | null;
    category: string | null;
    imageUrls: string[];
    suggestedPrice: number;
    currency: string;
    freightDays: number | null;
    destinationCountry: string;
  }) => Promise<{ title: string; description: string; featureBullets: string[] }>;
  expectedScoringVersion: string;
};

export type RunRequest = {
  productId: string;
  variantId: string;
  approvalToken: string;
};

export type RunResult =
  | { ok: true; response: ListingResponse }
  | { ok: false; status: number; error: string; reasons?: string[] };

export async function runListing(deps: RunDeps, req: RunRequest): Promise<RunResult> {
  // 1. Verify the token.
  let token: ReturnType<RunDeps["verifyToken"]>;
  try {
    token = deps.verifyToken(req.approvalToken);
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : "invalid token" };
  }
  if (token.productId !== req.productId || token.variantId !== req.variantId) {
    return { ok: false, status: 400, error: "approval token does not match product/variant" };
  }
  if (token.scoringVersion !== deps.expectedScoringVersion) {
    return {
      ok: false,
      status: 409,
      error: `Scoring version mismatch: signed ${token.scoringVersion}, current ${deps.expectedScoringVersion}`,
    };
  }

  // 2. Re-fetch current CJ data.
  const refetched = await deps.refetch(
    req.productId,
    req.variantId,
    token.destinationCountry,
    token.maxShippingDays,
  );
  if (!refetched) {
    return { ok: false, status: 404, error: "product or variant not found in CJ (or fetch failed)" };
  }

  // 3. Guard — no LLM before this passes.
  const fresh: GuardFresh = {
    productCost: refetched.variant.variantSellPrice,
    freightCost: totalFreightCost(refetched.freight),
    deliveryUpperDays: refetched.freight?.deliveryUpperDays ?? null,
    factoryStock:
      refetched.inventory && typeof refetched.inventory.factory === "number"
        ? refetched.inventory.factory
        : null,
  };
  const guard = deps.guard(
    {
      productId: token.productId,
      variantId: token.variantId,
      productCost: token.productCost,
      freightCost: token.freightCost,
      marketMedianPrice: token.marketMedianPrice,
      suggestedPrice: token.suggestedPrice,
      minSellingPrice: token.minSellingPrice,
      margin: token.margin,
      currency: token.currency,
      destinationCountry: token.destinationCountry,
      minMargin: token.minMargin,
      maxShippingDays: token.maxShippingDays,
      scoringVersion: token.scoringVersion,
    },
    fresh,
  );
  if (!guard.ok) {
    return {
      ok: false,
      status: 409,
      error: "listing approval failed",
      reasons: guard.reasons ?? [],
    };
  }

  // 4. Only now call the LLM.
  const suggestedPrice = token.suggestedPrice as number;   // guard guarantees non-null
  const currency = token.currency.toUpperCase();

  const listing = await deps.generateListing({
    productTitle: refetched.title,
    variantNameEn: refetched.variant.variantNameEn,
    brand: null,
    category: null,
    imageUrls: [refetched.variant.variantImage || refetched.image || ""].filter(Boolean),
    suggestedPrice,
    currency,
    freightDays: refetched.freight?.deliveryUpperDays ?? null,
    destinationCountry: token.destinationCountry,
  });

  // Landed cost uses the SAME validated totalPostageFee used for scoring,
  // signing, and refetch — never the bare logisticPrice.
  const shippingCost = totalFreightCost(refetched.freight) ?? 0;
  const landedCost = refetched.variant.variantSellPrice + shippingCost;
  const margin = shippingCost > 0
    ? (suggestedPrice - landedCost) / suggestedPrice
    : (suggestedPrice - refetched.variant.variantSellPrice) / suggestedPrice;

  const response: ListingResponse = {
    listing: {
      title: listing.title,
      description: listing.description,
      featureBullets: listing.featureBullets,
      suggestedPrice,
      minSellingPrice: token.minSellingPrice,
      currency: currency as ListingResponse["listing"]["currency"],
      images: (refetched.variant.variantImage || refetched.image)
        ? [refetched.variant.variantImage || refetched.image].filter((u): u is string => typeof u === "string" && !!u)
        : [],
      productId: req.productId,
      variantId: req.variantId,
      costBreakdown: {
        productCost: refetched.variant.variantSellPrice,
        freightCost: shippingCost,
        landedCost,
        margin,
      },
    },
    sourceProvenance: {
      reFetchedAt: new Date().toISOString(),
      constraintFingerprint: token.constraintFingerprint,   // original signed fingerprint
    },
  };

  return { ok: true, response };
}
