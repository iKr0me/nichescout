import test from "node:test";
import assert from "node:assert/strict";
import { broadenPhrase } from "../lib/phrase-broaden.ts";

test("broadenPhrase: always includes the original first", () => {
  const out = broadenPhrase("lightweight desk organizers");
  assert.equal(out[0], "lightweight desk organizers");
});

test("broadenPhrase: drops leading modifiers and singularises", () => {
  const out = broadenPhrase("lightweight desk organizers");
  // Regression: this exact phrase returns 0 results from Google Shopping,
  // while the broad form returns a full page.
  assert.ok(out.includes("desk organizers"), `expected "desk organizers" in ${JSON.stringify(out)}`);
  assert.ok(out.includes("desk organizer"), `expected "desk organizer" in ${JSON.stringify(out)}`);
  assert.ok(out.includes("organizer"), `expected "organizer" in ${JSON.stringify(out)}`);
});

test("broadenPhrase: already-broad phrase returns essentially itself", () => {
  const out = broadenPhrase("desk organizer");
  assert.equal(out[0], "desk organizer");
  assert.ok(out.length >= 1);
});

test("broadenPhrase: deduplicates", () => {
  const out = broadenPhrase("portable portable charger");
  assert.equal(new Set(out).size, out.length, "no duplicates");
});

test("broadenPhrase: respects maxVariants", () => {
  const out = broadenPhrase("lightweight compact foldable desk organizers", 3);
  assert.ok(out.length <= 3, `expected <=3, got ${out.length}`);
});

test("broadenPhrase: empty/whitespace input → empty array", () => {
  assert.deepEqual(broadenPhrase(""), []);
  assert.deepEqual(broadenPhrase("   "), []);
});

test("broadenPhrase: single word is unchanged", () => {
  assert.deepEqual(broadenPhrase("organizer"), ["organizer"]);
});

test("broadenPhrase: plural-only phrase gets singularised", () => {
  const out = broadenPhrase("phone stands");
  assert.ok(out.includes("phone stand"), JSON.stringify(out));
});

test("broadenPhrase: handles -ies plurals", () => {
  const out = broadenPhrase("wireless chargies accessories");
  // last word singularisation of "accessories" → "accessory"
  assert.ok(out.some((p) => p.includes("accessor")), JSON.stringify(out));
});

test("broadenPhrase: does not produce empty strings", () => {
  for (const p of ["lightweight desk organizers", "the a", "portable mini"]) {
    for (const v of broadenPhrase(p)) {
      assert.ok(v.trim().length > 0, `empty variant from ${JSON.stringify(p)}`);
    }
  }
});
