import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { detectCurrency, constraintFingerprint, validateConstraints, parseAgingRange } from "../lib/validation.ts";
import { selectFreightOption, coercePositivePrice, coerceNonNegative } from "../lib/cj-parse.ts";
import { saturationRisk } from "../lib/scoring.ts";

// detectCurrency — explicit ISO code only
test("detectCurrency: explicit ISO code accepted", () => {
  assert.equal(detectCurrency("USD"), "USD");
  assert.equal(detectCurrency("eur"), "EUR");
  assert.equal(detectCurrency(" gbp "), "GBP");
});
test("detectCurrency: bare symbol or unknown → UNKNOWN (never guessed)", () => {
  assert.equal(detectCurrency("$"), "UNKNOWN");
  assert.equal(detectCurrency("¥"), "UNKNOWN");
  assert.equal(detectCurrency("€"), "UNKNOWN");
  assert.equal(detectCurrency(""), "UNKNOWN");
  assert.equal(detectCurrency(undefined), "UNKNOWN");
  assert.equal(detectCurrency("XYZ"), "UNKNOWN");
});

// constraintFingerprint — SHA-256, exact, no rounding/truncation
test("constraintFingerprint: SHA-256 hex of full canonical JSON", () => {
  const c = {
    searchPhrases: ["long phrase one", "p2", "p3"],
    maxProductCost: 12.345678,
    minMargin: 0.351,
    destinationCountry: "US",
    maxShippingDays: 10,
    category: "Electronics",
  };
  const expected = createHash("sha256").update(JSON.stringify({
    category: "Electronics",
    destinationCountry: "US",
    maxProductCost: 12.345678,
    maxShippingDays: 10,
    minMargin: 0.351,
    searchPhrases: ["long phrase one", "p2", "p3"],
  })).digest("hex");
  assert.equal(constraintFingerprint(c), expected);
});
test("constraintFingerprint: distinct on category, phrase order, and full phrases", () => {
  const base = {
    searchPhrases: ["desk organizer lamp", "other"],
    maxProductCost: 12,
    minMargin: 0.35,
    destinationCountry: "US",
    maxShippingDays: 10,
    category: null as string | null,
  };
  const a = constraintFingerprint(base);
  const b = constraintFingerprint({ ...base, category: "Electronics" });
  const c2 = constraintFingerprint({ ...base, searchPhrases: ["desk organizer", "lamp"] });
  const d = constraintFingerprint({ ...base, searchPhrases: ["desk organizer lamp", "other"] });
  assert.notEqual(a, b);
  assert.notEqual(a, c2);                            // phrase split matters (no truncation)
  assert.equal(a, d);                                // identical inputs
});
test("constraintFingerprint: numeric precision preserved (no toFixed)", () => {
  const c1 = {
    searchPhrases: ["x"], maxProductCost: 0.123456789,
    minMargin: 0.333333333, destinationCountry: "US", maxShippingDays: 7, category: null as string | null,
  };
  const c2 = { ...c1, minMargin: 0.3334 };
  assert.notEqual(constraintFingerprint(c1), constraintFingerprint(c2));
});

