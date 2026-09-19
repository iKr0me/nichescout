# Commerce-track: Niche Product Evaluator MVP

## What we're building

A single Next.js app where an ecommerce seller enters a free-text goal, the agent interprets it into structured constraints, fetches real supplier data from CJ Dropshipping and real market data from SerpApi (Google Trends + Google Shopping), evaluates candidates through a deterministic scoring engine, rejects unsuitable products with reasons, ranks the top 3–5 survivors with evidence, and generates a product listing only after the user approves a specific product.

## MVP scope

**In scope:**
- Real CJ Dropshipping data (product cost, freight/shipping, variants, inventory, images)
- Real SerpApi data — Google Trends (demand momentum) + Google Shopping (pricing & competition indicators)
- Deterministic evaluation engine with 4 scoring dimensions + rejection gates
- Free-text seller goal → LLM interprets into structured constraints (Call 1)
- Shortlist of 3–5 products after candidate funnel
- Human approval gate before listing generation
- One LLM call for listing generation after approval (Call 2)
- Deterministic recommendation explanations from scores/evidence (no LLM)
- Failure cases, best-effort caching, timestamps, source links, API-usage reporting
- Prompt-injection risk reduction: external text treated as untrusted data

**Out of scope (unchanged):**
- No persistence — no database, state lives in browser session + server memory per request
- No Shopify/store publishing — listing is a preview payload only
- No user auth — single-user demo
- No AliExpress / TikTok / Shein / Temu scraping
- No ML model for scoring (deterministic only)

---

## Environment variables

```
CJ_API_KEY=<from cjdropshipping.com developer settings>
SERPAPI_KEY=<from serpapi.com>
OPENAI_API_KEY=<from platform.openai.com>
OPENAI_MODEL=<selected runtime model, e.g. gpt-4o-mini>
APP_SIGNING_SECRET=<long random server-side secret for approval tokens>
```

All credentials stay server-side only. Never exposed to the browser. Never included in source links. Keep all API keys and secrets out of messages, screenshots, source control, and committed files.

---

## Architecture — single Next.js application

```
commerce-track/
├── app/
│   ├── page.tsx                  # Main UI
│   ├── api/
│   │   ├── interpret/route.ts     # POST: free-text goal → LLM Call 1 → structured constraints
│   │   ├── evaluate/route.ts      # POST: constraints → CJ + SerpApi + engine → ranked products + approval token
│   │   └── listing/route.ts       # POST: productId + variantId + token → server validation → LLM Call 2 → listing
│   └── layout.tsx
├── lib/
│   ├── cj-client.ts              # Access token (cached), product listV2, freightCalculate, queued rate limiter
│   ├── serp-client.ts            # Google Trends + Google Shopping, batched where supported
│   ├── evaluation-engine.ts      # Deterministic scoring, rejection, ranking, financial calculations
│   ├── scoring.ts                # All 0–100 normalization formulas (pure functions, unit-tested)
│   ├── llm.ts                    # At most two call points: interpretation + listing generation (structured JSON output)
│   ├── cache.ts                  # Best-effort in-memory TTL cache (optional optimization)
│   ├── api-usage.ts              # Tracks calls, cache hits, token usage per evaluation run
│   ├── approval-token.ts         # Server-signed short-lived approval token (sign + verify)
│   ├── sanitize.ts               # Untrusted external text: length limit, strip HTML/control chars
│   ├── validation.ts             # Constraint + LLM-output + approval-payload validation
│   └── types.ts                  # Product, Variant, Evaluation, Evidence, Listing, Constraints types
├── components/
│   ├── GoalInput.tsx             # Free-text seller goal input
│   ├── ConstraintConfirm.tsx     # Editable confirmation screen for interpreted constraints
│   ├── ProductCard.tsx           # Ranked card with scores + deterministic recommendation
│   ├── EvidencePanel.tsx         # Expandable: raw data, timestamps, safe source links
│   ├── ApprovalFlow.tsx          # Approve/reject per product
│   ├── ListingPreview.tsx        # Generated listing after approval (title, desc, bullets, real images)
│   └── ApiUsageReport.tsx        # CJ calls, SerpApi calls, cache hits/misses, LLM tokens, est. cost
└── .env.example
```

### Why no persistence

