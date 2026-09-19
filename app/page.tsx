"use client";

import { useEffect, useState } from "react";
import Intro from "./Intro";

type ApiUsage = {
  cjCalls: number;
  serpApiCalls: number;
  openaiCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmModel: string;
  cacheHits: number;
  cacheMisses: number;
};

type Constraints = {
  searchPhrases: string[];
  category: string | null;
  maxProductCost: number;
  minMargin: number;
  destinationCountry: string;
  maxShippingDays: number;
};

type Evaluation = {
  productId: string;
  variantId: string;
  title: string;
  image: string | null;
  currency: string;
  landedCost: number;
  productCost: number;
  freightCost: number | null;
  marketMedianPrice: number | null;
  suggestedPrice: number | null;
  minSellingPrice: number;
  expectedMargin: number | null;
  marketMedianSampleSize?: number;
  scores: {
    marginScore: number | null;
    momentumScore: number | null;
    fulfillmentScore: number | null;
    competitionOpportunity: number | null;
    saturationRisk: number | null;
    composite: number | null;
  };
  evidence: { label: string; value: string; source: string; fetchedAt: string }[];
  inventory: { cjHeld: number | null; factory: number | null; total: number | null; rowCount: number } | null;
  recommendation: string;
  approvalToken?: string;
};

type Listing = {
  title: string;
  description: string;
  featureBullets: string[];
  suggestedPrice: number;
  minSellingPrice: number;
  currency: string;
  images: string[];
  productId: string;
  variantId: string;
  costBreakdown: { productCost: number; freightCost: number; landedCost: number; margin: number };
};

type NeedsMore = { productId: string; variantId: string; reason: string };
type Rejection = { productId: string; variantId: string; reasons: string[] };

type SearchSummary = {
  cjResultsFound: number;
  passedRelevance: number;
  passedPrice: number;
  hadValidFreight: number;
  minDeliveryDaysFound: number | null;
  noCandidatesReason: string | null;
};

const EXAMPLE_PROMPTS = [
  "Lightweight desk accessories under $12, ship to US in 10 days, leave 35% margin",
  "Self-care products under $8 that can ship to the US within 7 days",
  "Compact travel accessories under $15 with 3-day delivery to Germany",
];

