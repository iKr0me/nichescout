#!/usr/bin/env node
/**
 * Diagnostic probe for the interpret LLM call. Local only. Prints the model,
 * schema-rejection status, parsed content type, and top-level keys — never
    the API key or auth headers.
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

const MODEL = env.OPENAI_MODEL || "gpt-5-mini";
const r = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: "You return structured data only." },
      {
        role: "user",
        content:
          "Interpret the SELLER GOAL into structured constraints. Return searchPhrases as 1-3 distinct phrases. " +
          "If the goal does not specify a country, default to 'US' and 10-day delivery. " +
          "If the goal does not specify a margin, default to 0.30. " +
          "SELLER GOAL: {\"goal\":\"Lightweight desk accessories under $12 that can ship to the United States within 10 days and leave at least a 35% margin\"}. " +
          "Return JSON with keys searchPhrases (array of strings), maxProductCost (number), minMargin (number), destinationCountry (2-letter string), maxShippingDays (integer), category (string or null).",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "goal_interpretation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            searchPhrases: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", maxLength: 80 } },
            maxProductCost: { type: "number", minimum: 0.01 },
            minMargin: { type: "number", minimum: 0.01, maximum: 0.99 },
            destinationCountry: { type: "string", minLength: 2, maxLength: 2 },
            maxShippingDays: { type: "integer", minimum: 1, maximum: 60 },
            category: { type: ["string", "null"] },
          },
          required: ["searchPhrases", "maxProductCost", "minMargin", "destinationCountry", "maxShippingDays", "category"],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 400,
  }),
});
const j = await r.json();
console.log("status:", r.status);
console.log("model:", j?.model ?? "n/a");
if (j?.error) console.log("error:", j.error?.message);
const content = j?.choices?.[0]?.message?.content;
console.log("content type:", typeof content);
try {
  const parsed = JSON.parse(content);
  console.log("parsed keys:", Object.keys(parsed));
  console.log("searchPhrases:", JSON.stringify(parsed.searchPhrases));
  console.log("category:", JSON.stringify(parsed.category));
  console.log("maxProductCost:", parsed.maxProductCost, "minMargin:", parsed.minMargin);
  console.log("destinationCountry:", parsed.destinationCountry, "maxShippingDays:", parsed.maxShippingDays);
  console.log("usage:", JSON.stringify(j?.usage ?? null));
} catch {
  console.log("content (first 300):", String(content).slice(0, 300));
}
