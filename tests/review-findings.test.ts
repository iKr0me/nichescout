import test from "node:test";
import assert from "node:assert/strict";
import { median, linearRegressionSlope, coefficientOfVariation } from "../lib/stats.ts";
import {
  totalFreightCost, validatedTotalFreight, coerceNonNegative, coercePositivePrice,
  coerceDeliveryDays, selectFreightOption,
} from "../lib/cj-parse.ts";
import { guardListing } from "../lib/listing-guard.ts";
import { SCORING_VERSION } from "../lib/scoring.ts";

// ---------------------------------------------------------------------------
// median — even-sized correctness
// ---------------------------------------------------------------------------
test("median: odd size returns middle", () => {
  assert.equal(median([1, 2, 3]), 2);
});
test("median: even size averages the two middle values", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 20, 30, 40, 50, 60]), 35);
});
test("median: empty → null; single → itself", () => {
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

// ---------------------------------------------------------------------------
// stats — slope/CV never concatenate series (documented behavior)
// ---------------------------------------------------------------------------
test("linearRegressionSlope: <2 points → null", () => {
  assert.equal(linearRegressionSlope([]), null);
  assert.equal(linearRegressionSlope([1]), null);
});
test("linearRegressionSlope: flat series → 0", () => {
  assert.equal(linearRegressionSlope([5, 5, 5, 5]), 0);
});
test("coefficientOfVariation: mean ≤ 0 → 1 (max instability)", () => {
  assert.equal(coefficientOfVariation([0, 0, 0]), 1);
});

// ---------------------------------------------------------------------------
// cj-parse — empty-string shipping cost is NOT free shipping
// ---------------------------------------------------------------------------
test("coerceNonNegative: empty/whitespace string → null (not 0)", () => {
  assert.equal(coerceNonNegative(""), null);
  assert.equal(coerceNonNegative("   "), null);
  assert.equal(coerceNonNegative(0), 0);       // a real numeric 0 is still valid free shipping
});
test("coerceNonNegative: rejects booleans/arrays/objects/hex/words", () => {
  assert.equal(coerceNonNegative(true), null);
  assert.equal(coerceNonNegative(false), null);
  assert.equal(coerceNonNegative([1]), null);
  assert.equal(coerceNonNegative({}), null);
  assert.equal(coerceNonNegative("0x10"), null);       // hex string rejected
  assert.equal(coerceNonNegative("Infinity"), null);
  assert.equal(coerceNonNegative("NaN"), null);
  assert.equal(coerceNonNegative("abc"), null);
  assert.equal(coerceNonNegative("12.5"), 12.5);       // numeric string accepted
  assert.equal(coerceNonNegative("1e2"), 100);         // scientific accepted
});
test("coercePositivePrice: rejects booleans/arrays/objects", () => {
  assert.equal(coercePositivePrice(true), null);
  assert.equal(coercePositivePrice([5]), null);
  assert.equal(coercePositivePrice({}), null);
  assert.equal(coercePositivePrice(""), null);
  assert.equal(coercePositivePrice(0), null);
});
test("coerceDeliveryDays: empty string → null; 0 → 0", () => {
  assert.equal(coerceDeliveryDays(""), null);
  assert.equal(coerceDeliveryDays(0), 0);
  assert.equal(coerceDeliveryDays("3-5"), null);  // range string is not numeric days
});
test("totalFreightCost: totalPostageFee is the authoritative shipping total", () => {
  // totalPostageFee present → used directly
  assert.equal(totalFreightCost({
    logisticName: "x", logisticPrice: 5, logisticAgingRaw: "3-5", deliveryUpperDays: 5,
    logisticPriceCn: null, taxesFee: 1, clearanceOperationFee: 0.5, totalPostageFee: 6.5,
  }), 6.5);
  // totalPostageFee absent → null (insufficient evidence, never 0)
  assert.equal(totalFreightCost({
    logisticName: "x", logisticPrice: 5, logisticAgingRaw: "3-5",
    deliveryUpperDays: 5, logisticPriceCn: null, taxesFee: null, clearanceOperationFee: null,
    // totalPostageFee missing
  } as unknown as any), null);
  assert.equal(totalFreightCost(null), null);
});
test("validatedTotalFreight: invalid totalPostageFee → null (insufficient evidence, never 0)", () => {
  // only totalPostageFee is consulted — absent/invalid → null
  assert.equal(validatedTotalFreight({ totalPostageFee: "oops" }), null);
  assert.equal(validatedTotalFreight({}), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: "" }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: undefined }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: null }), null);
  // valid totalPostageFee wins
  assert.equal(validatedTotalFreight({ totalPostageFee: 7 }), 7);
});
test("selectFreightOption: selects by validated TOTAL cost, skips invalid-fee options", () => {
  const opts = [
    { logisticName: "A", logisticPrice: 5, totalPostageFee: 6, logisticAging: "3-5" },          // total 6 (TPF wins)
    { logisticName: "B", logisticPrice: 3, totalPostageFee: 3, logisticAging: "3-5" },          // total 3 → cheapest
    { logisticName: "C", logisticPrice: 9, totalPostageFee: 9, logisticAging: "3-5" },          // total 9
    { logisticName: "D", logisticPrice: 1, totalPostageFee: null, logisticAging: "3-5" },      // null TPF → skipped
    { logisticName: "E", logisticPrice: 1, totalPostageFee: 1, logisticAging: "15-20" },       // exceeds 10 days → skipped
  ];
  const chosen = selectFreightOption(opts, 10);
  assert.ok(chosen);
  assert.equal(chosen!.logisticName, "B");
  assert.equal(chosen!.totalPostageFee, 3);
});
test("validatedTotalFreight: totalPostageFee is the authoritative total (no fee summation)", () => {
  // Even when the full freight object carries other fields, totalPostageFee
  // alone is authoritative — fees are NEVER added on top.
  assert.equal(validatedTotalFreight({ totalPostageFee: 8 }), 8);
  assert.equal(validatedTotalFreight({ totalPostageFee: "12.5" }), 12.5);
});
test("validatedTotalFreight: missing/invalid totalPostageFee → null (insufficient evidence)", () => {
  assert.equal(validatedTotalFreight({}), null);                  // absent
  assert.equal(validatedTotalFreight({ totalPostageFee: null }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: undefined }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: "" }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: "oops" }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: true }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: NaN }), null);          // number NaN
  assert.equal(validatedTotalFreight({ totalPostageFee: -1 }), null);           // negative
  assert.equal(validatedTotalFreight({ totalPostageFee: {} }), null);
  assert.equal(validatedTotalFreight({ totalPostageFee: "Infinity" }), null);
});
test("totalFreightCost: uses CJFreight.totalPostageFee only", () => {
  // Must NOT sum logisticPrice + taxes + clearance — fees are not added.
  assert.equal(totalFreightCost({
    logisticName: "x", logisticPrice: 999, logisticAgingRaw: "3-5", deliveryUpperDays: 5,
    logisticPriceCn: null, taxesFee: 999, clearanceOperationFee: 999, totalPostageFee: 8,
  }), 8);                                                                     // totalPostageFee wins
  assert.equal(totalFreightCost({
    logisticName: "x", logisticPrice: 5, logisticAgingRaw: "3-5", deliveryUpperDays: 5,
    logisticPriceCn: null, taxesFee: null, clearanceOperationFee: null, totalPostageFee: null,
  }), null);                                                                 // missing → null
  assert.equal(totalFreightCost(null), null);
});

