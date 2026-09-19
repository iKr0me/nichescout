/**
 * Server-signed short-lived approval token (HMAC-SHA256).
 *
 * Token = base64url(JSON(payload)) "." base64url(HMAC(payload)).
 * Payload binds the approval decision to: productId, variantId, productCost,
 * freightCost, marketMedianPrice, suggestedPrice, margin, currency,
 * destinationCountry, minMargin, maxShippingDays, scoringVersion,
 * evaluatedAt, expiresAt, and a SHA-256 constraintFingerprint.
 *
 * The browser stores the token opaquely; only /api/listing verifies it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Constraints } from "./types.ts";
import { constraintFingerprint } from "./validation.ts";

export const TOKEN_TTL_SECONDS = 15 * 60;

export type ApprovalPayload = {
  productId: string;
  variantId: string;
  productCost: number;
  freightCost: number | null;
  marketMedianPrice: number | null;
  suggestedPrice: number | null;
  minSellingPrice: number;
  margin: number | null;
  currency: string;
  destinationCountry: string;
  minMargin: number;
  maxShippingDays: number;
  scoringVersion: string;
  evaluatedAt: number;
  expiresAt: number;
  constraintFingerprint: string;
};

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const norm = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(norm, "base64");
}

function getSecret(): string {
  const s = process.env.APP_SIGNING_SECRET;
  if (!s || s.length < 32) {
    throw new Error("APP_SIGNING_SECRET missing or too short (need ≥32 chars)");
  }
  return s;
}

export function signApprovalPayload(
  payload: Omit<ApprovalPayload, "constraintFingerprint">,
  constraints: Constraints,
): string {
  const full: ApprovalPayload = {
    ...payload,
    constraintFingerprint: constraintFingerprint(constraints),
  };
  const body = b64url(JSON.stringify(full));
  const sig = b64url(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyApprovalToken(token: string, now = Date.now()): ApprovalPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("approval token: malformed");
  const [body, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const got = b64urlDecode(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error("approval token: signature mismatch");
  }
  const json = b64urlDecode(body).toString("utf8");
  const payload = JSON.parse(json) as ApprovalPayload;
  if (!payload.expiresAt || payload.expiresAt * 1000 < now) {
    throw new Error("approval token: expired");
  }
  for (const k of [
    "productId","variantId","productCost","minSellingPrice","currency",
    "destinationCountry","minMargin","maxShippingDays","scoringVersion",
    "evaluatedAt","expiresAt","constraintFingerprint",
  ] as const) {
    if (payload[k] === undefined || payload[k] === null) {
      throw new Error(`approval token: missing ${k}`);
    }
  }
  return payload;
}

export function computeConstraintFingerprint(c: Constraints): string {
  return constraintFingerprint(c);
}