// validateConstraints — non-finite, out-of-range
test("validateConstraints: rejects non-finite maxProductCost", () => {
  const base = { searchPhrases: ["x"], maxProductCost: 10, minMargin: 0.35, destinationCountry: "US", maxShippingDays: 10 };
  assert.throws(() => validateConstraints({ ...base, maxProductCost: Infinity }));
  assert.throws(() => validateConstraints({ ...base, maxProductCost: NaN }));
  assert.throws(() => validateConstraints({ ...base, maxProductCost: "abc" }));
  assert.throws(() => validateConstraints({ ...base, maxProductCost: 0 }));
  assert.equal(validateConstraints(base).maxProductCost, 10);
});
test("validateConstraints: keeps full phrases (no truncation)", () => {
  const long = "x".repeat(300);
  const c = validateConstraints({ searchPhrases: [long], maxProductCost: 10, minMargin: 0.35, destinationCountry: "US", maxShippingDays: 10 });
  assert.equal(c.searchPhrases[0], long);
});
test("validateConstraints: rejects bad country code; accepts free-form category", () => {
  const base = { searchPhrases: ["x"], maxProductCost: 10, minMargin: 0.35, destinationCountry: "US", maxShippingDays: 10 };
  assert.throws(() => validateConstraints({ ...base, destinationCountry: "ZZ" }));
  assert.throws(() => validateConstraints({ ...base, destinationCountry: "usa" }));

  // Categories are free-form — the LLM may propose any short label.
  // Regression: "desk organizers" previously 400'd the whole interpret call.
  assert.equal(validateConstraints({ ...base, category: "Unicorns" }).category, "Unicorns");
  assert.equal(validateConstraints({ ...base, category: "desk organizers" }).category, "desk organizers");
  assert.equal(validateConstraints({ ...base, category: "  Home & Garden  " }).category, "Home & Garden");
  assert.equal(validateConstraints({ ...base, category: "" }).category, null);
  assert.equal(validateConstraints({ ...base, category: null }).category, null);

  // Over-long categories are still rejected, and control chars are stripped.
  assert.throws(() => validateConstraints({ ...base, category: "x".repeat(61) }));
  assert.equal(validateConstraints({ ...base, category: "de\u0000sk" }).category, "desk");
});

// CJ parse — missing cost must not become zero; delivery limit enforced
test("coercePositivePrice: missing/NaN/0/negative → null", () => {
  assert.equal(coercePositivePrice(undefined), null);
  assert.equal(coercePositivePrice(NaN), null);
  assert.equal(coercePositivePrice(0), null);
  assert.equal(coercePositivePrice(-1), null);
  assert.equal(coercePositivePrice("3.5"), 3.5);
});
test("coerceNonNegative: zero is valid (free shipping), negative/missing → null", () => {
  assert.equal(coerceNonNegative(0), 0);
  assert.equal(coerceNonNegative(-1), null);
  assert.equal(coerceNonNegative(undefined), null);
});
test("selectFreightOption: drops options exceeding delivery limit", () => {
  const opts = [
    { logisticName: "fast", logisticPrice: 9, totalPostageFee: 9, logisticAging: "3-5" },
    { logisticName: "slow", logisticPrice: 1, totalPostageFee: 1, logisticAging: "15-20" }, // cheap but too slow
    { logisticName: "badaging", logisticPrice: 0.5, totalPostageFee: 0.5, logisticAging: "abc" },
    { logisticName: "noprice", totalPostageFee: null, logisticAging: "3-5" },
  ];
  const chosen = selectFreightOption(opts, 10);
  assert.ok(chosen);
  assert.equal(chosen!.logisticName, "fast");
  assert.equal(chosen!.deliveryUpperDays, 5);
});
test("selectFreightOption: null when nothing within delivery limit", () => {
  const opts = [{ logisticName: "slow", logisticPrice: 5, totalPostageFee: 5, logisticAging: "15-20" }];
  assert.equal(selectFreightOption(opts, 10), null);
});

// saturationRisk — takes 2 inputs, not 4; still null on missing
test("saturationRisk: weighted (0.6, 0.4); null on any non-finite input", () => {
  assert.equal(saturationRisk({ merchantDiversityRisk: 50, priceSpreadRisk: 50 }), 50);
  assert.equal(saturationRisk({ merchantDiversityRisk: NaN, priceSpreadRisk: 50 }), null);
  assert.equal(saturationRisk({ merchantDiversityRisk: 50, priceSpreadRisk: NaN }), null);
});

// parseAgingRange
test("parseAgingRange: still handles 5-11, reverses, negatives", () => {
  assert.deepEqual(parseAgingRange("5-11"), { lower: 5, upper: 11 });
  assert.equal(parseAgingRange("11-5"), null);
  assert.equal(parseAgingRange("-3-5"), null);
});
