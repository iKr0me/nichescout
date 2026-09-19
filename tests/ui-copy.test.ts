import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Layout metadata sanity check (cheap regression so a future edit can't
 * accidentally drop the title/description that the browser tab and SEO use).
 * Required brand strings live in page.tsx; metadata lives in layout.tsx.
 */
test("layout.tsx metadata: title and description present and customer-friendly", () => {
  const layout = readFileSync(path.join(HERE, "../app/layout.tsx"), "utf8");
  assert.ok(layout.includes("Find products worth selling"), "title is missing");
  assert.ok(layout.includes("Explore supplier costs, market signals, and shipping before you commit"), "description is missing");
  for (const forbidden of ["Call 1", "Call 2", "deterministically ranks", "server-validated"]) {
    assert.ok(!layout.includes(forbidden), `layout.tsx still contains "${forbidden}"`);
  }
});
