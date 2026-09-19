/**
 * Types shared by lib/ and app/. Pure type-only — no runtime code.
 */

export type Currency = "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY" | "CNY" | "UNKNOWN";

export type Constraints = {
  searchPhrases: string[];          // 1–3 phrases
  category?: string | null;
  maxProductCost: number;            // > 0
  minMargin: number;                 // (0, 1)
  destinationCountry: string;        // ISO 3166-1 alpha-2
  maxShippingDays: number;           // integer ≥ 1
};

export type CJFreight = {
  logisticName: string;
  logisticPrice: number | null;
  logisticPriceCn?: number | null;
  logisticAgingRaw: string;
  deliveryUpperDays: number | null;  // parsed upper bound, null = UNKNOWN
  taxesFee?: number | null;
  clearanceOperationFee?: number | null;
  totalPostageFee: number | null;    // authoritative shipping total; null = insufficient evidence
};

export type CJVariant = {
  vid: string;
  pid: string;
  variantSku: string | null;
  variantSellPrice: number;          // always a valid positive number (enforced by coercePositivePrice)
  variantWeight: number | null;      // null when missing (must not become zero)
  variantImage: string | null;
  variantNameEn: string | null;
  // inventory from stock/queryByVid
  inventory: {
    cjHeld: number | null;            // CJ warehouse stock
    factory: number | null;           // factory stock
    total: number | null;             // reported total (informational only)
    rowCount: number;                 // how many rows matched (scoring takes first, does not sum)
  } | null;                           // null = stock unknown / endpoint unreachable
};

export type CJCandidate = {
  pid: string;
  title: string;
  image: string | null;
  variant: CJVariant;
  freight: CJFreight | null;         // null = shipping unavailable to destination
};

export type Rejection = {
  productId: string;
  variantId: string;
  reasons: string[];
};

export type NeedsMoreEvidence = {
  productId: string;
  variantId: string;
  reason: string;                     // "Competition evidence insufficient: only N usable Shopping results"
};

export type Evaluation = {
  productId: string;
  variantId: string;
  title: string;
  image: string | null;
  currency: Currency;
  landedCost: number;
  productCost: number;               // CJ variant price (supplier cost)
  freightCost: number | null;        // validated total shipping
  marketMedianPrice: number | null;
  suggestedPrice: number | null;      // null when product is rejected for margin
  minSellingPrice: number;
  expectedMargin: number | null;      // null when suggestedPrice is null
  marketSource?: "google_shopping";
  marketMedianSampleSize?: number;
  scores: {
    marginScore: number | null;       // null when rejected for margin
    momentumScore: number | null;     // null when rejected for strong decline
    fulfillmentScore: number | null;  // null when stock unknown
    competitionOpportunity: number | null;
    saturationRisk: number | null;
    composite: number | null;
  };
  evidence: EvidenceItem[];
  inventory: CJVariant["inventory"];
  recommendation: string;
  approvalToken?: string;             // only for ranked products
};

export type EvidenceItem = {
  label: string;
  value: string;
  source: string;                     // safe public URL or endpoint reference
  fetchedAt: string;                  // ISO timestamp
};

export type ApiUsage = {
  cjCalls: number;
  serpApiCalls: number;
  openaiCalls: number;
  cacheHits: number;
  cacheMisses: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmModel: string;
};

export type InterpretRequest = { goal: string };
export type InterpretResponse = { constraints: Constraints };

export type SearchSummary = {
  cjResultsFound: number;           // total CJ products returned by search
  passedRelevance: number;          // after relevance filter
  passedPrice: number;              // after max-cost filter
  hadValidFreight: number;          // after freight + delivery filter
  minDeliveryDaysFound: number | null;  // shortest upper-bound delivery across all freight options
  noCandidatesReason: string | null;    // populated when zero finalists, explains why
};

export type EvaluateRequest = { constraints: Constraints; goal?: string };
export type EvaluateResponse = {
  rankedProducts: Evaluation[];
  needsMoreEvidenceProducts: NeedsMoreEvidence[];
  rejectedProducts: Rejection[];
  searchSummary: SearchSummary;
  apiUsage: ApiUsage;
};

export type ListingRequest = {
  productId: string;
  variantId: string;
  approvalToken: string;
};
export type ListingResponse = {
  listing: {
    title: string;
    description: string;
    featureBullets: string[];
    suggestedPrice: number;
    minSellingPrice: number;
    currency: Currency;
    images: string[];
    productId: string;
    variantId: string;
    costBreakdown: {
      productCost: number;
      freightCost: number;
      landedCost: number;
      margin: number;
    };
  };
  sourceProvenance: { reFetchedAt: string; constraintFingerprint: string };
};
