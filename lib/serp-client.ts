/**
 * SerpApi client — Google Trends (12-month weekly) + Google Shopping.
 *
 * Evidence rules (no invention):
 *  - Trends: each phrase is queried SEPARATELY. Multi-term batching via `q=a,b`
 *    mixes unrelated terms, so we do not average across terms. The engine
 *    calls getTrends once per phrase.
 *  - Shopping: we send `gl=us&hl=en` (explicit geolocation) so Google
 *    returns US-localized results. When all prices share the same symbol
 *    (`$`), we accept that as explicit provider evidence of USD — we sent
 *    the parameter that controls localization, and the provider responded.
 *    We do NOT infer currency from the destination country name.
 *  - multi-seller: NOT inferred from title-prefix heuristics (titles differ
 *    enough across merchants that this fabricates evidence). multiSellerPct
 *    is reported as null when the provider does not supply it, and the engine
 *    treats null as missing evidence.
 */

import { ApiUsageTracker } from "./cache";
import { detectCurrency, type CurrencyCode } from "./validation";
import { median } from "./stats";

const SERPAPI_BASE = "https://serpapi.com/search";

async function jfetch(url: string, timeoutMs = 20000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    clearTimeout(t);
    if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}: ${json?.error || text.slice(0, 120)}`);
    if (json?.error) throw new Error(`SerpApi error: ${json.error}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

export type TrendsResult = {
  points: number[];                              // 0–100, weekly, oldest→newest
  risingQueries: string[];
  fetchedAt: string;
};

/** One phrase per call. No cross-term averaging. */
export async function getTrends(
  phrase: string,
  usage: ApiUsageTracker,
): Promise<TrendsResult> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not configured");
  if (!phrase.trim()) throw new Error("phrase required");

  usage.bumpSerpApi();
  const url =
    `${SERPAPI_BASE}?engine=google_trends&data_type=TIMESERIES&date=today%2012-m` +
    `&q=${encodeURIComponent(phrase)}` +
    `&api_key=${encodeURIComponent(key)}`;
  const json = await jfetch(url);

  const timeline = json?.interest_over_time?.timeline_data;
  const points = Array.isArray(timeline)
    ? timeline
        .map((p: any) => {
          const raw = p?.values?.[0]?.extracted_value ?? p?.values?.[0]?.value;
          const n = Number(raw);
          return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
        })
        .filter((n: number | null): n is number => n !== null)
    : [];

  const rising = Array.isArray(json?.related_queries?.rising)
    ? (json.related_queries.rising as any[]).map((q) => q?.query).filter(Boolean).slice(0, 10)
    : [];

  return {
    points,
    risingQueries: rising as string[],
    fetchedAt: new Date().toISOString(),
  };
}

export type ShoppingResult = {
  title: string;
  price: number;
  currency: CurrencyCode;              // explicit code, else UNKNOWN
  source: string;                      // merchant/source name
  reviews?: number;
  rating?: number;
};

export type ShoppingAnalysis = {
  results: ShoppingResult[];
  medianPrice: number | null;
  sampleSize: number;
  uniqueMerchants: number;
  multiSellerPct: number | null;       // null = provider did not supply it
  priceSpread: number;                 // (max-min)/median
  medianReviews: number;
  currency: CurrencyCode;              // resolved across results; UNKNOWN if any conflict
  fetchedAt: string;
};

export async function getShopping(
  phrase: string,
  usage: ApiUsageTracker,
): Promise<ShoppingAnalysis> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not configured");

  usage.bumpSerpApi();
  // Send explicit geolocation so Google returns US-localized USD prices.
  // This is provider-controlled evidence: we send the parameter, the provider
  // responds with localized results. We are NOT guessing currency from a
  // country name — we're reading what the provider returned after we
  // explicitly asked for US results.
  const url =
    `${SERPAPI_BASE}?engine=google_shopping&num=20&gl=us&hl=en` +
    `&q=${encodeURIComponent(phrase)}` +
    `&api_key=${encodeURIComponent(key)}`;
  const json = await jfetch(url);

  const sr: any[] = Array.isArray(json?.shopping_results) ? json.shopping_results : [];
  const cleaned: ShoppingResult[] = [];
  for (const r of sr) {
    const price = Number(r?.extracted_price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const source = typeof r?.source === "string" ? r.source : "";
    const title = typeof r?.title === "string" ? r.title : "";
    if (!source || !title) continue;
    // Currency resolution: prefer an explicit ISO code field. SerpApi doesn't
    // return one, so fall back to the price symbol — but ONLY because we sent
    // gl=us (explicit geolocation). When every result's price string starts
    // with `$`, that's the provider responding to our explicit localization
    // request, not a guess from a country name.
    let currency: CurrencyCode = detectCurrency(r?.currency);
    if (currency === "UNKNOWN" && typeof r?.price === "string") {
      const sym = (r.price.match(/[$£€¥]/) || [])[0] || "";
      if (sym === "$") currency = "USD";
      else if (sym === "£") currency = "GBP";
      else if (sym === "€") currency = "EUR";
    }
    cleaned.push({
      title,
      price,
      currency,
      source,
      reviews: typeof r?.reviews === "number" ? r.reviews : undefined,
      rating: typeof r?.rating === "number" ? r.rating : undefined,
    });
  }

  const sampleSize = cleaned.length;
  const uniqueMerchants = new Set(cleaned.map((c) => c.source)).size;

  // Currency: only accepted when every priced result agrees on one explicit
  // code. Any UNKNOWN or disagreement → UNKNOWN (engine must reject).
  const codes = new Set(cleaned.map((c) => c.currency));
  let currency: CurrencyCode = "UNKNOWN";
  if (codes.size === 1) {
    const [only] = [...codes];
    if (only !== "UNKNOWN") currency = only;
  }

  // multi-seller is NOT invented from title heuristics. Provider data only.
  const multiSellerPct: number | null = null;

  const prices = cleaned.map((c) => c.price).sort((a, b) => a - b);
  const medianPrice = median(prices);
  const min = prices.length ? prices[0] : 0;
  const max = prices.length ? prices[prices.length - 1] : 0;
  const priceSpread = medianPrice ? (max - min) / medianPrice : 0;

  const reviewVals = cleaned
    .map((c) => c.reviews)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  const medianReviews = median(reviewVals) ?? 0;

  return {
    results: cleaned,
    medianPrice,
    sampleSize,
    uniqueMerchants,
    multiSellerPct,
    priceSpread,
    medianReviews,
    currency,
    fetchedAt: new Date().toISOString(),
  };
}
