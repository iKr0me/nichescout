import test from "node:test";
import assert from "node:assert/strict";
import {
  marginHealthScore,
  marginRejects,
  directionScore,
  slopeScore,
  stabilityScore,
  momentumScore,
  stronglyDeclining,
  merchantDiversityRisk,
  priceSpreadRisk,
  saturationRisk,
  competitionOpportunity,
  SATURATION_RISK_REJECT,
  SCORING_VERSION,
  shippingAvailabilityScore,
  deliveryRangeScore,
  inventoryScore,
  dataCompletenessScore,
  fulfillmentScore,
  compositeScore,
  COMPOSITE_WEIGHTS,
} from "../lib/scoring.ts";
import { parseAgingRange, detectCurrency } from "../lib/validation.ts";

test("marginHealthScore: 50% → 100, 30% → 60, 0% → 0", () => {
  assert.equal(marginHealthScore(0.5), 100);
  assert.equal(marginHealthScore(0.3), 60);
  assert.equal(marginHealthScore(0), 0);
  assert.equal(marginHealthScore(-0.1), 0);
});
test("marginHealthScore: non-finite → 0", () => {
  assert.equal(marginHealthScore(NaN), 0);
  assert.equal(marginHealthScore(Infinity), 0);
});
test("marginRejects: uncompetitive target OR insufficient margin → true", () => {
  assert.equal(marginRejects(null, 10, 0.3, 0.3), true);
  assert.equal(marginRejects(8, 10, 0.3, 0.3), true);
  assert.equal(marginRejects(20, 10, 0.29, 0.3), true);
  assert.equal(marginRejects(20, 10, 0.4, 0.3), false);
});

test("directionScore: rising=100, flat=50, declining=0; non-finite=50", () => {
  assert.equal(directionScore(2), 100);
  assert.equal(directionScore(-2), 0);
  assert.equal(directionScore(0.1), 50);
  assert.equal(directionScore(-0.1), 50);
  assert.equal(directionScore(NaN), 50);
});
test("slopeScore: +5 → 100, 0 → 50, -5 → 0", () => {
  assert.equal(slopeScore(5), 100);
  assert.equal(slopeScore(0), 50);
  assert.equal(slopeScore(-5), 0);
});
test("stabilityScore: cv=0 → 100, cv=0.5 → 0", () => {
  assert.equal(stabilityScore(0), 100);
  assert.equal(stabilityScore(0.5), 0);
  assert.equal(stabilityScore(-0.1), 0);
});
test("stronglyDeclining: -3 rejects, -2 does not", () => {
  assert.equal(stronglyDeclining(-3), true);
  assert.equal(stronglyDeclining(-2.99), false);
  assert.equal(stronglyDeclining(0), false);
});
test("momentumScore: weighted sum", () => {
  const v = momentumScore(directionScore(2), slopeScore(2), stabilityScore(0.1));
  assert.equal(v, 0.4 * 100 + 0.35 * 70 + 0.25 * 80);
});

// Competition — simplified: merchant diversity + price spread only.
test("merchantDiversityRisk: 0/n → 0; n/n → 100; n=0 → 0", () => {
  assert.equal(merchantDiversityRisk(0, 10), 0);
  assert.equal(merchantDiversityRisk(10, 10), 100);
  assert.equal(merchantDiversityRisk(5, 0), 0);
});
test("priceSpreadRisk: spread=0 → 100, spread=0.5 → 0", () => {
  assert.equal(priceSpreadRisk(0), 100);
  assert.equal(priceSpreadRisk(0.5), 0);
});
test("saturationRisk: weighted 60% merchant diversity + 40% price spread", () => {
  const r = saturationRisk({ merchantDiversityRisk: 50, priceSpreadRisk: 50 });
  assert.equal(r, 50);
});
test("saturationRisk: any non-finite input → null (not favorable)", () => {
  assert.equal(saturationRisk({ merchantDiversityRisk: NaN, priceSpreadRisk: 50 }), null);
  assert.equal(saturationRisk({ merchantDiversityRisk: 50, priceSpreadRisk: NaN }), null);
  assert.equal(saturationRisk({ merchantDiversityRisk: Infinity, priceSpreadRisk: 50 }), null);
});
test("competitionOpportunity = 100 - risk; rejects > 85", () => {
  const r = saturationRisk({ merchantDiversityRisk: 90, priceSpreadRisk: 90 });
  assert.ok(r !== null && r > 85);
  assert.equal(SATURATION_RISK_REJECT, 85);
  assert.equal(competitionOpportunity(r), 100 - r);
});
test("scoring version is stable and named for the simplified formula", () => {
  assert.equal(typeof SCORING_VERSION, "string");
  assert.match(SCORING_VERSION, /competition-estimate-\d{4}-\d{2}/);
});

