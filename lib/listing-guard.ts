/**
 * Listing approval guard — pure, testable. Runs BEFORE the LLM (Call 2) in
 * /api/listing. It re-validates fresh CJ data against the signed approval
 * token and the current scoring version, and returns a list of rejection
 * reasons. An empty list means approval may proceed.
 *
 * No I/O, no LLM. This module is unit-tested with mocked fresh data to prove
 * that every failed check produces a rejection and that the caller never
 * invokes the LLM when `ok` is false.
 */

import { isKnownCurrencyCode } from "./validation.ts";
import { SCORING_VERSION } from "./scoring.ts";

export type GuardToken = {
  productId: string;
  variantId: string;
  productCost: number;
  freightCost: number | null;      // signed TOTAL freight (logisticPrice + taxes + clearance)
  marketMedianPrice: number | null;
  suggestedPrice: number | null;
  minSellingPrice: number;
  margin: number | null;
  currency: string;
  destinationCountry: string;
  minMargin: number;
  maxShippingDays: number;
  scoringVersion: string;
};

export type GuardFresh = {
  productCost: number | null;      // from re-fetched CJ variant
  freightCost: number | null;      // TOTAL freight (validated)
  deliveryUpperDays: number | null;
  factoryStock: number | null;     // null = stock unknown
};

export type GuardResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

const TOLERANCE = 0.01;   // 1% relative drift tolerance

const isFiniteNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

export function guardListing(token: GuardToken, fresh: GuardFresh): GuardResult {
  const reasons: string[] = [];

  // 0. Validate EVERY signed numeric bound BEFORE any comparison.
  //    A malformed token must fail closed, not drift into a comparison that
  //    silently passes (e.g. NaN comparisons are always false).
  if (!isFiniteNum(token.productCost) || token.productCost <= 0) {
    reasons.push("Signed productCost missing/invalid (must be finite > 0)");
  }
  if (token.freightCost !== null && (!isFiniteNum(token.freightCost) || token.freightCost < 0)) {
    reasons.push("Signed freightCost invalid (must be finite ≥ 0)");
  }
  if (!isFiniteNum(token.minSellingPrice) || token.minSellingPrice <= 0) {
    reasons.push("Signed minSellingPrice invalid (must be finite > 0)");
  }
  if (!Number.isInteger(token.maxShippingDays) || token.maxShippingDays < 1 || token.maxShippingDays > 60) {
    reasons.push("Signed maxShippingDays invalid (must be integer in [1, 60])");
  }
  if (!isFiniteNum(token.minMargin) || token.minMargin <= 0 || token.minMargin >= 1) {
    reasons.push("Signed minMargin invalid (must be finite in (0, 1))");
  }
  if (
    token.suggestedPrice === null ||
    !isFiniteNum(token.suggestedPrice) ||
    token.suggestedPrice <= 0
  ) {
    reasons.push("Signed suggestedPrice missing/invalid (must be finite > 0)");
  }

  // 1. Scoring version must match the formula the approval was signed under.
  if (token.scoringVersion !== SCORING_VERSION) {
    reasons.push(
      `Scoring version mismatch: approval signed under "${token.scoringVersion}", current "${SCORING_VERSION}"`,
    );
  }

  // 2. Shipping must be available (fresh total freight present and valid).
  if (fresh.freightCost === null || !isFiniteNum(fresh.freightCost) || fresh.freightCost < 0) {
    reasons.push(
      `No valid shipping to ${token.destinationCountry} within ${token.maxShippingDays} days`,
    );
  }

  // 3. Stock must be available (unknown/non-finite/≤0 all reject).
  if (fresh.factoryStock === null || !isFiniteNum(fresh.factoryStock)) {
    reasons.push("Stock unavailable (unknown or non-finite)");
  } else if (fresh.factoryStock <= 0) {
    reasons.push("Variant out of stock");
  }

  // 4. Product cost must be valid and not drifted (only when signed is valid).
  if (fresh.productCost === null || !isFiniteNum(fresh.productCost) || fresh.productCost <= 0) {
    reasons.push("Invalid product cost");
  } else if (
    isFiniteNum(token.productCost) && token.productCost > 0 &&
    Math.abs(fresh.productCost - token.productCost) > TOLERANCE * fresh.productCost
  ) {
    reasons.push(
      `Product cost drifted: signed ${token.productCost}, live ${fresh.productCost}`,
    );
  }

  // 5. Freight cost drift limit (compare TOTAL freight against signed TOTAL).
  if (
    fresh.freightCost !== null && isFiniteNum(fresh.freightCost) &&
    token.freightCost !== null && isFiniteNum(token.freightCost) &&
    Math.abs(fresh.freightCost - token.freightCost) > TOLERANCE * Math.max(1, fresh.freightCost)
  ) {
    reasons.push(
      `Freight cost drifted: signed ${token.freightCost}, live ${fresh.freightCost}`,
    );
  }

  // 6. Currency must be a known ISO code (the SIGNED currency, not re-derived).
  if (!isKnownCurrencyCode(token.currency)) {
    reasons.push(`Invalid currency "${token.currency}"`);
  }

  // 7. Delivery time must be a valid number and not exceed the signed max.
  if (fresh.deliveryUpperDays === null || !isFiniteNum(fresh.deliveryUpperDays) || fresh.deliveryUpperDays < 0) {
    reasons.push("Unknown or invalid delivery time");
  } else if (
    Number.isInteger(token.maxShippingDays) &&
    fresh.deliveryUpperDays > token.maxShippingDays
  ) {
    reasons.push(
      `Estimated delivery ${fresh.deliveryUpperDays} days exceeds signed max ${token.maxShippingDays}`,
    );
  }

  // 8. Signed price must not fall below the signed floor (only when both valid).
  if (
    token.suggestedPrice !== null && isFiniteNum(token.suggestedPrice) &&
    isFiniteNum(token.minSellingPrice) &&
    token.suggestedPrice < token.minSellingPrice
  ) {
    reasons.push(
      `Signed suggested price ${token.suggestedPrice} below min selling price ${token.minSellingPrice}`,
    );
  }

  // 9. Refreshed margin must not fall below the signed minimum margin.
  if (
    token.suggestedPrice !== null && isFiniteNum(token.suggestedPrice) && token.suggestedPrice > 0 &&
    fresh.productCost !== null && isFiniteNum(fresh.productCost) && fresh.productCost > 0 &&
    fresh.freightCost !== null && isFiniteNum(fresh.freightCost)
  ) {
    const landed = fresh.productCost + fresh.freightCost;
    const refreshedMargin = (token.suggestedPrice - landed) / token.suggestedPrice;
    if (isFiniteNum(token.minMargin) && refreshedMargin < token.minMargin) {
      reasons.push(
        `Refreshed margin ${(refreshedMargin * 100).toFixed(1)}% below signed minimum ${(token.minMargin * 100).toFixed(1)}%`,
      );
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
