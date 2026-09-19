/**
 * CJ Dropshipping client — documented endpoints verified in the feasibility
 * test: getAccessToken, product/listV2, product/query, product/stock/queryByVid,
 * logistic/freightCalculate.
 *
 * Parsing logic lives in cj-parse.ts (pure, unit-tested). This module handles
 * auth, token caching, and a queued rate limiter (1 req/sec) that is actually
 * used by every CJ call.
 */

import type { CJFreight, CJVariant } from "./types";
import { ApiUsageTracker } from "./cache";
import { selectFreightOption, coercePositivePrice } from "./cj-parse";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const TOKEN_CACHE_KEY = "cj:accessToken";
const TOKEN_TTL_MS = 25 * 60 * 1000;   // 25 min — safely below CJ's 30-min expiry

type TokenEntry = { token: string; expiresAt: number };
const tokenStore = new Map<string, TokenEntry>();

// ---------------------------------------------------------------------------
// Queued rate limiter: one CJ call at a time, ≥1100ms apart.
// ---------------------------------------------------------------------------

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  // Keep the chain alive even on failure so the queue never wedges.
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Fetch + auth
// ---------------------------------------------------------------------------

async function jfetch(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<{ status: number; json: any; retryAfter: string | null }> {
  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { json = null; }
      clearTimeout(t);
      const retryAfter = res.headers.get("retry-after");
      if (res.status === 429 && retryAfter && i < retries) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs) && secs > 0) await new Promise((r) => setTimeout(r, secs * 1000));
      }
      return { status: res.status, json, retryAfter };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("CJ fetch failed");
}

async function getAccessToken(apiKey: string, usage: ApiUsageTracker): Promise<string> {
  const cached = tokenStore.get(TOKEN_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  usage.bumpCj();
  const r = await enqueue(() =>
    jfetch(`${BASE}/authentication/getAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }),
  );

  // One reauthentication attempt after an authorization failure.
  if (r.status === 401 || r.status === 403) {
    usage.bumpCj();
    const r2 = await enqueue(() =>
      jfetch(`${BASE}/authentication/getAccessToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      }),
    );
    if (r2.status === 200 && r2.json?.data?.accessToken) {
      const tok = r2.json.data.accessToken;
      tokenStore.set(TOKEN_CACHE_KEY, { token: tok, expiresAt: Date.now() + TOKEN_TTL_MS });
      return tok;
    }
  }
  if (r.status !== 200 || !r.json?.data?.accessToken) {
    throw new Error(`CJ auth failed: status=${r.status} message=${r.json?.message || ""}`);
  }
  const tok = r.json.data.accessToken;
  tokenStore.set(TOKEN_CACHE_KEY, { token: tok, expiresAt: Date.now() + TOKEN_TTL_MS });
  return tok;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SearchHit = { pid: string; title: string; image: string | null };

export async function searchProducts(
  phrase: string,
  pageSize = 20,
  usage: ApiUsageTracker,
): Promise<SearchHit[]> {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error("CJ_API_KEY not configured");
  const token = await getAccessToken(apiKey, usage);

  usage.bumpCj();
  const url = `${BASE}/product/listV2?page=1&size=${pageSize}&keyWord=${encodeURIComponent(phrase)}`;
  const r = await enqueue(() => jfetch(url, { headers: { "CJ-Access-Token": token } }));
  if (r.status !== 200 || r.json?.result !== true) return [];
  const content = Array.isArray(r.json?.data?.content) ? r.json.data.content : [];
  const flat = content.flatMap((c: any) =>
    Array.isArray(c?.productList) ? c.productList : [],
  );
  return flat.map((it: any) => ({
    pid: it?.id ?? it?.pid,
    title: it?.nameEn || it?.productNameEn || it?.productName || "(unnamed)",
    image: it?.productImage || it?.bigImage || null,
  }));
}

export async function getProductDetail(
  pid: string,
  usage: ApiUsageTracker,
): Promise<{ product: any; variants: any[] } | null> {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error("CJ_API_KEY not configured");
  const token = await getAccessToken(apiKey, usage);

  usage.bumpCj();
  const r = await enqueue(() =>
    jfetch(`${BASE}/product/query?pid=${encodeURIComponent(pid)}`, {
      headers: { "CJ-Access-Token": token },
    }),
  );
  if (r.status !== 200 || r.json?.result !== true) return null;
  const data = r.json.data || {};
  return { product: data, variants: Array.isArray(data.variants) ? data.variants : [] };
}