- Vercel in-memory caching is best-effort and may disappear between serverless instances.
- Browser session state holds the current workflow (constraints, evaluated products, approval state).
- SerpApi provider-side caching handles identical request deduplication.
- No database for the MVP — by design.

---

## API routes

### `POST /api/interpret` — LLM Call 1

**Request:**
```json
{ "goal": "Find lightweight desk products under $12 that can ship to the United States within 10 days and leave at least a 35% margin" }
```

The LLM returns **structured JSON** (enforced via response format), which the server validates:

**Response (after server-side validation):**
```json
{
  "constraints": {
    "searchPhrases": ["desk organizer", "minimalist desk accessory", "cable management desk"],
    "category": "Home & Garden",
    "maxProductCost": 12.00,
    "minMargin": 0.35,
    "destinationCountry": "US",
    "maxShippingDays": 10
  }
}
```

**Server-side validation limits:**
- `searchPhrases`: array of 1–3 strings (cap enforced; more than 3 → truncated or rejected)
- `destinationCountry`: valid 2-letter ISO 3166-1 alpha-2 code
- `maxProductCost`: number > 0
- `minMargin`: number within an allowed range (e.g. 0.10–0.90)
- `maxShippingDays`: integer within an allowed range (e.g. 1–60)
- `category`: known category string, or omitted/null

The validated constraints are shown to the user in an **editable confirmation screen** before any expensive evaluation runs. The user can adjust any field or edit the search phrases. Evaluation begins only after the user confirms.

The LLM extracts structured constraints from the free-text goal. It does not search products, score, or calculate anything financial.

### `POST /api/evaluate` — core pipeline (no LLM)

Returns three product lists: **ranked products** (top 3–5 survivors, each with an approval token), **needs-more-evidence products** (insufficient competition evidence — not ranked, no approval token, no listing), and **rejected products** (with rejection reasons).

**Request:**
```json
{
  "constraints": { ...user-confirmed constraints... },
  "goal": "original free-text goal (for context)"
}
```

**Response:**
```json
{
  "rankedProducts": [ { ...evaluationResult, approvalToken } ],   // top 3–5 survivors (no "needs more evidence" items)
  "needsMoreEvidenceProducts": [ { ...evaluationResult } ],       // competition evidence insufficient — no ranking, no approval token, no listing
  "rejectedProducts": [ { ...evaluationResult } ],                // with rejection reasons
  "apiUsage": { "cjCalls": N, "serpApiCalls": N, "cacheHits": N, "cacheMisses": N, "llmCalls": 0 }
}
```

A product with insufficient competition evidence (`n < minShoppingResults`) is placed in `needsMoreEvidenceProducts`. It is **not ranked**, **not issued an approval token**, and **cannot generate a listing**. The evidence panel will report "Competition evidence insufficient: only {n} usable Shopping results (minimum {minShoppingResults})." The user may still view the evidence and optionally retry evaluation with broader search terms to gather more Shopping data.

Each ranked product carries a **server-signed approval token** (see approval-token design below). This route executes the candidate funnel, calls CJ + SerpApi, runs the deterministic engine, and returns ranked + rejected products. No LLM calls.

### `POST /api/listing` — LLM Call 2

**Request (minimal — no evaluation object, no browser-supplied constraints/price/score):**
```json
{
  "productId": "CJ-XXXXX",
  "variantId": "SKU-YYYYY",
  "approvalToken": "<server-signed token>"
}
```

**Server-side validation on receipt:**
1. Verify the approval token signature using `APP_SIGNING_SECRET`.
2. Verify the token has not expired, and that its `productId` + `variantId` match the request.
3. Use `destinationCountry`, `minMargin`, `maxShippingDays`, `currency`, and `scoringVersion` from the signed token — never from the browser.
4. Re-fetch the current CJ product and the exact variant by ID (cost, weight, inventory, images).
5. Re-fetch current freight for that exact variant and the signed `destinationCountry`.
6. Re-calculate landed cost and margin deterministically from the fresh data, using the signed `minMargin`.
7. **Price-change validation:** compare the freshly recalculated margin against the signed `minMargin`. If the current margin falls below `minMargin`, reject with 400. If current CJ cost or freight has changed beyond a documented tolerance (e.g. >5%) from the token's recorded values, require reevaluation rather than generating the listing.
8. Never trust any constraint, price, score, or margin supplied by the browser.
9. Treat all product text (title, description) as untrusted data — sanitize before passing to LLM.

