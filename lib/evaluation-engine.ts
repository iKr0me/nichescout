/**
 * Evaluation engine — deterministic financial calculations + scoring with
 * rejection gates. Pure where possible; orchestrators handle I/O.
 *
 * Contract:
 *  - "missing required evidence" never passes a rejection gate. Evidence
 *    that is null/unknown produces a rejection reason, not a silent pass.
 *  - The competition dimension uses simplified inputs (merchant diversity +
 *    price spread). <5 results OR mixed currencies → product goes to
 *    needsMoreEvidenceProducts (caller's responsibility — the engine does
 *    not "rank" without all four dimensions).
 *  - Currency is never assumed from country. Provider-supplied explicit code
 *    only.
 *  - Shipping availability, missing freight data, out-of-stock, and
 *    out-of-range delivery are rejection reasons, not favorable scores.
 */

import type {
  ApiUsage, CJVariant, Constraints, CJCandidate, CJFreight,
  Evaluation, Evaluation as EvaluationT, EvidenceItem, NeedsMoreEvidence, Rejection,
} from "./types.ts";
import type { CurrencyCode } from "./validation.ts";
import { ApiUsageTracker } from "./cache.ts";
import { calculateFreight, getStock } from "./cj-client.ts";
import { getShopping, getTrends, type ShoppingAnalysis } from "./serp-client.ts";
import {
  compositeScore, competitionOpportunity, directionScore, fulfillmentScore,
  inventoryScore as invScore0, marginHealthScore, marginRejects,
  merchantDiversityRisk, momentumScore, priceSpreadRisk, SATURATION_RISK_REJECT,
  SCORING_VERSION, slopeScore, stabilityScore, stronglyDeclining, COMPOSITE_WEIGHTS,
} from "./scoring.ts";
import { linearRegressionSlope, coefficientOfVariation } from "./stats.ts";
import { totalFreightCost } from "./cj-parse.ts";

export const MIN_SHOPPING_RESULTS = 5;
export const MAX_FINALISTS = 5;

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

