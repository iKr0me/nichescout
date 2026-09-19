import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

/**
 * Intro copy + behaviour regression. Guards the exact panel wording the
 * design spec requires, and that the accessibility wiring exists.
 */

const REQUIRED_PANEL_COPY = [
  "Picking the wrong product gets expensive.",
  "Supplier tabs. Unclear shipping costs. Prices that leave little room for profit. Finding what to sell shouldn't mean guessing.",
  "A trend isn't a business plan.",
  "A popular product can still have weak margins, slow delivery, or too little evidence to justify selling it.",
  "Less guesswork. More evidence.",
  "NicheScout researches suppliers and market signals, checks costs and shipping, and explains which products meet your criteria—and where evidence is missing.",
  "Describe your niche",
  "Review the evidence",
  "Approve a listing",
  "Your next product starts here.",
  "Bring an idea. See what the evidence supports.",
  "Use NicheScout →",
  "Scroll to explore",
  "Skip intro / Open workspace",
];

test("intro contains every required panel headline and body string", () => {
  const src = read("../app/Intro.tsx");
  for (const phrase of REQUIRED_PANEL_COPY) {
    assert.ok(src.includes(phrase), `Intro.tsx missing required copy: "${phrase}"`);
  }
});

test("intro makes exactly four panels", () => {
  const src = read("../app/Intro.tsx");
  assert.ok(/PANEL_COUNT\s*=\s*4/.test(src), "PANEL_COUNT must be 4");
  // Four eyebrow labels 01–04
  for (const n of ["01", "02", "03", "04"]) {
    assert.ok(src.includes(`${n} — `), `missing panel eyebrow ${n}`);
  }
});

test("intro does not promise guaranteed outcomes", () => {
  const src = read("../app/Intro.tsx");
  for (const banned of ["guaranteed", "guarantee", "will sell", "guaranteed sales", "guaranteed profit"]) {
    assert.ok(!src.toLowerCase().includes(banned), `Intro.tsx must not promise "${banned}"`);
  }
});

test("intro respects reduced-motion and supports keyboard navigation", () => {
  const src = read("../app/Intro.tsx");
  assert.ok(src.includes("prefers-reduced-motion"), "must query reduced-motion");
  assert.ok(src.includes("ArrowRight") && src.includes("ArrowLeft"), "must handle arrow keys");
  assert.ok(src.includes("PageDown") && src.includes("PageUp"), "must handle page keys");
  assert.ok(src.includes("Home") && src.includes("End"), "must handle Home/End");
  assert.ok(src.includes('role="tab"') || src.includes("role=\"tab\""), "dots must be tabs");
});

test("intro provides prev/next controls and a progress indicator", () => {
  const src = read("../app/Intro.tsx");
  assert.ok(src.includes("Previous panel") && src.includes("Next panel"), "prev/next controls required");
  assert.ok(src.includes("introCount"), "numeric 01–04 indicator required");
});

test("reduced-motion CSS disables transforms and cue animation", () => {
  const css = read("../app/globals.css");
  assert.ok(css.includes("prefers-reduced-motion"), "css must include reduced-motion block");
  assert.ok(/\.introScrollCueArrow\s*\{\s*animation:\s*none/.test(css), "cue animation must stop");
});

test("workspace offers a way back to the intro", () => {
  const src = read("../app/page.tsx");
  assert.ok(src.includes("Replay intro"), "workspace must let users revisit the intro");
  assert.ok(src.includes("nichescout:introSeen"), "intro-seen must be remembered");
});

test("illustrative scatter cards carry no invented metrics", () => {
  const src = read("../app/Intro.tsx");
  // Scatter labels are generic research fragments — no numbers, no claims.
  assert.ok(src.includes("Supplier tab"));
  assert.ok(src.includes("Shipping estimate"));
  assert.ok(src.includes("Margin check"));
  assert.ok(src.includes("Evidence gap"));

  // Extract only the label: values and assert none contains a digit/percent.
  const labels = [...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 4, "expected the four scatter labels");
  for (const label of labels) {
    assert.ok(!/\d/.test(label), `scatter label "${label}" must not contain a number`);
    assert.ok(!/%/.test(label), `scatter label "${label}" must not contain a percentage`);
  }
});