**Response:**
```json
{
  "listing": {
    "title": "LLM-generated, optimized",
    "description": "LLM-generated, SEO-friendly",
    "featureBullets": ["bullet 1", "bullet 2", "bullet 3"],
    "suggestedPrice": 19.99,        // from engine, NOT from LLM
    "minSellingPrice": 16.50,       // from engine, NOT from LLM
    "images": ["real CJ variant image URLs"],
    "productId": "CJ-XXXXX",
    "variantId": "SKU-YYYYY",
    "costBreakdown": { "productCost": ..., "freightCost": ..., "landedCost": ..., "margin": ... }
  }
}
```

---

## Candidate funnel (efficient, ordered)

| Step | Action | API calls | Filter / decision |
|------|--------|-----------|-------------------|
| 1 | CJ product search (`GET /product/listV2`) — **one separate request per search phrase** | 1–3 | — |
| 2 | Select one exact variant/SKU per candidate (preserve productId, variantId, variant price, weight, inventory, images) | 0 (in-memory) | — |
| 3 | Cheap pre-freight filters: relevance, product/variant price ≤ maxProductCost, inventory > 0, valid variant data | 0 (in-memory) | Drop irrelevant candidates. **Do NOT filter on shipping availability here.** |
| 4 | Reduce to ~5 finalists | 0 (in-memory) | Top by relevance/price |
| 5 | CJ freight calculation (`POST /logistic/freightCalculate`) — **only for finalists, one per finalist** | 5 | — |
| 6 | Post-freight rejection: no shipping method, missing freight data, delivery > maxShippingDays, invalid freight value (missing, nonnumeric, or negative) | 0 (in-memory) | Drop now that shipping is actually known. A confirmed zero freight (free shipping) is valid, not a rejection. |
| 7 | Google Trends (batch terms where supported) | 1–2 | — |
| 8 | Google Shopping for each finalist | 3–5 | Provides market price + competition indicators |
| 9 | Deterministic scoring engine | 0 | Reject below thresholds, rank survivors |
| 10 | Return top 3–5 with approval tokens | — | — |

**CJ rate limiting:** a queued rate limiter ensures one CJ request at a time, honoring the provider's ~1 req/sec limit. When the provider returns `Retry-After`, honor it. Limited retries (max 3) with backoff. After an authorization failure, attempt token reauthentication **once**, then fail clearly if still unauthorized.

---

## Expected external API calls per evaluation

Approximate, depending on cache state and candidate count.

### Before approval (one full evaluation)

| Provider | Endpoint | Calls |
|----------|----------|-------|
| CJ | `getAccessToken` | 0–1 (cached, refresh only if expired) |
| CJ | `product/listV2` | 1–3 (one per search phrase) |
| CJ | `logistic/freightCalculate` | ~5 (one per finalist) |
| **CJ subtotal** | | **~6–9** |
| SerpApi | Google Trends | 1–2 (batched where supported) |
| SerpApi | Google Shopping | 3–5 (one per finalist) |
| **SerpApi subtotal** | | **~4–7** |
| OpenAI | Interpretation (Call 1) | 1 |
| **OpenAI subtotal** | | **1** |

**Before-approval total: ~11–17 external calls** (CJ ~6–9 + SerpApi ~4–7 + OpenAI 1).

### After approval (listing generation)

| Provider | Endpoint | Calls |
|----------|----------|-------|
| CJ | re-fetch product + variant | 1 |
| CJ | re-fetch freight | 1 |
| OpenAI | Listing generation (Call 2) | 1 |

**After-approval total: ~3 additional calls** (CJ 2 + OpenAI 1).

---

## Evaluation engine — scoring formulas and thresholds

### Financial calculations (all deterministic, never LLM)

All monetary values are for the **single selected variant** (one exact SKU), not a vague "cheapest variant."

```
productCost       = CJ variant price (exact SKU)
freightCost       = CJ freightCalculate result for that variant + destination country
landedCost        = productCost + freightCost
marketMedianPrice = median of Google Shopping organic result prices (same currency)
minSellingPrice   = landedCost / (1 - minMargin)
targetMarketPrice = marketMedianPrice × 0.95

if targetMarketPrice < minSellingPrice:
    → REJECT the product (uncompetitive at required margin)
else:
    suggestedPrice = round(targetMarketPrice, 2)
    expectedMargin = (suggestedPrice - landedCost) / suggestedPrice
    → verify expectedMargin ≥ minMargin; if rounding dropped it below, reject
```