export async function getStock(
  vid: string,
  originCountry: string,
  usage: ApiUsageTracker,
): Promise<CJVariant["inventory"]> {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error("CJ_API_KEY not configured");
  const token = await getAccessToken(apiKey, usage);

  usage.bumpCj();
  const url = `${BASE}/product/stock/queryByVid?vid=${encodeURIComponent(vid)}`;
  const r = await enqueue(() => jfetch(url, { headers: { "CJ-Access-Token": token } }));
  if (r.status !== 200 || !Array.isArray(r.json?.data)) return null;
  const norm = (code: string) => (code ? code.toUpperCase() : "");
  const matched = (r.json.data as any[]).filter(
    (row) => row?.vid === vid && norm(row?.countryCode) === norm(originCountry),
  );
  if (!matched.length) return null;
  const row = matched[0];   // first matching row only; never sum across rows
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    cjHeld: num(row.cjInventoryNum),
    factory: num(row.factoryInventoryNum),
    total: num(row.totalInventoryNum),
    rowCount: matched.length,
  };
}

export async function calculateFreight(
  vid: string,
  startCountry: string,
  endCountry: string,
  maxShippingDays: number,
  usage: ApiUsageTracker,
): Promise<CJFreight | null> {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error("CJ_API_KEY not configured");
  const token = await getAccessToken(apiKey, usage);

  usage.bumpCj();
  const body = {
    startCountryCode: startCountry,
    endCountryCode: endCountry,
    products: [{ quantity: 1, vid }],
  };
  const r = await enqueue(() =>
    jfetch(`${BASE}/logistic/freightCalculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CJ-Access-Token": token },
      body: JSON.stringify(body),
    }),
  );
  if (r.status !== 200 || !Array.isArray(r.json?.data) || r.json.data.length === 0) {
    return null;
  }
  // Delivery limit applied here, not skipped: selectFreightOption drops any
  // option whose upper delivery bound exceeds maxShippingDays.
  return selectFreightOption(r.json.data, maxShippingDays);
}

/**
 * Discover all freight options without the delivery-days filter — used to
 * find the shortest available delivery when nothing passes the limit, so the
 * UI can tell the user "the fastest shipping to DE is 8-12 days; try 12 days."
 */
export async function discoverFreightOptions(
  vid: string,
  startCountry: string,
  endCountry: string,
  usage: ApiUsageTracker,
): Promise<any[]> {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error("CJ_API_KEY not configured");
  const token = await getAccessToken(apiKey, usage);
  usage.bumpCj();
  const r = await enqueue(() =>
    jfetch(`${BASE}/logistic/freightCalculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CJ-Access-Token": token },
      body: JSON.stringify({
        startCountryCode: startCountry,
        endCountryCode: endCountry,
        products: [{ quantity: 1, vid }],
      }),
    }),
  );
  if (r.status !== 200 || !Array.isArray(r.json?.data)) return [];
  return r.json.data;
}

export async function refetchApprovedCandidate(
  productId: string,
  variantId: string,
  destinationCountry: string,
  originCountry: string,
  maxShippingDays: number,
  usage: ApiUsageTracker,
): Promise<{ variant: CJVariant; freight: CJFreight | null; inventory: CJVariant["inventory"]; title: string; image: string | null } | null> {
  const detail = await getProductDetail(productId, usage);
  if (!detail) return null;
  const v = detail.variants.find((x: any) => x?.vid === variantId);
  if (!v) return null;
  const price = coercePositivePrice(v?.variantSellPrice);
  if (price === null) return null;   // missing cost must not become zero
  const variant: CJVariant = {
    vid: String(v.vid),
    pid: productId,
    variantSku: typeof v.variantSku === "string" ? v.variantSku : null,
    variantSellPrice: price,
    variantWeight: typeof v.variantWeight === "number" && Number.isFinite(v.variantWeight) ? v.variantWeight : null,
    variantImage: typeof v.variantImage === "string" ? v.variantImage : null,
    variantNameEn: typeof v.variantNameEn === "string" ? v.variantNameEn : null,
    inventory: null,
  };
  const freight = await calculateFreight(variant.vid, originCountry, destinationCountry, maxShippingDays, usage);
  const inventory = await getStock(variant.vid, originCountry, usage);
  variant.inventory = inventory;
  return {
    variant,
    freight,
    inventory,
    title: detail.product?.productNameEn || detail.product?.productName || "(unnamed)",
    image: typeof detail.product?.productImage === "string" ? detail.product.productImage : null,
  };
}