export default function Home() {
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Intro vs workspace. Default to the intro so SSR emits real markup;
  // the effect below switches returning visitors straight to the workspace.
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    // Returning visitors skip the intro; the workspace has a "revisit" control.
    let seen = false;
    try {
      seen = window.localStorage.getItem("nichescout:introSeen") === "1";
    } catch {
      // localStorage can be unavailable (private mode) — show the intro.
      seen = false;
    }
    if (seen) setShowIntro(false);
  }, []);

  function enterWorkspace() {
    try { window.localStorage.setItem("nichescout:introSeen", "1"); } catch {}
    setShowIntro(false);
    window.scrollTo(0, 0);
  }

  function replayIntro() {
    setShowIntro(true);
    window.scrollTo(0, 0);
  }

  const [goal, setGoal] = useState(EXAMPLE_PROMPTS[0]);
  const [confirming, setConfirming] = useState(false);
  const [constraints, setConstraints] = useState<Constraints | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [evalResult, setEvalResult] = useState<{
    rankedProducts: Evaluation[];
    needsMoreEvidenceProducts: NeedsMore[];
    rejectedProducts: Rejection[];
    searchSummary?: SearchSummary;
    apiUsage: ApiUsage;
  } | null>(null);
  const [interpretUsage, setInterpretUsage] = useState<ApiUsage | null>(null);
  const [evalUsage, setEvalUsage] = useState<ApiUsage | null>(null);
  const [listingByVariant, setListingByVariant] = useState<Record<string, Listing>>({});

  function fillExample(p: string) { setGoal(p); }

  async function interpret() {
    setRunning(true); setError(null);
    try {
      const r = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "interpretation failed");
      setConstraints(j.constraints);
      setInterpretUsage(j.apiUsage ?? null);
      setStep(1);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "interpretation failed");
    } finally { setRunning(false); }
  }

  async function evaluate() {
    if (!constraints) return;
    setRunning(true); setError(null); setConfirming(false);
    try {
      const r = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ constraints }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "evaluation failed");
      setEvalResult(j);
      setEvalUsage(j.apiUsage ?? null);
      setListingByVariant({});
      setStep(2);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "evaluation failed");
    } finally { setRunning(false); }
  }

  async function approve(productId: string, variantId: string, token?: string) {
    if (!token) { setError("That product isn't ready to convert. Try another one."); return; }
    setRunning(true); setError(null);
    try {
      const r = await fetch("/api/listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, variantId, approvalToken: token }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "listing failed");
      setListingByVariant((m) => ({ ...m, [variantId]: j.listing }));
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "listing failed");
    } finally { setRunning(false); }
  }

  const isInterpreting = running && !confirming && step === 0;
  const isEvaluating = running && confirming && step === 1;

  if (showIntro) {
    return <Intro onEnter={enterWorkspace} />;
  }

  return (
    <div className="shell workspaceReveal">
      <header className="header">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">N</div>
          <div>
            <div className="brandName">NicheScout</div>
            <div className="brandTag">Find products worth selling</div>
          </div>
        </div>
        <button className="wsReplay" onClick={replayIntro}>
          ↻ Replay intro
        </button>
      </header>

      <Flow step={step} />

      {step === 0 && (
        <>
          <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2 className="cardTitle">What would you like to sell?</h2>
            <p className="cardSub">
              Explore supplier costs, market signals, and shipping before you commit.
            </p>
            <label className="field" htmlFor="goal">
              <span className="fieldLabel">Describe your niche</span>
              <textarea
                id="goal"
                className="textarea"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                aria-describedby="goal-help"
              />
              <div id="goal-help" className="help">Or pick one to start:</div>
            </label>
            <div className="examples" role="list">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="exampleChip"
                  role="listitem"
                  onClick={() => fillExample(p)}
                  disabled={running}
                >
                  {p}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="btn btnPrimary"
                onClick={interpret}
                disabled={running || !goal.trim()}
              >
                {isInterpreting && <span className="spinner" aria-hidden="true" />}
                {isInterpreting ? "Reviewing…" : "Review my criteria"}
              </button>
            </div>
          </div>

          <WhatYouGet />
        </>
      )}

      {step === 1 && constraints && (
        <>
          <div className="card">
            <h2 className="cardTitle">Review my criteria</h2>
            <p className="cardSub">
              NicheScout translated your description into these working numbers. Adjust anything that doesn't fit,
              then find opportunities that match.
            </p>
            <Criteria constraints={constraints} onChange={setConstraints} disabled={isEvaluating} />
            <div style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button
                className="btn btnGhost"
                onClick={() => { setStep(0); setConstraints(null); setConfirming(false); }}
                disabled={isEvaluating}
              >
                ← Start over
              </button>
              <button
                className="btn btnPrimary"
                onClick={() => setConfirming(true)}
                disabled={isEvaluating}
              >
                Confirm and find opportunities →
              </button>
            </div>
          </div>

          {confirming && (
            <div className="card" style={{ borderColor: "var(--o-300)", background: "rgba(249, 115, 22, 0.16)" }}>
              <h2 className="cardTitle" style={{ fontSize: 18 }}>One more thing</h2>
              <p className="cardSub">
                Pressing the button below will check real supplier prices and market signals for your criteria.
                You'll see ranked options with the evidence behind each one — nothing added to a store.
              </p>
              <button
                className="btn btnPrimary btnBlock"
                onClick={evaluate}
                disabled={isEvaluating}
              >
                {isEvaluating && <span className="spinner" aria-hidden="true" />}
                {isEvaluating ? "Searching opportunities…" : "Find opportunities"}
              </button>
            </div>
          )}

          {error && <div className="banner bannerDanger" role="alert">⚠ {error}</div>}
        </>
      )}

      {step >= 1 && interpretUsage && step < 2 && (
        <p style={{ marginTop: 14, fontSize: 12, color: "var(--on-grad-muted)", textAlign: "center" }}>
          Interpretation used {interpretUsage.llmInputTokens + interpretUsage.llmOutputTokens} tokens · {interpretUsage.llmModel}
        </p>
      )}

      {isEvaluating && (
        <div className="card" aria-busy="true" style={{ marginTop: 16 }}>
          <h2 className="cardTitle" style={{ fontSize: 18 }}>Comparing candidates</h2>
          <p className="cardSub">Checking supplier cost, shipping, and market evidence. This usually takes a few seconds.</p>
          <div className="skeleton" style={{ height: 92, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 92, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 92 }} />
        </div>
      )}

      {step === 2 && evalResult && (
        <>
          {error && <div className="banner bannerDanger" role="alert">⚠ {error}</div>}
          <Results
            result={evalResult}
            listings={listingByVariant}
            onApprove={approve}
            onReset={() => { setStep(0); setConstraints(null); setEvalResult(null); setEvalUsage(null); setListingByVariant({}); }}
            running={running}
          />
        </>
      )}
    </div>
  );
}