**Do not raise an uncompetitive product's price merely to make the margin pass.** If the market can't sustain the required margin, the product is rejected with a clear reason, not rescued by inflating the price.

### Four scoring dimensions (0–100 each)

All normalization formulas are pure, deterministic functions in `lib/scoring.ts`, with unit tests proving each input maps to the documented score.

---

**1. Margin Health** — composite weight 35%

```
marginRatio   = (suggestedPrice - landedCost) / suggestedPrice
marginScore   = clamp( (marginRatio / 0.50) × 100, 0, 100 )
              // 50% margin → 100 points; 30% → 60; ≤0% → 0
```
- **Rejection gate:** `targetMarketPrice < minSellingPrice` (rejected in financial step), or `marginRatio < minMargin`.
- **Reject reason:** "Uncompetitive at required margin: target market price ${targetMarketPrice} below min profitable price ${minSellingPrice}. Landed cost ${landedCost}, market median ${marketMedianPrice}."

---

**2. Demand Momentum** — composite weight 25%

Inputs from Google Trends (via SerpApi):
- Trend direction (rising / flat / declining)
- Recent momentum (linear-regression slope over the last 12 weekly interest points)
- Interest stability (coefficient of variation)
- Related rising queries

**Related rising queries are used only for discovering additional, more-specific search phrases** — they are **not** part of the demand score formula. (They may surface new phrases the user can add on the confirmation screen before re-evaluating.)

The 12 weekly interest values (0–100) are fit with ordinary least-squares linear regression. The slope `s` is the regression slope expressed in **interest points per week** (change in the 0–100 interest index per week, NOT a percentage change).

```
directionScore (0–100) — categorical direction of the fitted trend line:
  rising    → 100
  flat      → 50   (|s| ≤ flatSlopeThreshold, e.g. 0.25 points/week)
  declining → 0

slopeScore (0–100), slope s = regression slope in interest points/week:
  slopeScore = clamp( 50 + s × 10, 0, 100 )
  // s = +5 points/week → 100; s = 0 → 50; s = -5 points/week → 0

stabilityScore (0–100), coefficient of variation cv = stddev / mean of the 12 weekly values
  (guard: mean ≤ 0 → cv = 1, i.e. 0 score):
  stabilityScore = clamp( 100 − cv × 200, 0, 100 )
  // cv = 0 (perfectly stable) → 100; cv = 0.5 → 0

momentumScore = 0.40 × directionScore + 0.35 × slopeScore + 0.25 × stabilityScore
```

- **Strong-decline rejection threshold:** reject only when the slope `s ≤ -3 points/week` (a measurably strong decline). Slight declines (`0 > s > -3 points/week`) reduce the score but do **not** auto-reject.
- **Reject reason (strong decline only):** "Strong demand decline: interest falling {s} points/week over 12 weeks (threshold -3 points/week)."

---

**3. Competition Indicator** — composite weight 25%

Sample-based indicators from Google Shopping results (NOT exact seller counts, NOT exact saturation). The score is a **competition indicator**, never an exact measurement.

Simplified formula uses two verified inputs only:

```
saturationRisk = 0.60 × merchantDiversityRisk
               + 0.40 × priceSpreadRisk
```

```
merchantDiversityRisk — m = number of unique merchants in the returned sample (m ≤ n):
  clamp( m / n × 100, 0, 100 )
  // 0 unique merchants → 0 risk; every result a distinct merchant → 100 risk

priceSpreadRisk — spread = (max − min) / median of sampled prices:
  // Tight spread → commoditized → high saturation. Wide spread → differentiated → low saturation.
  priceSpreadRisk = clamp( 100 − spread × 200, 0, 100 )
  // spread = 0 → 100 risk; spread = 0.5 (50%) → 0 risk
```

**SCORING_VERSION = `"competition-estimate-2026-03"`** — bound into the approval token so prior approvals cannot be re-evaluated against a different formula.