test("shippingAvailabilityScore: binary", () => {
  assert.equal(shippingAvailabilityScore(true), 100);
  assert.equal(shippingAvailabilityScore(false), 0);
});
test("deliveryRangeScore: upper ≤ max → 60–100; > max → 0; null → 0", () => {
  assert.equal(deliveryRangeScore(0, 10), 100);
  assert.equal(deliveryRangeScore(10, 10), 60);
  assert.equal(deliveryRangeScore(11, 10), 0);
  assert.equal(deliveryRangeScore(null, 10), 0);
});
test("inventoryScore: null/0 → 0; 1 → 1; 100 → 100", () => {
  assert.equal(inventoryScore(null), 0);
  assert.equal(inventoryScore(0), 0);
  assert.equal(inventoryScore(1), 1);
  assert.equal(inventoryScore(100), 100);
});
test("dataCompletenessScore: 4/6 ≈ 66.67", () => {
  assert.equal(dataCompletenessScore(4, 6), (4 / 6) * 100);
});
test("fulfillmentScore: weights add to 1", () => {
  const v = fulfillmentScore({
    shippingAvailability: true,
    upperDays: 5,
    maxShippingDays: 10,
    stock: 100,
    fieldsComplete: 6,
    fieldsTotal: 6,
  });
  assert.equal(v, 0.35 * 100 + 0.3 * 80 + 0.2 * 100 + 0.15 * 100);
});

test("compositeScore: full set → weighted average", () => {
  const v = compositeScore({ margin: 80, momentum: 70, competitionOpportunity: 60, fulfillment: 90 });
  const expected =
    COMPOSITE_WEIGHTS.margin * 80 +
    COMPOSITE_WEIGHTS.momentum * 70 +
    COMPOSITE_WEIGHTS.competition * 60 +
    COMPOSITE_WEIGHTS.fulfillment * 90;
  assert.ok(Math.abs(v! - expected) < 1e-9);
});
test("compositeScore: missing competition → null (no renormalization)", () => {
  assert.equal(compositeScore({ margin: 80, momentum: 70, competitionOpportunity: null, fulfillment: 90 }), null);
});
test("compositeScore: missing margin → null", () => {
  assert.equal(compositeScore({ margin: null, momentum: 70, competitionOpportunity: 60, fulfillment: 90 }), null);
});

test("parseAgingRange: 5-11 → {5,11}; reverses and negatives → null", () => {
  assert.deepEqual(parseAgingRange("5-11"), { lower: 5, upper: 11 });
  assert.equal(parseAgingRange("11-5"), null);
  assert.equal(parseAgingRange("-3-5"), null);
  assert.equal(parseAgingRange("abc"), null);
  assert.equal(parseAgingRange(""), null);
  assert.equal(parseAgingRange(null as unknown as string), null);
});

test("detectCurrency: only explicit ISO code accepted; bare symbols → UNKNOWN", () => {
  assert.equal(detectCurrency("USD"), "USD");
  assert.equal(detectCurrency("eur"), "EUR");
  assert.equal(detectCurrency(" gbp "), "GBP");
  assert.equal(detectCurrency("$"), "UNKNOWN");
  assert.equal(detectCurrency("¥"), "UNKNOWN");
  assert.equal(detectCurrency("€"), "UNKNOWN");
  assert.equal(detectCurrency("£"), "UNKNOWN");
  assert.equal(detectCurrency(""), "UNKNOWN");
  assert.equal(detectCurrency(undefined), "UNKNOWN");
  assert.equal(detectCurrency(null), "UNKNOWN");
});