function asMoney(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

export type Financials = {
  landedCost: number;             // productCost + freightCost (used freight cost)
  productCost: number;
  freightCost: number | null;     // null = no valid freight
  minSellingPrice: number;
  targetMarketPrice: number | null;
  suggestedPrice: number | null;
  expectedMargin: number | null;
};

export function computeFinancials(opts: {
  productCost: number;
  freightCost: number | null;    // null when shipping unavailable
  marketMedianPrice: number | null;
  minMargin: number;              // floor
}): Financials {
  const productCost = opts.productCost;
  const freightCost = opts.freightCost;
  const landedCost = productCost + (freightCost ?? 0);
  const minSellingPrice = landedCost / (1 - opts.minMargin);
  const targetMarketPrice = opts.marketMedianPrice === null ? null : opts.marketMedianPrice * 0.95;

  let suggestedPrice: number | null = null;
  let expectedMargin: number | null = null;
  if (targetMarketPrice !== null && targetMarketPrice >= minSellingPrice) {
    suggestedPrice = Math.round(targetMarketPrice * 100) / 100;
    expectedMargin = (suggestedPrice - landedCost) / suggestedPrice;
    // Re-check after rounding; price CANNOT be raised to make margin pass.
    if (expectedMargin < opts.minMargin) {
      suggestedPrice = null;
      expectedMargin = null;
    }
  }
  return {
    landedCost,
    productCost,
    freightCost,
    minSellingPrice,
    targetMarketPrice,
    suggestedPrice,
    expectedMargin,
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type Evaluated = {
  evaluation: Evaluation;
  approved: boolean;
  rejectionReasons: string[];        // populated when approved=false
  needsMoreEvidenceReason: string | null; // populated when missing evidence
};

type TrendsTrends = { points: number[]; risingQueries: string[]; fetchedAt: string };

/**
 * Compute Trends stats from a SINGLE series. Series are NEVER concatenated —
 * each phrase is normalized independently by Google Trends, so mixing them
 * yields a meaningless slope/CV. Callers pass exactly one series.
 */
function summarizeTrends(series: TrendsTrends): {
  slope: number | null;
  stability: number | null;
  direction: number | null;
  strongDecline: boolean;
  risingQueries: string[];
  fetchedAt: string;
} {
  const points = series.points;
  const slope = linearRegressionSlope(points);
  const stability = points.length ? coefficientOfVariation(points) : null;
  const direction = slope === null ? null : directionScore(slope);
  const strong = slope !== null && stronglyDeclining(slope);
  return {
    slope,
    stability,
    direction,
    strongDecline: strong,
    risingQueries: series.risingQueries,
    fetchedAt: series.fetchedAt,
  };
}

function buildEvidenceItem(
  label: string, value: string, source: string, fetchedAt: string,
): EvidenceItem {
  return { label, value, source, fetchedAt };
}

/**
 * Evaluate one candidate + shopping evidence. Pure apart from the optional
 * stock fetch that the caller may have supplied; we accept a pre-fetched
 * inventory to keep this function side-effect-free. Currency comes from
 * Shopping results (provider) — never from the destination country.
 */
export function evaluateCandidate(
  candidate: CJCandidate,
  constraints: Constraints,
  shopping: ShoppingAnalysis | null,
  trends: { slope: number | null; stability: number | null; direction: number | null; strongDecline: boolean; risingQueries: string[]; fetchedAt: string } | null,
  inventory: CJVariant["inventory"],
  evidenceTs: string,
): Evaluated {
  const variant = candidate.variant;
  const freight: CJFreight | null = candidate.freight;
  const fetchedAt = evidenceTs;

  const shoppingCurrency = shopping?.currency ?? "UNKNOWN";
  // CJ sells in USD (variantSellPrice + logisticPrice). The Shopping median must
  // be the SAME currency to compute a valid margin — otherwise the costs and
  // the market price are incomparable and we treat market evidence as unusable.
  const currencyCompatible = shoppingCurrency === "USD";
  const canUseMarket =
    shopping !== null &&
    shopping.medianPrice !== null &&
    shopping.sampleSize >= MIN_SHOPPING_RESULTS &&
    shoppingCurrency !== "UNKNOWN" &&
    currencyCompatible;
  const marketMedian = canUseMarket ? shopping!.medianPrice : null;

  // Currency must be provider-supplied and explicit. Destination-country-based
  // inference is disabled. The destination country is used for shipping only.
  const currency = canUseMarket ? shoppingCurrency : "UNKNOWN";

  // Financials — use validated TOTAL freight (logisticPrice + taxes + clearance)
  // so CJ costs are never mixed into a different currency or a partial figure.
  const financials = computeFinancials({
    productCost: variant.variantSellPrice,
    freightCost: totalFreightCost(freight),
    marketMedianPrice: marketMedian,
    minMargin: constraints.minMargin,
  });

  // Margin
  const marginRejectReasons: string[] = [];
  if (freight === null) {
    marginRejectReasons.push(
      `No shipping method to ${constraints.destinationCountry} within ${constraints.maxShippingDays} days`,
    );
  }
  if (!canUseMarket) {
    marginRejectReasons.push(
      shopping === null
        ? "Market evidence unavailable"
        : shopping!.sampleSize < MIN_SHOPPING_RESULTS
          ? `Only ${shopping!.sampleSize} usable Shopping results (minimum ${MIN_SHOPPING_RESULTS})`
          : shoppingCurrency === "UNKNOWN"
            ? `Currency disagreement across Shopping results (got ${shoppingCurrency}; all results must agree)`
            : `Market currency ${shoppingCurrency} cannot be compared to CJ's USD costs`,
    );
  }
  if (marketMedian !== null && financials.suggestedPrice === null) {
    marginRejectReasons.push(
      `Uncompetitive at required margin: target ${financials.targetMarketPrice?.toFixed(2)} below min profitable ${financials.minSellingPrice.toFixed(2)} (landed cost ${financials.landedCost.toFixed(2)})`,
    );
  }

  // Margin score is null when there's no suggested price; the composite
  // requires it.
  const marginScore =
    financials.suggestedPrice !== null
      ? marginHealthScore(financials.expectedMargin ?? 0)
      : null;

  // Demand — strong decline rejects, slight decline just lowers the score.
  let momentum: number | null = null;
  if (trends && trends.slope !== null && trends.stability !== null && trends.direction !== null) {
    momentum = momentumScore(
      trends.direction,
      slopeScore(trends.slope),
      stabilityScore(trends.stability),
    );
  }

  // Competition — simplified two-input formula.
  let saturation: number | null = null;
  let opp: number | null = null;
  if (canUseMarket && shopping) {
    saturation = (() => {
      // All required inputs: skip on missing.
      const m = shopping.uniqueMerchants;
      const spread = shopping.priceSpread;
      const mr = merchantDiversityRisk(m, shopping.sampleSize);
      const psr = priceSpreadRisk(spread);
      if (!Number.isFinite(mr) || !Number.isFinite(psr)) return null;
      return 0.6 * mr + 0.4 * psr;
    })();
    opp = saturation === null ? null : competitionOpportunity(saturation);
  }

  // Fulfillment
  const fieldsComplete = [
    freight !== null,
    freight && typeof freight?.deliveryUpperDays === "number" && freight.deliveryUpperDays >= 0,
    typeof variant.variantSellPrice === "number" && variant.variantSellPrice > 0,
    typeof variant.variantWeight === "number" && variant.variantWeight >= 0,
    inventory !== null,
  ].filter(Boolean).length;
  const fieldsTotal = 5;
  const shipAvail = freight !== null;
  const upperDays = freight?.deliveryUpperDays ?? null;
  const maxShip = constraints.maxShippingDays;
  // Inventory policy: only `factory` (the supplier-held count) is used to
  // determine "is this shippable?" CJ-held 0 means the item ships from
  // the factory — that is fine. Unknown inventory stays unknown and the
  // fulfillment score collapses to 0 (the engine treats it as missing).
  const factoryStock =
    inventory && typeof inventory.factory === "number" && inventory.factory > 0
      ? inventory.factory
      : null;
  const fulfillment = fulfillmentScore({
    shippingAvailability: shipAvail,
    upperDays,
    maxShippingDays: maxShip,
    stock: factoryStock,
    fieldsComplete,
    fieldsTotal,
  });

  // Composite requires all four dimensions present (no renormalization).
  const composite = compositeScore({
    margin: marginScore,
    momentum: momentum,
    competitionOpportunity: opp,
    fulfillment,
  });

  // Reject reasons accumulate across dimensions
  const rejectionReasons: string[] = [...marginRejectReasons];

  // Strong decline is a hard reject.
  if (trends && trends.strongDecline) {
    rejectionReasons.push(
      `Strong demand decline: trend slope ≤ -3 points/week (${trends.slope?.toFixed(2)})`,
    );
  }

  // Saturation > threshold rejects.
  if (saturation !== null && saturation > SATURATION_RISK_REJECT) {
    rejectionReasons.push(
      `Saturation risk ${saturation.toFixed(1)} exceeds ${SATURATION_RISK_REJECT}. Sample: ${shopping!.uniqueMerchants} unique merchants of ${shopping!.sampleSize} results in ${currency}.`,
    );
  }

  // Delivery range: enforce upperDays ≤ maxShippingDays.
  if (shipAvail && upperDays !== null && upperDays > maxShip) {
    rejectionReasons.push(`Estimated delivery ${upperDays} days exceeds max ${maxShip}`);
  }

  // Out-of-stock via factory = 0 (CJ-held 0 is allowed since the item can
  // ship from the factory).
  if (inventory && inventory.factory !== null && inventory.factory <= 0) {
    rejectionReasons.push("Variant factory stock is 0 — cannot fulfill");
  }

  // Missing required evidence cannot pass.
  const needsMoreEvidence =
    composite === null && shippingAndMarketUsable(shipAvail, canUseMarket);

  const evidence: EvidenceItem[] = [];
  evidence.push(
    buildEvidenceItem(
      "CJ product/variant selected",
      `${candidate.title} (variant ${variant.vid})`,
      "cjdropshipping.com developer docs",
      fetchedAt,
    ),
    buildEvidenceItem(
      "Variant cost (CJ)",
      `$${variant.variantSellPrice.toFixed(2)}`,
      "cjdropshipping.com developer docs",
      fetchedAt,
    ),
    buildEvidenceItem(
      "Variant weight",
      `${variant.variantWeight ?? "unknown"} g`,
      "cjdropshipping.com developer docs",
      fetchedAt,
    ),
    buildEvidenceItem(
      "Stock at origin",
      inventory
        ? `CJ-held ${inventory.cjHeld ?? "n/a"}, factory ${inventory.factory ?? "n/a"} (${inventory.rowCount} row(s))`
        : "unknown — stock/queryByVid did not match a row for the origin country",
      "cjdropshipping.com developer docs",
      fetchedAt,
    ),
    buildEvidenceItem(
      "Freight to destination",
      freight
        ? `${freight.logisticName} — $${(freight.totalPostageFee ?? 0).toFixed(2)} (total postage), ${freight.logisticAgingRaw} (upper bound ${freight.deliveryUpperDays ?? "?"} days)`
        : `No valid freight method returned that lands within ${maxShip} days`,
      "cjdropshipping.com developer docs",
      fetchedAt,
    ),
  );
  if (shopping) {
    evidence.push(buildEvidenceItem(
      "Shopping samples",
      `${shopping.sampleSize} results, ${shopping.uniqueMerchants} unique merchants, ${currency}, median $${shopping.medianPrice?.toFixed(2) ?? "?"}, spread ${shopping.priceSpread.toFixed(2)}`,
      "google.com/search?tbm=shop",
      fetchedAt,
    ));
  }
  if (trends) {
    evidence.push(buildEvidenceItem(
      "Trends (12-month)",
      `slope ${trends.slope?.toFixed(2) ?? "?"} points/week, CV ${trends.stability?.toFixed(2) ?? "?"}`,
      "trends.google.com/trends/explore",
      fetchedAt,
    ));
    if (trends.risingQueries.length) {
      evidence.push(buildEvidenceItem(
        "Related rising queries (discovery)",
        trends.risingQueries.join(", "),
        "trends.google.com/trends/explore",
        fetchedAt,
      ));
    }
  }

  // Deterministic recommendation built from scores/evidence.
  const recommendation = buildRecommendation({
    financials, marginScore, momentumScore: momentum, saturation, opp, fulfillment,
    inventory, freight, constraints, currency,
  });

  const evaluation: Evaluation = {
    productId: candidate.pid,
    variantId: variant.vid,
    title: candidate.title,
    image: candidate.image,
    currency,
    landedCost: financials.landedCost,
    productCost: financials.productCost,
    freightCost: financials.freightCost,
    marketMedianPrice: marketMedian,
    suggestedPrice: financials.suggestedPrice,
    minSellingPrice: financials.minSellingPrice,
    expectedMargin: financials.expectedMargin,
    marketSource: "google_shopping",
    marketMedianSampleSize: shopping?.sampleSize,
    scores: {
      marginScore,
      momentumScore: momentum,
      fulfillmentScore: fulfillment,
      competitionOpportunity: opp,
      saturationRisk: saturation,
      composite,
    },
    evidence,
    inventory,
    recommendation,
  };

  return {
    evaluation,
    approved: rejectionReasons.length === 0 && !needsMoreEvidence && composite !== null,
    rejectionReasons: needsMoreEvidence ? [] : rejectionReasons,
    needsMoreEvidenceReason: needsMoreEvidence
      ? needsMoreEvidenceReasonFor(freight, shopping, canUseMarket, currency, constraints, shoppingCurrency)
      : null,
  };
}

function needsMoreEvidenceReasonFor(
  freight: CJFreight | null,
  shopping: ShoppingAnalysis | null,
  canUseMarket: boolean,
  currency: CurrencyCode,
  constraints: Constraints,
  shoppingCurrency: CurrencyCode,
): string {
  const reasons: string[] = [];
  if (freight === null) {
    reasons.push(`no shipping method to ${constraints.destinationCountry} within ${constraints.maxShippingDays} days`);
  }
  if (!canUseMarket) {
    if (shopping === null) reasons.push("market evidence unavailable");
    else if (shopping.sampleSize < MIN_SHOPPING_RESULTS)
      reasons.push(`only ${shopping.sampleSize} usable market results (minimum ${MIN_SHOPPING_RESULTS})`);
    else if (shoppingCurrency === "UNKNOWN")
      reasons.push("no currency code on market results");
    else if (currency !== "USD")
      reasons.push(`market currency ${shoppingCurrency} cannot be compared to supplier USD`);
  }
  return reasons.length ? "Needs more evidence — " + reasons.join("; ") : "Needs more evidence";
}

function shippingAndMarketUsable(ship: boolean, market: boolean): boolean {
  // "needs more evidence" is specifically about competition; only flag when
  // market is unavailable, since the engine requires market evidence to
  // calculate competition. If shipping is missing, the product is rejected
  // outright (not just "needs more evidence").
  return ship && !market;
}

function buildRecommendation(opts: {
  financials: Financials; marginScore: number | null; momentumScore: number | null;
  saturation: number | null; opp: number | null; fulfillment: number;
  inventory: CJVariant["inventory"]; freight: CJFreight | null;
  constraints: Constraints; currency: CurrencyCode;
}): string {
  const f = opts.financials;
  const lines: string[] = [];
  if (f.suggestedPrice !== null) {
    lines.push(
      `Margin ${(opts.financials.expectedMargin! * 100).toFixed(1)}% at suggested $${f.suggestedPrice.toFixed(2)} ${opts.currency}; landed cost $${f.landedCost.toFixed(2)} (floor $${f.minSellingPrice.toFixed(2)}).`,
    );
  }
  if (opts.momentumScore !== null) {
    lines.push(`Demand momentum ${opts.momentumScore.toFixed(0)}/100.`);
  }
  if (opts.opp !== null && opts.saturation !== null) {
    lines.push(
      `Competition opportunity ${opts.opp.toFixed(0)}/100 (saturation risk ${opts.saturation.toFixed(0)}/100).`,
    );
  }
  const stockDesc =
    opts.inventory && typeof opts.inventory.factory === "number"
      ? `${opts.inventory.factory} factory units`
      : "stock unknown";
  const shipDesc = opts.freight
    ? `${opts.freight.logisticName} (~${opts.freight.deliveryUpperDays ?? "?"} days to ${opts.constraints.destinationCountry})`
    : "no valid shipping method";
  lines.push(`Fulfillment ${opts.fulfillment.toFixed(0)}/100: ${stockDesc}, ${shipDesc}.`);
  return lines.join(" ");
}