**Removed (no provider evidence available):**
- `multiSellerRisk` — Google Shopping does not return reliable per-listing multi-seller data. Title-prefix matching yields zero hits on real results.
- `reviewConcentrationRisk` — reviews are optional information, not a required scoring input. Removed from the score entirely; sample-level review fields are still surfaced in the evidence panel as informational.

```
competitionOpportunity = 100 - saturationRisk
```

- **Minimum-samples gate:** With fewer than 5 usable Shopping results, the product goes directly into `needsMoreEvidenceProducts`. No `saturationRisk`, no `competitionOpportunity`, no composite score, no ranking, no approval token, no listing.
- **Currency disagreement gate:** If Shopping results contain multiple currencies (or any UNKNOWN currency), the product is treated as missing market evidence and goes to `needsMoreEvidenceProducts` for the same reason.
- **Rejection gate:** `saturationRisk > 85` → reject.
- **Composite uses `competitionOpportunity`**, not `saturationRisk`.
- **Evidence panel labels BOTH values clearly:** "Saturation risk: {N}/100" and "Competition opportunity: {N}/100", plus each raw input (unique merchants, merchant count, sample size, currency).
- **Reject reason:** "Saturation risk {N}/100 exceeds 85 threshold. Sample: {m} unique merchants of {n} results in {currency}."
- **Insufficient-evidence reason:** "Competition evidence insufficient: only {n} usable Shopping results (minimum {MIN_SHOPPING_RESULTS=5}), or currency disagreement across results."

---

**4. Fulfillment Confidence** — composite weight 15% (renamed from supplier reliability)

Calculated from available CJ evidence. **No invented supplier-reliability rating.**

```
fulfillmentScore = 0.35 × shippingAvailabilityScore
                 + 0.30 × deliveryRangeScore
                 + 0.20 × inventoryScore
                 + 0.15 × dataCompletenessScore
```

Normalization formulas:

```
shippingAvailabilityScore:
  100 if a shipping method exists for the destination country, else 0.
  // binary: available or not

deliveryRangeScore — d = estimated delivery days for the selected method:
  if d ≤ maxShippingDays: clamp( 100 − (d / maxShippingDays) × 40, 0, 100 )
  // d = 0 → 100; d = maxShippingDays → 60; faster is better
  if d > maxShippingDays: 0  (and the product is rejected, see gate)

inventoryScore — stock = variant inventory quantity:
  0 if stock ≤ 0 (rejected, see gate)
  else clamp( min(stock, 100) , 0, 100 )
  // 1 unit → 1; 100+ units → 100

dataCompletenessScore — fraction of required freight/variant fields present:
  requiredFields = [freightCost, deliveryDays, variantPrice, variantWeight, variantInventory, variantImages]
  present = count of requiredFields that are non-null/non-empty
  dataCompletenessScore = (present / total) × 100
```

- **Rejection gate (post-freight only):** no shipping method available, OR freight data missing, OR `d > maxShippingDays`, OR freight value invalid (missing, nonnumeric, or negative), OR stock ≤ 0. **A shipping cost of exactly zero is accepted if CJ confirms it as a valid free-shipping method.**
- **Reject reason:** specific, e.g. "No shipping method to {country}", or "Estimated delivery {d} days exceeds max {maxShippingDays}", or "Invalid freight value", or "Variant out of stock".

---

### Composite score

```
composite = 0.35 × marginScore
          + 0.25 × momentumScore
          + 0.25 × competitionOpportunity      // NOT saturationRisk
          + 0.15 × fulfillmentScore
```

When competition evidence is insufficient (`n < minShoppingResults`), **do not omit the competition term and renormalize the other weights. Do not calculate a composite score at all.** The product goes directly into `needsMoreEvidenceProducts`; it is not ranked, cannot receive an approval token, and cannot generate a listing.

Survivors ranked descending by composite. Top 3–5 displayed.

### Deterministic recommendation explanations

Generated from scores + evidence, NOT from LLM:
```
"Strong margin ({expectedMargin}%) with rising demand (momentum {momentumScore}/100). 
Competition opportunity {competitionOpportunity}/100 (saturation risk {saturationRisk}/100). 
Fulfillment viable: {deliveryDays}-day shipping to {country}. Landed cost ${landedCost}."
```

---

## Approval-token design

After a successful evaluation, the server signs a **short-lived approval token** for each ranked product. The token payload:

```json
{
  "productId": "CJ-XXXXX",
  "variantId": "SKU-YYYYY",
  "productCost": 8.50,
  "freightCost": 3.20,
  "landedCost": 11.70,
  "marketMedianPrice": 24.00,
  "suggestedPrice": 22.80,
  "margin": 0.487,
  "destinationCountry": "US",
  "minMargin": 0.35,
  "maxShippingDays": 10,
  "currency": "USD",
  "scoringVersion": "1",
  "evaluatedAt": 1730000000,
  "expiresAt": 1730003600
}
```

- Signed with `APP_SIGNING_SECRET` using HMAC-SHA256.
- `expiresAt` is short-lived (e.g. 15 minutes from `evaluatedAt`).
- The token is **signed and tamper-evident, not opaque or confidential**. A signed payload may still be readable by the browser (e.g. base64url-decoded); the browser must never trust or interpret its contents, only echo them back.
- `destinationCountry`, `minMargin`, `maxShippingDays`, `currency`, and `scoringVersion` are bound into the signed payload so the approval decision cannot be re-run against different constraints than the ones the user approved.

`/api/listing` receives only `productId`, `variantId`, and `approvalToken`. It does **not** accept browser-supplied constraints. It:
1. Verifies the HMAC signature and expiry.
2. Confirms token's `productId`/`variantId` match the request.
3. Uses the `destinationCountry`, `minMargin`, `maxShippingDays`, `currency`, and `scoringVersion` **from the signed token**, never from the browser.
4. Re-fetches current CJ product + exact variant data.
5. Re-fetches current freight for that variant and the signed `destinationCountry`.
6. Recalculates landed cost and margin deterministically using the signed `minMargin` and current CJ cost/freight.
7. Rejects if fresh values diverge from the token's values beyond tolerance, or if token is expired/invalid.
8. Never trusts browser-supplied scores, prices, or constraints.

---

## LLM usage — at most two calls per completed workflow (both structured JSON)

| Call | When | Purpose | Inputs | Outputs |
|------|------|---------|--------|---------|
| 1 | After user submits goal | Interpret free-text goal | Seller's free-text goal | Structured JSON: searchPhrases (≤3), category, maxCost, minMargin, destinationCountry, maxShippingDays |
| 2 | After user approves a product | Generate listing | Server-validated product data + financials (as fixed fields) + constraints | Structured JSON: title, description, featureBullets |

- Both calls use one supported model specified by `OPENAI_MODEL`, with **structured JSON output** enforced and validated against a strict schema.
- **"At most two" because listing generation (Call 2) occurs only after approval** — an evaluation that ends without approval makes only one LLM call, and no listing is generated.
- **Call 2 restrictions:**
  - Receives `suggestedPrice` and `minSellingPrice` as fixed fields — must not change them.
  - Receives real CJ variant image URLs — must not invent new URLs.
  - Must not invent: materials, certifications, product capabilities, delivery promises, supplier facts.
  - **Listing content may use only a whitelist of verified CJ facts** (title, description, images, price, and other attributes sourced from the CJ record). Unsupported attributes are **omitted** entirely, not guessed.
  - LLM output validated against a strict response schema. **Schema validation enforces structure and field types only — it cannot prove that product claims are factual.** Factual correctness comes from the whitelist restriction above, not from schema validation.

---

## External-data handling (prompt-injection risk reduction)

CJ and SerpApi content is **untrusted data**. Before any of it reaches the LLM:

1. Pass it as **clearly delimited structured JSON** (not free text merged into instructions).
2. **Limit field lengths** (e.g. truncate titles/descriptions to a bounded character count).
3. **Remove HTML and control characters** (via `lib/sanitize.ts`).
4. **Never place external text in system instructions** — external content lives only inside a delimited user-message data block.
5. Explicitly instruct the model that external content is **data, not instructions**, and must never be followed as directives.
6. Validate the LLM output against a **strict response schema**; reject malformed or unsupported output.
7. Reject unsupported claims at the whitelist layer — the listing may use only verified CJ facts, and anything not on the whitelist is omitted. **Schema validation enforces structure, not factuality**; it cannot detect an invented claim that happens to be well-formed.

This is described as **prompt-injection risk reduction**, not a guaranteed defense — no amount of prompt hardening fully eliminates injection risk.

