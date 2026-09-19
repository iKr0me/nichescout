import test from "node:test";
import assert from "node:assert/strict";
import { isRelevantProduct, relevanceScore } from "../lib/relevance.ts";

test("isRelevantProduct: desk organizer matches cable organizer", () => {
  assert.equal(isRelevantProduct("desk organizer", "Magnetic Cable Clip Under Desk Cable Management Adjustable Cord Holder Wire Organizer"), true);
});
test("isRelevantProduct: desk accessory does NOT match beaded shoe accessory", () => {
  assert.equal(isRelevantProduct("desk accessory", "Bow Diy Handmade Beaded Shoe Accessory"), false);
  // "desk" is the only content token (accessory is a stopword); it's not in the shoe title
});
test("isRelevantProduct: desk accessory does NOT match women's pants brooch", () => {
  assert.equal(isRelevantProduct("desk accessory", "Fixed Waist Women's Pants Brooch Accessory"), false);
});
test("isRelevantProduct: desk accessory DOES match desk cable management (desk is content token)", () => {
  assert.equal(isRelevantProduct("desk accessory", "Under Desk Cable Management Wire Organizer"), true);
  // "desk" is content, "accessory" is stopword → desk is in the title → match
});
test("isRelevantProduct: empty phrase → true (no filter possible)", () => {
  assert.equal(isRelevantProduct("", "Anything"), true);
});
test("isRelevantProduct: all-stopword phrase → true (no content tokens to match)", () => {
  assert.equal(isRelevantProduct("lightweight accessory", "Hair Band Accessory"), true);
  // both tokens are stopwords → can't filter → pass
});
test("relevanceScore: more tokens matching → higher score", () => {
  assert.ok(relevanceScore("desk organizer", "Desk Cable Organizer") > relevanceScore("desk organizer", "Desk Lamp"));
});
test("relevanceScore: zero content tokens → 0", () => {
  assert.equal(relevanceScore("the a", "Anything"), 0);
});
test("isRelevantProduct: self-care products matches skincare", () => {
  assert.equal(isRelevantProduct("self-care products", "Self-Care Skincare Face Mask Products"), true);
});
test("isRelevantProduct: travel accessories matches travel bag", () => {
  assert.equal(isRelevantProduct("travel accessories", "Travel Toiletry Bag Compact"), true);
  // "travel" is content, "accessories" is stopword → travel is in the title
});
test("isRelevantProduct: travel accessories does NOT match women's brooch", () => {
  assert.equal(isRelevantProduct("travel accessories", "Fixed Waist Women's Pants Brooch Accessory"), false);
});