function Flow({ step }: { step: 0 | 1 | 2 }) {
  const titles = ["Describe your niche", "Review opportunities", "Create a listing"];
  const descs = [
    "Share what you want to sell",
    "Approve the criteria and review matches",
    "Generate a launch-ready product draft",
  ];
  return (
    <nav className="flow" aria-label="Progress">
      {titles.map((t, i) => {
        const cls = step === i ? "flowStep flowActive" : step > i ? "flowStep flowDone" : "flowStep";
        return (
          <div key={t} className={cls} aria-current={step === i ? "step" : undefined}>
            <div className="flowNum">{step > i ? "✓" : i + 1}</div>
            <div>
              <div className="flowTitle">{t}</div>
              <div className="flowDesc">{descs[i]}</div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function WhatYouGet() {
  const items = [
    { title: "Cost & margin estimates", desc: "Supplier cost, freight, and a single suggested selling price with verified margin." },
    { title: "Shipping checks", desc: "Real freight options and delivery estimates against your destination and timeline." },
    { title: "Evidence-backed comparisons", desc: "Market signals plus supplier facts — what's verified, what's still missing, and why." },
  ];
  return (
    <section className="card" aria-label="What NicheScout provides">
      <h2 className="cardTitle" style={{ fontSize: 18 }}>What you'll see in the results</h2>
      <div className="promises">
        {items.map((p) => (
          <div key={p.title} className="promise">
            <span className="promiseTitle">{p.title}</span>
            <span className="promiseDesc">{p.desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Criteria({ constraints, onChange, disabled }: {
  constraints: Constraints;
  onChange: (c: Constraints) => void;
  disabled: boolean;
}) {
  function update<K extends keyof Constraints>(k: K, v: Constraints[K]) {
    onChange({ ...constraints, [k]: v });
  }
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(2,1fr)" }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <span className="fieldLabel">Search phrases (one per line, max 3)</span>
        <textarea
          className="textarea"
          rows={3}
          disabled={disabled}
          value={constraints.searchPhrases.join("\n")}
          onChange={(e) =>
            update(
              "searchPhrases",
              e.target.value
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 3),
            )
          }
        />
      </div>
      <label className="field">
        <span className="fieldLabel">Max supplier cost (USD)</span>
        <input
          className="input" type="number" min={0.01} step="0.01"
          disabled={disabled}
          value={constraints.maxProductCost}
          onChange={(e) => update("maxProductCost", Number(e.target.value))}
        />
        <span className="help">What you pay CJ per unit — not the price you'll sell at.</span>
      </label>
      <label className="field">
        <span className="fieldLabel">Min required margin (0–1)</span>
        <input
          className="input" type="number" min={0.01} max={0.99} step="0.01"
          disabled={disabled}
          value={constraints.minMargin}
          onChange={(e) => update("minMargin", Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span className="fieldLabel">Destination country (ISO-2)</span>
        <input
          className="input" maxLength={2} disabled={disabled}
          value={constraints.destinationCountry}
          onChange={(e) => update("destinationCountry", e.target.value.toUpperCase())}
        />
      </label>
      <label className="field">
        <span className="fieldLabel">Max shipping days</span>
        <input
          className="input" type="number" min={1} max={60} disabled={disabled}
          value={constraints.maxShippingDays}
          onChange={(e) => update("maxShippingDays", Number(e.target.value))}
        />
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="fieldLabel">Category (optional)</span>
        <input
          className="input" disabled={disabled}
          value={constraints.category ?? ""}
          onChange={(e) => update("category", e.target.value.trim() || null)}
        />
      </label>
    </div>
  );
}

function Results({
  result, listings, onApprove, onReset, running,
}: {
  result: {
    rankedProducts: Evaluation[];
    needsMoreEvidenceProducts: NeedsMore[];
    rejectedProducts: Rejection[];
    searchSummary?: SearchSummary;
    apiUsage: ApiUsage;
  };
  listings: Record<string, Listing>;
  onApprove: (p: string, v: string, t?: string) => void;
  onReset: () => void;
  running: boolean;
}) {
  const hasRanked = result.rankedProducts.length > 0;

  return (
    <>
      <div className="sectionHeader">
        <h2 className="sectionTitle">Opportunities</h2>
        <button className="btn btnGhost btnSm" onClick={onReset} disabled={running}>Start a new search</button>
      </div>

      {!hasRanked && result.needsMoreEvidenceProducts.length === 0 && result.rejectedProducts.length === 0 && (
        <div className="card" role="status" style={{ borderColor: "#fde68a", background: "rgba(120, 53, 15, 0.55)" }}>
          <h3 className="cardTitle" style={{ fontSize: 16, color: "#fde68a" }}>
            No products matched your criteria
          </h3>
          <p style={{ marginTop: 6, fontSize: 14, color: "var(--on-grad-soft)" }}>
            {result.searchSummary?.noCandidatesReason
              ?? "We didn't find candidates for this niche. Try a wider cost range or a longer shipping window."}
          </p>
          {result.searchSummary && (
            <div className="summaryGrid" style={{ marginTop: 14 }}>
              <div className="summaryCell">
                <div className="summaryLabel">Found on CJ</div>
                <div className="summaryValue">{result.searchSummary.cjResultsFound}</div>
              </div>
              <div className="summaryCell">
                <div className="summaryLabel">Matched niche</div>
                <div className="summaryValue">{result.searchSummary.passedRelevance}</div>
              </div>
              <div className="summaryCell">
                <div className="summaryLabel">Within cost</div>
                <div className="summaryValue">{result.searchSummary.passedPrice}</div>
              </div>
              <div className="summaryCell">
                <div className="summaryLabel">Shippable</div>
                <div className="summaryValue">{result.searchSummary.hadValidFreight}</div>
              </div>
            </div>
          )}
          {result.searchSummary?.minDeliveryDaysFound !== null && result.searchSummary?.minDeliveryDaysFound !== undefined && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--on-grad-soft)" }}>
              Fastest shipping to this destination: <b>{result.searchSummary.minDeliveryDaysFound} days</b>.
            </p>
          )}
        </div>
      )}

      {hasRanked && (
        <section aria-label="Best opportunities">
          {result.rankedProducts.map((p) => (
            <ProductCard
              key={`${p.productId}:${p.variantId}`}
              product={p}
              listing={listings[p.variantId]}
              onApprove={onApprove}
              running={running}
            />
          ))}
        </section>
      )}

      {result.needsMoreEvidenceProducts.length > 0 && (
        <section aria-label="Needs more evidence">
          <div className="sectionHeader">
            <h3 className="sectionTitle" style={{ fontSize: 16 }}>Needs more evidence</h3>
            <span className="sectionMeta">{result.needsMoreEvidenceProducts.length}</span>
          </div>
          <p style={{ marginBottom: 8, fontSize: 13 }}>
            We couldn't compare these yet because a key signal is missing. Here are the precise blockers:
          </p>
          <ul className="list">
            {result.needsMoreEvidenceProducts.map((x) => (
              <li key={`${x.productId}:${x.variantId}`}>
                <div>
                  <div className="listId">{x.productId.slice(-10)}… · {x.variantId.slice(-10)}…</div>
                  <div style={{ marginTop: 2, color: "var(--on-grad)" }}>{x.reason}</div>
                </div>
                <span className="pill pillWarn">Awaiting evidence</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.rejectedProducts.length > 0 && (
        <section aria-label="Did not qualify">
          <div className="sectionHeader">
            <h3 className="sectionTitle" style={{ fontSize: 16 }}>Did not qualify</h3>
            <span className="sectionMeta">{result.rejectedProducts.length}</span>
          </div>
          <ul className="list">
            {result.rejectedProducts.map((x) => (
              <li key={`${x.productId}:${x.variantId}`}>
                <div>
                  <div className="listId">{x.productId.slice(-10)}… · {x.variantId.slice(-10)}…</div>
                  <div style={{ marginTop: 2, color: "var(--on-grad)" }}>{x.reasons.join(" · ")}</div>
                </div>
                <span className="pill pillDanger">Did not qualify</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ProductCard({
  product, listing, onApprove, running,
}: {
  product: Evaluation;
  listing?: Listing;
  onApprove: (p: string, v: string, k?: string) => void;
  running: boolean;
}) {
  const composite = product.scores.composite;
  const marginPct =
    product.expectedMargin !== null && Number.isFinite(product.expectedMargin)
      ? (product.expectedMargin * 100).toFixed(1) + "%"
      : "—";
  const freightEv = product.evidence.find((e) => /freight|shipping|deliver/i.test(e.label));
  const shipping = freightEv
    ? freightEv.value.replace(/upper bound .*$/, "").trim()
    : "—";

  return (
    <article className="productCard" style={{ gridTemplateColumns: "1fr" }}>
      <div style={{ display: "grid", gridTemplateColumns: "96px 1fr auto", gap: 16 }}>
        {product.image ? (
          <img className="productImg" src={product.image} alt="" />
        ) : (
          <div className="productImgFallback" aria-hidden="true">📦</div>
        )}
        <div className="productBody">
          <div className="productTitle">{product.title}</div>
          <div className="productMeta">
            <span>Supplier cost <b>${product.productCost.toFixed(2)}</b></span>
            <span>Shipping <b>${(product.freightCost ?? 0).toFixed(2)}</b></span>
            <span>Landed cost <b>${product.landedCost.toFixed(2)}</b></span>
            <span>Sell at <b>{product.suggestedPrice !== null ? "$" + product.suggestedPrice.toFixed(2) : "—"}</b></span>
            <span>Margin <b>{marginPct}</b></span>
            <span>Delivery <b>{shipping}</b></span>
            <span>Market median <b>{product.marketMedianPrice !== null ? "$" + product.marketMedianPrice.toFixed(2) : "—"}</b></span>
          </div>
          <div className="productStatus">
            <span className="pill pillOk">Stock verified</span>
            <span className="pill pillMuted">{product.marketMedianSampleSize ?? 0} market results</span>
            <span className="pill pillMuted">{product.evidence.length} evidence items</span>
          </div>
        </div>
        <div className="productSide">
          <div className={"scoreRing" + (composite === null ? " scoreRingMuted" : "")}
               aria-label={composite !== null ? `Opportunity score ${composite.toFixed(0)} out of 100` : "Score not yet available"}>
            {composite !== null ? composite.toFixed(0) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--on-grad-muted)", textAlign: "center" }}>out of 100</div>
        </div>
      </div>

      <ScoreBreakdown scores={product.scores} />

      <div style={{ marginTop: 8, padding: "12px 14px", background: "rgba(255,255,255,0.10)", borderRadius: "var(--radius)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--on-grad)" }}>Why this ranked here</div>
        <p style={{ fontSize: 13, color: "var(--on-grad-soft)", lineHeight: 1.55 }}>{product.recommendation}</p>
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--on-grad-muted)", padding: "6px 0" }}>
          All evidence ({product.evidence.length})
        </summary>
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
          {product.evidence.map((ev, i) => (
            <li key={i} style={{ padding: "8px 0", borderTop: i > 0 ? "1px solid var(--glass-line)" : "none", fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: "var(--on-grad)", marginBottom: 2 }}>{ev.label}</div>
              <div style={{ color: "var(--on-grad-soft)" }}>{ev.value}</div>
              <div style={{ fontSize: 11, color: "var(--on-grad-muted)", marginTop: 2 }}>
                {ev.source} · {ev.fetchedAt}
              </div>
            </li>
          ))}
        </ul>
      </details>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btn btnPrimary btnSm"
          onClick={() => onApprove(product.productId, product.variantId, product.approvalToken)}
          disabled={!product.approvalToken || running}
          title={!product.approvalToken ? "This product needs more evidence before you can create a listing" : undefined}
        >
          {running && listing ? "Generating…" : listing ? "Regenerate listing" : "Create listing"}
        </button>
      </div>

      {listing && (
        <ListingPreview listing={listing} />
      )}
    </article>
  );
}

function ScoreBreakdown({ scores }: { scores: Evaluation["scores"] }) {
  const bars = [
    { label: "Margin health", value: scores.marginScore, weight: "35%", desc: "Profit margin at suggested price vs. landed cost" },
    { label: "Demand momentum", value: scores.momentumScore, weight: "25%", desc: "Google Trends slope and stability over 12 months" },
    { label: "Competition opportunity", value: scores.competitionOpportunity, weight: "25%", desc: `Lower saturation risk is better (current: ${scores.saturationRisk !== null ? scores.saturationRisk.toFixed(0) : "—"} / 100)` },
    { label: "Fulfillment confidence", value: scores.fulfillmentScore, weight: "15%", desc: "Shipping availability, delivery time, stock, data completeness" },
  ];
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      {bars.map((b) => (
        <div key={b.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--on-grad)" }}>{b.label}</div>
            <div style={{ fontSize: 11, color: "var(--on-grad-muted)" }}>{b.weight} weight</div>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.10)", borderRadius: 4, overflow: "hidden" }}>
            <div
              style={{
                width: b.value !== null ? `${Math.max(2, b.value)}%` : "0%",
                height: "100%",
                background: b.value !== null && b.value >= 70 ? "var(--grad-ember)"
                  : b.value !== null && b.value >= 40 ? "linear-gradient(155deg, #b45309 0%, #d97706 100%)"
                  : "linear-gradient(155deg, #7f1d1d 0%, #b91c1c 100%)",
                borderRadius: 4,
                transition: "width 300ms ease",
              }}
            />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, textAlign: "right", color: "var(--on-grad)" }}>
            {b.value !== null ? b.value.toFixed(0) : "—"}
          </div>
          {/* Tooltip-like description below */}
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--on-grad-muted)", marginBottom: 2 }}>
            {b.desc}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListingPreview({ listing }: { listing: Listing }) {
  return (
    <div className="listingCard">
      <div className="listingHero">
        {listing.images.length > 0 ? (
          <img className="listingImg" src={listing.images[0]} alt="" />
        ) : (
          <div className="listingImgFallback" aria-hidden="true">📦</div>
        )}
        <div>
          <h3 className="listingTitle">{listing.title}</h3>
          <p className="listingDesc">{listing.description}</p>
          <ul className="listingBullets">
            {listing.featureBullets.map((b, i) => (<li key={i}>{b}</li>))}
          </ul>
        </div>
      </div>
      <div className="listingCostTable">
        <div className="listingCell">Supplier cost<b>${listing.costBreakdown.productCost.toFixed(2)}</b></div>
        <div className="listingCell">Shipping<b>${listing.costBreakdown.freightCost.toFixed(2)}</b></div>
        <div className="listingCell">Estimated margin<b>{(listing.costBreakdown.margin * 100).toFixed(1)}%</b></div>
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: "var(--on-grad-muted)" }}>
        Suggested price ${listing.suggestedPrice.toFixed(2)} · Minimum profitable ${listing.minSellingPrice.toFixed(2)} ({listing.currency}).
      </p>
    </div>
  );
}