---

## Failure cases and security tests

| Test | What it checks | Expected behavior |
|------|---------------|-------------------|
| Missing API keys | Graceful degradation | Clear error: "{provider} key not configured" |
| Invalid/expired CJ token | Token lifecycle | One reauthentication attempt; if that fails, clear error |
| CJ rate limiting | Queued rate limiter | Honor 1 req/sec + `Retry-After`; max 3 retries with backoff |
| SerpApi rate limiting | Quota exhaustion | Clear error with retry suggestion |
| Network timeouts | Resilience | 10s timeout per call; partial results if possible |
| Missing freight info | Data gaps | Reject with reason (fulfillment confidence = 0) |
| No shipping method to country | Post-freight gate | Reject **after** freight call, not before |
| Delivery exceeds maxShippingDays | Post-freight gate | Reject with reason |
| Missing Trends data | SerpApi gap | Demand momentum = N/A; reject with reason |
| No usable Shopping prices | SerpApi gap | Margin cannot be calculated; reject with reason |
| Currency mismatches | FX risk | Reject if CJ currency ≠ Shopping currency and no FX rate available |
| Zero or invalid prices | Data quality | Reject with reason |
| No products passing gates | Empty result | Show rejected list with reasons; suggest refining constraints |
| Partial provider failure (CJ OK, SerpApi fail) | Resilience | Show CJ candidates **only as diagnostic partial results**, banner "market data unavailable", **no rankings/margin/demand/competition conclusions, no listing generation**, retry action |
| Prompt injection in product text | Security | External text treated as data only; sanitized; model instructed not to follow it |
| Browser-modified price/margin | Security | Approval token verified server-side; fresh CJ data re-fetched and compared; reject mismatches |
| Expired/tampered approval token | Security | Signature + expiry verified; reject |

A product can only be recommended and approved when the evidence required by the scoring engine is available.

---

## API-usage report

Displayed at the bottom of the evaluation results:

| Field | Source |
|-------|--------|
| CJ calls made this run | Tracked in `api-usage.ts` |
| SerpApi calls made this run | Tracked in `api-usage.ts` |
| Cache hits / misses | Tracked in `api-usage.ts` |
| LLM calls + token usage | Read from the actual `usage` object returned by the selected OpenAI API/SDK — **not** from headers, and never hardcoded field names. For the Responses API these are `input_tokens`, `output_tokens`, and `total_tokens`; for Chat Completions they are `prompt_tokens`, `completion_tokens`, and `total_tokens`. Read whichever fields the chosen API actually returns. |
| Estimated monetary cost | Shown **only** if a model-specific pricing config is present and accurate; otherwise show token usage only, no invented cost |
| Account quota remaining | **Only if provider returns it via an official usage endpoint.** Do not infer. |

---

## Caching strategy

- **CJ access token**: Cached server-side with expiry timestamp. Refreshed only when expired.
- **CJ product/freight data**: Best-effort in-memory TTL cache (optional optimization). May not persist across serverless instances.
- **SerpApi responses**: Rely on SerpApi provider-side caching for identical requests.
- **Browser session**: Holds constraints, evaluated products, approval tokens, and approval state for the current workflow.
- **No database.** No guarantee that cache persists for any duration.

---

## Credential and source-link protection

- All API credentials in server-side env vars only (including `APP_SIGNING_SECRET`).
- CJ access token never sent to the browser.
- SerpApi key never included in displayed source links.
- Source links use safe public URLs:
  - Google Trends: `https://trends.google.com/trends/explore?q={term}`
  - Google Shopping: `https://www.google.com/search?q={term}&tbm=shop`
  - CJ: product ID or documented product page URL only. No unofficial CJ URLs unless format verified.

---

## Step-by-step implementation plan