// ---------------------------------------------------------------------------
// listing-guard — new checks
// ---------------------------------------------------------------------------
function tok(over = {}) {
  return {
    productId: "PID", variantId: "VID", productCost: 8, freightCost: 3,
    marketMedianPrice: 20, suggestedPrice: 19, minSellingPrice: 11, margin: 0.47,
    currency: "USD", destinationCountry: "US", minMargin: 0.3, maxShippingDays: 10,
    scoringVersion: SCORING_VERSION, ...over,
  };
}
function fresh(over = {}) {
  return { productCost: 8, freightCost: 3, deliveryUpperDays: 8, factoryStock: 100, ...over };
}

test("guardListing: passes valid inputs", () => {
  const g = guardListing(tok(), fresh());
  assert.equal(g.ok, true);
});
test("guardListing: non-finite stock rejects", () => {
  assert.equal(guardListing(tok(), fresh({ factoryStock: NaN })).ok, false);
  assert.equal(guardListing(tok(), fresh({ factoryStock: Infinity })).ok, false);
  assert.equal(guardListing(tok(), fresh({ factoryStock: null })).ok, false);
});
test("guardListing: unknown/invalid delivery days reject", () => {
  assert.equal(guardListing(tok(), fresh({ deliveryUpperDays: null })).ok, false);
  assert.equal(guardListing(tok(), fresh({ deliveryUpperDays: NaN })).ok, false);
  assert.equal(guardListing(tok(), fresh({ deliveryUpperDays: -1 })).ok, false);
});
test("guardListing: freight cost drift rejects", () => {
  // signed 3, live 6 → drift beyond 1% of max(1, 6) = 0.06
  assert.equal(guardListing(tok({ freightCost: 3 }), fresh({ freightCost: 6 })).ok, false);
});
test("guardListing: signed price/margin bounds", () => {
  assert.equal(guardListing(tok({ suggestedPrice: 0 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ suggestedPrice: null }), fresh()).ok, false);
  assert.equal(guardListing(tok({ suggestedPrice: 10, minSellingPrice: 15 }), fresh()).ok, false); // price < floor
  assert.equal(guardListing(tok({ minMargin: 0 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ minMargin: 1 }), fresh()).ok, false);
});
test("guardListing: refreshed margin below signed floor rejects", () => {
  // landed = 8 + 5 = 13; suggested 19 → margin 0.315; floor 0.5 → reject
  assert.equal(guardListing(tok({ minMargin: 0.5 }), fresh({ productCost: 8, freightCost: 5 })).ok, false);
});
test("guardListing: invalid currency rejects", () => {
  assert.equal(guardListing(tok({ currency: "" }), fresh()).ok, false);
  assert.equal(guardListing(tok({ currency: "¥" }), fresh()).ok, false);
});
test("guardListing: non-finite signed bounds reject before comparison", () => {
  assert.equal(guardListing(tok({ productCost: NaN }), fresh()).ok, false);
  assert.equal(guardListing(tok({ productCost: Infinity }), fresh()).ok, false);
  assert.equal(guardListing(tok({ productCost: 0 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ minSellingPrice: NaN }), fresh()).ok, false);
  assert.equal(guardListing(tok({ minSellingPrice: -5 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ maxShippingDays: 0 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ maxShippingDays: 61 }), fresh()).ok, false);
  assert.equal(guardListing(tok({ maxShippingDays: 3.5 }), fresh()).ok, false);
});
test("guardListing: signed non-finite freightCost rejects", () => {
  assert.equal(guardListing(tok({ freightCost: NaN }), fresh()).ok, false);
  assert.equal(guardListing(tok({ freightCost: -1 }), fresh()).ok, false);
});
