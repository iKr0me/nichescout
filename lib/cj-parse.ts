/**
 * Pure CJ response parsers — no network, no I/O. Unit-tested.
 *
 * Rules enforced here:
 *  - A monetary/quantity field is accepted ONLY when it is a finite number or
 *    a non-empty NUMERIC string. Booleans, arrays, objects, hex strings,
 *    "Infinity"/"NaN", and empty/whitespace strings are all rejected (null).
 *  - The authoritative shipping total is CJ's `totalPostageFee` field. It is
 *    used directly when valid; fees are NEVER summed on top of it.
 *  - When `totalPostageFee` is missing/invalid, the total is INSUFFICIENT
 *    EVIDENCE (null) — we do NOT assume missing fees are zero and do NOT
 *    fall back to logisticPrice + guessed fees.
 *
 * Field semantics note: this interpretation (totalPostageFee is the complete
 * postage total) is to be confirmed against
 *   https://developers.cjdropshipping.com/en/api/api2/api/logistic.html
 * Docs were unreachable during this build, so we take the conservative path:
 * valid totalPostageFee → use it; otherwise → null (insufficient evidence).
 */

import type { CJFreight } from "./types.ts";
import { parseAgingRange } from "./validation.ts";

/** Matches a plain decimal / scientific numeric string. Rejects hex, words. */
const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    const t = v.trim();
    if (t === "" || !NUMERIC_STRING.test(t)) return null;
    n = Number(t);
  } else {
    return null;   // boolean, array, object, bigint, symbol, function
  }
  return Number.isFinite(n) ? n : null;
}

/** Finite positive number only. */
export function coercePositivePrice(v: unknown): number | null {
  const n = coerceNumber(v);
  return n !== null && n > 0 ? n : null;
}

/** Finite non-negative number only. A numeric 0 is valid (free shipping). */
export function coerceNonNegative(v: unknown): number | null {
  const n = coerceNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/** Finite number ≥ 0 only (delivery days). */
export function coerceDeliveryDays(v: unknown): number | null {
  const n = coerceNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/**
 * Authoritative shipping total.
 *
 * Precedence:
 *   1. `totalPostageFee` (provider's complete postage total) — used directly,
 *      never summed with anything.
 *   2. If absent/invalid → null (INSUFFICIENT EVIDENCE). We never assume
 *      missing fees are zero.
 */
export function validatedTotalFreight(parts: {
  totalPostageFee?: unknown;
}): number | null {
  return coerceNonNegative(parts.totalPostageFee);
}

/** Convenience overload over a CJFreight object. */
export function totalFreightCost(f: CJFreight | null | undefined): number | null {
  if (!f) return null;
  return validatedTotalFreight({ totalPostageFee: f.totalPostageFee });
}

/**
 * Select the cheapest eligible freight option using `totalPostageFee` as the
 * shipping total (the same validated value used for scoring, signing, and
 * refetch).
 *
 * An option is eligible when it has a non-empty logisticName, a valid
 * totalPostageFee, and a parseable logisticAging range whose upper bound is
 * within maxShippingDays.
 *
 * Returns null when no eligible option exists — shipping is then "unavailable
 * within the seller's delivery constraint", never free or invented.
 */
export function selectFreightOption(
  options: any[],
  maxShippingDays: number,
): CJFreight | null {
  let best: CJFreight | null = null;
  let bestTotal: number | null = null;

  for (const o of options ?? []) {
    if (typeof o?.logisticName !== "string" || !o.logisticName.trim()) continue;
    const total = validatedTotalFreight(o);
    if (total === null) continue;                 // no valid totalPostageFee → insufficient
    const aging = parseAgingRange(typeof o?.logisticAging === "string" ? o.logisticAging : "");
    if (!aging) continue;                         // unparseable/empty aging → skip
    if (aging.upper > maxShippingDays) continue;  // exceeds delivery constraint

    if (bestTotal === null || total < bestTotal) {
      bestTotal = total;
      best = {
        logisticName: o.logisticName,
        logisticPrice: coerceNonNegative(o?.logisticPrice),
        logisticPriceCn: coerceNonNegative(o?.logisticPriceCn),
        logisticAgingRaw: String(o.logisticAging ?? ""),
        deliveryUpperDays: aging.upper,
        taxesFee: coerceNonNegative(o?.taxesFee),
        clearanceOperationFee: coerceNonNegative(o?.clearanceOperationFee),
        totalPostageFee: total,
      };
    }
  }
  return best;
}