1. **Approve the plan** — user approves this revised plan.
2. **Configure keys** — set `CJ_API_KEY`, `SERPAPI_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `APP_SIGNING_SECRET` in `.env` (or `.env.local`). Ensure `.env` and `.env.local` are excluded from source control (listed in `.gitignore`).
3. **CJ Dropshipping feasibility test** — authenticate via `POST /api2.0/v1/authentication/getAccessToken` using `CJ_API_KEY`, call `GET /api2.0/v1/product/listV2` with a test keyword, call `POST /api2.0/v1/logistic/freightCalculate` for one product. Validate **required fields exist**:
   - Product and variant IDs (non-empty strings)
   - Variant price, weight, inventory, and images (numeric price/weight, numeric inventory, non-empty image URLs)
   - Freight cost (numeric, non-negative, not missing)
   - Shipping method (non-empty method identifier)
   - Delivery estimate (numeric days, not missing)
   If any required field is missing or invalid, stop and revise the scoring logic before building. **Hard gate — stop if this fails.**

4. **SerpApi feasibility test** — call Google Trends endpoint and Google Shopping endpoint with a test keyword. Validate **required fields exist**:
   - At least 12 usable Trends points (weekly interest values, numeric 0–100)
   - Shopping prices and currency (numeric prices, non-empty currency code)
   - Merchant/source information (non-empty merchant/source names)
   - Reviews (numeric review counts or valid absence indicators)
   - Multiple-seller information, if the competition formula depends on it (multi-seller indicators present)
   If any required field is missing or invalid, stop and revise the scoring logic before building. **Hard gate — stop if this fails.**

5. **OpenAI feasibility test** — using `OPENAI_API_KEY` and `OPENAI_MODEL`, make a test API call that uses **structured JSON output**. Validate:
   - The API key is valid and can authenticate
   - The selected model is available and accessible
   - Structured JSON output is returned and parseable
   Do not assume a ChatGPT account provides usable API access. **Hard gate — stop if this fails.**

6. **Install/verify Node and scaffold Next.js app** — TypeScript, Tailwind, API routes, `.env.example`. Use `build-web-app` skill. **Do not create `package.json` before steps 3, 4, and 5 succeed.**
7. **CJ client** — token caching with expiry, `product/listV2` search with filters, `logistic/freightCalculate` per finalist, queued rate limiter (1 req/sec), `Retry-After` handling, limited retries, single reauthentication on auth failure.
8. **SerpApi client** — Google Trends (trend direction, slope, stability, related rising queries for discovery only), Google Shopping (median price, unique merchants, multi-seller %, price spread, review data). Batch Trends terms where supported.
9. **Scoring module** (`lib/scoring.ts`) — all deterministic 0–100 normalization formulas (margin, direction, slope, stability, merchant diversity, multi-seller, price spread, review concentration, delivery range, inventory, data completeness). Unit-test every formula.
10. **Evaluation engine** — financial calculations (deterministic), 4 sub-scores, rejection gates, composite scoring, ranking, top 3–5 cutoff, "needs more evidence" handling. Deterministic recommendation explanations.
11. **LLM integration** — Call 1 (goal interpretation, structured JSON + validation), Call 2 (listing generation with restrictions, strict schema validation). `OPENAI_MODEL` for both. **Read token usage from the `usage` object in the API response**, not from headers. Do not hardcode field names.
12. **`/api/interpret` route** — free-text goal → LLM Call 1 → validated constraints.
13. **`/api/evaluate` route** — wire CJ + SerpApi + engine. Candidate funnel. Failure handling. API-usage tracking. Returns ranked + needsMoreEvidence + rejected products + approval tokens (only for ranked).
14. **`/api/listing` route** — approval-token verification, re-fetch CJ data, recalculate costs, reject mismatches, LLM Call 2 with restrictions.
15. **Frontend: goal input + constraint confirmation** — free-text goal, editable confirmation screen for interpreted constraints before evaluation.
16. **Frontend: ranked results** — product cards with composite score, expandable evidence panels (raw data, timestamps, safe source links, both saturation risk and competition opportunity), rejected products section, "needs more evidence" section, deterministic recommendations, API-usage report.
17. **Frontend: approval + listing preview** — approve button triggers `/api/listing` (sends only productId/variantId/token), renders listing preview.
18. **Failure and security tests** — implement all failure cases from the table. Test prompt-injection risk reduction, browser-modified payload rejection, expired/tampered token rejection.
19. **End-to-end verification** — run full app, submit a real seller goal, confirm real data flows through interpretation → confirmation → evaluation → approval → listing. Browser snapshot as evidence.

**Gates before full build:** Steps 3, 4, and 5 (CJ, SerpApi, and OpenAI feasibility tests) must succeed with real data, and the user must approve this revised plan, before continuing to steps 6+.
