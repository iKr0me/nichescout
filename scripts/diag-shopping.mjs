#!/usr/bin/env node
/**
 * Diagnostic: fetch Shopping analysis for a phrase and print the precise
 * competition-evidence blockers (sample size, currency resolution, per-result
 * currency codes). Local only; no secrets printed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(path.join(HERE, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

const phrase = process.argv[2] || "desk organizer";
const url =
  `https://serpapi.com/search?engine=google_shopping&num=20&currency=USD&q=${encodeURIComponent(phrase)}` +
  `&api_key=${encodeURIComponent(env.SERPAPI_KEY)}`;

const res = await fetch(url);
const j = await res.json();
if (j?.error) {
  console.log("serpapi error:", j.error);
  process.exit(1);
}
const sr = Array.isArray(j?.shopping_results) ? j.shopping_results : [];
console.log("phrase:", phrase);
console.log("total shopping_results:", sr.length);

let withPrice = 0;
let withSource = 0;
const currCodes = new Map();
for (const r of sr) {
  const price = Number(r?.extracted_price);
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasSource = typeof r?.source === "string" && r.source.trim() !== "";
  if (hasPrice) withPrice++;
  if (hasSource) withSource++;
  const code = typeof r?.currency === "string" ? r.currency : "(none)";
  currCodes.set(code, (currCodes.get(code) || 0) + 1);
}
console.log("results with extracted_price>0:", withPrice);
console.log("results with source:", withSource);
console.log("currency field distribution:", JSON.stringify([...currCodes.entries()]));
console.log("search_parameters.currency:", j?.search_parameters?.currency ?? "(absent)");
console.log("google_currency:", j?.shopping_results?.[0]?.currency ?? "(absent)");

// Show first 3 results' currency/price/source (no titles, just evidence shape)
console.log("\nfirst 3 result evidence shapes:");
for (const r of sr.slice(0, 3)) {
  console.log("  currency:", JSON.stringify(r?.currency), "price:", r?.extracted_price, "source:", JSON.stringify(r?.source)?.slice(0, 40));
}
