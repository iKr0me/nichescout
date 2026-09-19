import test from "node:test";
import assert from "node:assert/strict";
import { runListing, type RunDeps } from "../lib/run-listing.ts";
import { guardListing } from "../lib/listing-guard.ts";
import { SCORING_VERSION } from "../lib/scoring.ts";

/** Build a deps object that counts LLM calls and lets the test force failures. */
function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps & { llmCalls: number } {
  const d = {
    llmCalls: 0,
    verifyToken: () => validToken(),
    refetch: async () => validRefetch(),
    guard: guardListing,
    generateListing: async () => {
      d.llmCalls++;
      return {
        title: "T",
        description: "D",
        featureBullets: ["a", "b"],
      };
    },
    expectedScoringVersion: SCORING_VERSION,
    ...overrides,
  };
  return d;
}

function validToken() {
  return {
    productId: "PID",
    variantId: "VID",
    productCost: 8.0,
    freightCost: 2.0,
    marketMedianPrice: 20.0,
    suggestedPrice: 19.0,
    minSellingPrice: 11.0,
    margin: 0.47,
    currency: "USD",
    destinationCountry: "US",
    minMargin: 0.3,
    maxShippingDays: 10,
    scoringVersion: SCORING_VERSION,
    constraintFingerprint: "abc123",
  };
}

function validRefetch() {
  return {
    variant: {
      vid: "VID",
      pid: "PID",
      variantSku: "SKU",
      variantSellPrice: 8.0,
      variantWeight: 30,
      variantImage: "https://img.example/p.png",
      variantNameEn: "Phone stand",
      inventory: { cjHeld: 0, factory: 100, total: 100, rowCount: 1 },
    },
    freight: {
      logisticName: "CJPacket",
      logisticPrice: 2.0,
      logisticAgingRaw: "5-11",
      deliveryUpperDays: 8,   // within signed maxShippingDays=10
      taxesFee: null,
      clearanceOperationFee: null,
      totalPostageFee: 2.0,
      logisticPriceCn: null,
    },
    inventory: { cjHeld: 0, factory: 100, total: 100, rowCount: 1 },
    title: "Phone stand",
    image: "https://img.example/p.png",
  };
}

test("happy path calls the LLM exactly once", async () => {
  const d = makeDeps();
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, true);
  assert.equal(d.llmCalls, 1);
});

test("missing shipping (freight null) never calls the LLM", async () => {
  const d = makeDeps({
    refetch: async () => ({ ...validRefetch(), freight: null }),
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.reasons && r.reasons.some((x) => /shipping/i.test(x)));
  assert.equal(d.llmCalls, 0);
});

test("unknown stock never calls the LLM", async () => {
  const d = makeDeps({
    refetch: async () => ({
      ...validRefetch(),
      inventory: null,
      variant: { ...validRefetch().variant, inventory: null },
    }),
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(d.llmCalls, 0);
});

test("out-of-stock (factory 0) never calls the LLM", async () => {
  const d = makeDeps({
    refetch: async () => {
      const v = validRefetch();
      return {
        ...v,
        inventory: { cjHeld: 0, factory: 0, total: 0, rowCount: 1 },
        variant: { ...v.variant, inventory: { cjHeld: 0, factory: 0, total: 0, rowCount: 1 } },
      };
    },
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(d.llmCalls, 0);
});

test("invalid currency (empty) never calls the LLM", async () => {
  const d = makeDeps({
    verifyToken: () => ({ ...validToken(), currency: "" }),
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(d.llmCalls, 0);
});

test("invalid product cost (0) never calls the LLM", async () => {
  const d = makeDeps({
    refetch: async () => {
      const v = validRefetch();
      return { ...v, variant: { ...v.variant, variantSellPrice: 0 } };
    },
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(d.llmCalls, 0);
});

test("excessive delivery time never calls the LLM", async () => {
  const d = makeDeps({
    refetch: async () => {
      const v = validRefetch();
      return {
        ...v,
        freight: { ...v.freight!, deliveryUpperDays: 30 },
      };
    },
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.reasons && r.reasons.some((x) => /delivery/i.test(x)));
  assert.equal(d.llmCalls, 0);
});

test("refreshed margin below signed minimum never calls the LLM", async () => {
  // Lower the suggested price to the point that (price - landed)/price < 0.3.
  const d = makeDeps({
    verifyToken: () => ({ ...validToken(), suggestedPrice: 11.0, minMargin: 0.5 }),
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.reasons && r.reasons.some((x) => /margin/i.test(x)));
  assert.equal(d.llmCalls, 0);
});

test("scoring version mismatch never calls the LLM", async () => {
  const d = makeDeps({
    verifyToken: () => ({ ...validToken(), scoringVersion: "old-version" }),
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(d.llmCalls, 0);
});

test("invalid token signature never calls the LLM", async () => {
  const d = makeDeps({
    verifyToken: () => {
      throw new Error("signature mismatch");
    },
  });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(d.llmCalls, 0);
});

test("missing refetch (404) never calls the LLM", async () => {
  const d = makeDeps({ refetch: async () => null });
  const r = await runListing(d, { productId: "PID", variantId: "VID", approvalToken: "tok" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(d.llmCalls, 0);
});
