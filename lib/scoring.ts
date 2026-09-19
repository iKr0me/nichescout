/**
 * All 0–100 scoring formulas. Pure functions — no I/O.
 *
 * Inputs are validated to be finite numbers; non-finite values map to
 * neutral (null) outcomes so the engine treats them as missing evidence,
 * not zero. Missing evidence can never silently pass a gate.
 */

const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

const isFiniteNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

// -----------------------------------------------------------------------------
// Margin
// -----------------------------------------------------------------------------

export function marginHealthScore(marginRatio: number): number {
  if (!isFiniteNum(marginRatio) || marginRatio < 0) return 0;
  return clamp((marginRatio / 0.5) * 100, 0, 100);
}

export function marginRejects(
  targetMarketPrice: number | null,
  minSellingPrice: number,
  expectedMargin: number,
  minMargin: number,
): boolean {
  if (targetMarketPrice === null) return true;             // no market data
  if (targetMarketPrice < minSellingPrice) return true;    // uncompetitive at required margin
  if (expectedMargin < minMargin) return true;             // rounding dropped margin below floor
  return false;
}

// -----------------------------------------------------------------------------
// Demand (Google Trends)
// -----------------------------------------------------------------------------

export const FLAT_SLOPE_THRESHOLD = 0.25;     // |s| ≤ this is flat
export const STRONG_DECLINE_THRESHOLD = -3;   // s ≤ -3 points/week rejects

export function directionScore(slope: number): number {
  if (!isFiniteNum(slope)) return 50;                     // unknown → neutral
  if (Math.abs(slope) <= FLAT_SLOPE_THRESHOLD) return 50;
  return slope > 0 ? 100 : 0;
}

export function slopeScore(slope: number): number {
  if (!isFiniteNum(slope)) return 50;
  return clamp(50 + slope * 10, 0, 100);
}

export function stabilityScore(cv: number): number {
  if (!isFiniteNum(cv) || cv < 0) return 0;
  // cv guard: mean ≤ 0 was already collapsed to cv = 1 at compute time.
  return clamp(100 - cv * 200, 0, 100);
}

export function momentumScore(
  direction: number,
  slope: number,
  stability: number,
): number {
  return 0.4 * direction + 0.35 * slope + 0.25 * stability;
}

export function stronglyDeclining(slope: number): boolean {
  return isFiniteNum(slope) && slope <= STRONG_DECLINE_THRESHOLD;
}

// -----------------------------------------------------------------------------
// Competition (Google Shopping — sample-based, NOT exact saturation)
// -----------------------------------------------------------------------------

export const MIN_SHOPPING_RESULTS = 5;

export function merchantDiversityRisk(uniqueMerchants: number, n: number): number {
  if (!isFiniteNum(uniqueMerchants) || !isFiniteNum(n) || n <= 0) return 0;
  return clamp((uniqueMerchants / n) * 100, 0, 100);
}

/**
 * Re-imported below to allow the new exports to use it; the helper itself
 * is unchanged. multiSellerRisk and reviewConcentrationRisk were removed —
 * Google Shopping does not provide reliable multi-seller data, and reviews
 * are optional information, not required scoring inputs.
 */

export function priceSpreadRisk(spread: number): number {
  if (!isFiniteNum(spread) || spread < 0) return 0;
  // spread = 0 → 100 risk (commoditized); spread ≥ 0.5 → 0 risk.
  return clamp(100 - spread * 200, 0, 100);
}

/**
 * Saturation risk from the two verified Google Shopping inputs:
 *  - merchantDiversityRisk (more unique merchants = more competition)
 *  - priceSpreadRisk (tighter spread = more commoditized)
 *
 * Reviews are excluded — they are optional information, not required scoring
 * inputs. Multi-seller was excluded because Google Shopping does not provide
 * reliable per-listing multi-seller data; the SerpApi free tier returns 0
 * hits on exact-title matching.
 */
export function saturationRisk(opts: {
  merchantDiversityRisk: number;
  priceSpreadRisk: number;
}): number | null {
  // Both required: any missing evidence → null (never a favorable score).
  if (!isFiniteNum(opts.merchantDiversityRisk)) return null;
  if (!isFiniteNum(opts.priceSpreadRisk)) return null;
  return 0.6 * opts.merchantDiversityRisk + 0.4 * opts.priceSpreadRisk;
}

export const SATURATION_RISK_REJECT = 85;

export const SCORING_VERSION = "competition-estimate-2026-03";

export function competitionOpportunity(risk: number): number {
  return clamp(100 - risk, 0, 100);
}

// -----------------------------------------------------------------------------
// Fulfillment (CJ-based — evidence only, no invented reliability)
// -----------------------------------------------------------------------------

export function shippingAvailabilityScore(available: boolean): number {
  return available ? 100 : 0;
}

export function deliveryRangeScore(
  upperDays: number | null,
  maxShippingDays: number,
): number {
  if (!isFiniteNum(upperDays)) return 0;
  if (upperDays > maxShippingDays) return 0;
  return clamp(100 - (upperDays / maxShippingDays) * 40, 0, 100);
}

export function inventoryScore(stock: number | null): number {
  if (stock === null) return 0;                           // UNKNOWN maps to 0
  if (stock <= 0) return 0;
  return clamp(Math.min(stock, 100), 0, 100);
}

export function dataCompletenessScore(present: number, total: number): number {
  if (!isFiniteNum(total) || total <= 0) return 0;
  return clamp((present / total) * 100, 0, 100);
}

export function fulfillmentScore(opts: {
  shippingAvailability: boolean;
  upperDays: number | null;
  maxShippingDays: number;
  stock: number | null;
  fieldsComplete: number;
  fieldsTotal: number;
}): number {
  return (
    0.35 * shippingAvailabilityScore(opts.shippingAvailability) +
    0.3 * deliveryRangeScore(opts.upperDays, opts.maxShippingDays) +
    0.2 * inventoryScore(opts.stock) +
    0.15 * dataCompletenessScore(opts.fieldsComplete, opts.fieldsTotal)
  );
}

// -----------------------------------------------------------------------------
// Composite
// -----------------------------------------------------------------------------

export const COMPOSITE_WEIGHTS = {
  margin: 0.35,
  momentum: 0.25,
  competition: 0.25,
  fulfillment: 0.15,
};

export function compositeScore(opts: {
  margin: number | null;
  momentum: number | null;
  competitionOpportunity: number | null;
  fulfillment: number | null;
}): number | null {
  const terms: Array<[number, number]> = [];
  if (opts.margin !== null) terms.push([COMPOSITE_WEIGHTS.margin, opts.margin]);
  if (opts.momentum !== null) terms.push([COMPOSITE_WEIGHTS.momentum, opts.momentum]);
  if (opts.competitionOpportunity !== null)
    terms.push([COMPOSITE_WEIGHTS.competition, opts.competitionOpportunity]);
  if (opts.fulfillment !== null) terms.push([COMPOSITE_WEIGHTS.fulfillment, opts.fulfillment]);

  // Missing evidence (e.g. competition evidence insufficient) — per plan:
  // "do not omit the competition term and renormalize the other weights.
  //  Do not calculate a composite score at all."
  if (terms.length < 4) return null;

  const weightSum = terms.reduce((s, [w]) => s + w, 0);
  if (weightSum === 0) return null;
  return terms.reduce((s, [w, v]) => s + (w / weightSum) * v, 0);
}
