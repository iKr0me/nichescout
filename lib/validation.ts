/**
 * Server-side validation for interpreted constraints, LLM outputs, and
 * approval-payload requests. Rejects malformed or out-of-range values
 * before they reach the engine.
 *
 * currency handling: only an EXPLICIT ISO code supplied by a provider is
 * accepted. A bare "$" or "¥" symbol is never guessed, and a destination
 * country is NOT evidence of a price's currency (a seller can price in any
 * currency). Unknown currency → the engine must reject for missing evidence.
 */

import { createHash } from "node:crypto";
import type { Constraints } from "./types";

const ISO3166 = new Set([
  "US","CA","MX","GB","DE","FR","ES","IT","NL","BE","SE","NO","FI","DK",
  "PL","PT","IE","AT","CH","JP","KR","CN","IN","AU","NZ","BR","AR","CL",
  "ZA","AE","SA","IL","TR","SG","MY","TH","ID","PH","VN","HK","TW",
]);

// Categories are free-form: the goal-interpretation LLM may propose any short
// descriptive label. We only bound the length and reject control characters —
// an allowlist would reject valid-but-unlisted labels and break the request.
const MAX_CATEGORY_LEN = 60;

const ISO_CURRENCY = new Set(["USD","EUR","GBP","CAD","AUD","JPY","CNY"]);

export type CurrencyCode = "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY" | "CNY" | "UNKNOWN";

export function validateConstraints(raw: unknown): Constraints {
  if (!raw || typeof raw !== "object") throw new Error("constraints: must be an object");
  const r = raw as Record<string, unknown>;

  // searchPhrases: 1–3 strings, each non-empty after trim. Full phrases kept
  // intact (no truncation) so the constraint fingerprint is exact.
  const phrasesRaw = r.searchPhrases;
  if (!Array.isArray(phrasesRaw) || phrasesRaw.length < 1 || phrasesRaw.length > 3) {
    throw new Error("constraints.searchPhrases: must be array of 1–3 strings");
  }
  const searchPhrases = phrasesRaw.map((p, i) => {
    if (typeof p !== "string" || !p.trim())
      throw new Error(`constraints.searchPhrases[${i}]: must be non-empty string`);
    return p.trim();
  });

  const maxProductCost = Number(r.maxProductCost);
  if (!Number.isFinite(maxProductCost) || maxProductCost <= 0)
    throw new Error("constraints.maxProductCost: must be a finite number > 0");

  const minMargin = Number(r.minMargin);
  if (!Number.isFinite(minMargin) || minMargin <= 0 || minMargin >= 1)
    throw new Error("constraints.minMargin: must be a finite number in (0, 1)");

  const destinationCountry = String(r.destinationCountry || "").toUpperCase();
  if (!ISO3166.has(destinationCountry))
    throw new Error(`constraints.destinationCountry: invalid ISO code "${destinationCountry}"`);

  const maxShippingDays = Number(r.maxShippingDays);
  if (!Number.isInteger(maxShippingDays) || maxShippingDays < 1 || maxShippingDays > 60)
    throw new Error("constraints.maxShippingDays: must be integer in [1, 60]");

  const category = r.category == null
    ? null
    : (() => {
        const c = String(r.category).replace(/[\u0000-\u001F\u007F]/g, "").trim();
        if (!c) return null;
        if (c.length > MAX_CATEGORY_LEN) {
          throw new Error(`constraints.category: too long (max ${MAX_CATEGORY_LEN} chars)`);
        }
        return c;
      })();

  return { searchPhrases, maxProductCost, minMargin, destinationCountry, maxShippingDays, category };
}

/**
 * Range parser for CJ logisticAging strings like "5-11".
 * Returns null for malformed/negative/reversed; caller treats null as UNKNOWN.
 */
export function parseAgingRange(str: string): { lower: number; upper: number } | null {
  if (typeof str !== "string") return null;
  const s = str.trim();
  const m = /^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < 0 || b < 0) return null;
  if (a > b) return null;
  return { lower: a, upper: b };
}

/**
 * Currency from an EXPLICIT ISO code only. No symbol guessing, no
 * country-based inference — a missing/unknown code is UNKNOWN.
 */
export function detectCurrency(code: unknown): CurrencyCode {
  if (typeof code === "string") {
    const c = code.trim().toUpperCase();
    if (ISO_CURRENCY.has(c)) return c as Exclude<CurrencyCode, "UNKNOWN">;
  }
  return "UNKNOWN";
}

/** True when `code` is a known ISO currency (not UNKNOWN). */
export function isKnownCurrencyCode(code: unknown): code is Exclude<CurrencyCode, "UNKNOWN"> {
  return typeof code === "string" && ISO_CURRENCY.has(code.trim().toUpperCase());
}

/**
 * Constraint fingerprint: SHA-256 of canonical JSON containing EVERY exact
 * constraint — destination country, shipping days, margin, cost, category,
 * and the full (untruncated) search phrases. No rounding, no truncation.
 */
export function constraintFingerprint(c: Constraints): string {
  const canonical = {
    category: c.category ?? null,
    destinationCountry: c.destinationCountry,
    maxProductCost: c.maxProductCost,
    maxShippingDays: c.maxShippingDays,
    minMargin: c.minMargin,
    searchPhrases: c.searchPhrases,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
