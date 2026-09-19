#!/usr/bin/env node
/**
 * Capture visual snapshots of every key UI state using offline fixtures.
 * Writes self-contained HTML files (one per state) so we can verify desktop
 * + mobile layouts in the browser without making any live API calls.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "snapshots");
mkdirSync(OUT, { recursive: true });

const cssText = readFileSync(path.join(HERE, "..", "app", "globals.css"), "utf8");

function docShell(content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NicheScout</title><style>${cssText}</style></head><body><main>${content}</main></body></html>`;
}

function flow(active) {
  const titles = ["Describe your niche", "Review opportunities", "Create a listing"];
  const descs = ["Share what you want to sell", "Approve criteria and review matches", "Generate a launch-ready product draft"];
  return `<nav class="flow">${titles.map((t, i) => {
    const cls = active === i ? "flowStep flowActive" : active > i ? "flowStep flowDone" : "flowStep";
    const num = active > i ? "✓" : i + 1;
    return `<div class="${cls}"><div class="flowNum">${num}</div><div><div class="flowTitle">${t}</div><div class="flowDesc">${descs[i]}</div></div></div>`;
  }).join("")}</nav>`;
}

function brand() {
  return `<header class="header"><div class="brand"><div class="brandMark">N</div><div><div class="brandName">NicheScout</div><div class="brandTag">Find products worth selling</div></div></div></header>`;
}

function initialState() {
  const card = `<div class="card" style="max-width:720px;margin:0 auto"><h2 class="cardTitle">What would you like to sell?</h2><p class="cardSub">Explore supplier costs, market signals, and shipping before you commit.</p><label class="field"><span class="fieldLabel">Describe your niche</span><textarea class="textarea" rows="3">Lightweight desk accessories under $12, ship to US in 10 days, leave 35% margin</textarea><div class="help">Or pick one to start:</div></label><div class="examples"><button class="exampleChip">Lightweight desk accessories under $12, ship to US in 10 days, leave 35% margin</button><button class="exampleChip">Self-care products under $8 with 7-day US shipping</button><button class="exampleChip">Compact travel accessories under $15 with 3-day delivery to Germany</button></div><div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btnPrimary">Review my criteria</button></div></div>`;
  const promises = `<section class="card"><h2 class="cardTitle" style="font-size:18px">What you'll see in the results</h2><div class="promises"><div class="promise"><span class="promiseTitle">Cost &amp; margin estimates</span><span class="promiseDesc">Supplier cost, freight, and a single suggested selling price with verified margin.</span></div><div class="promise"><span class="promiseTitle">Shipping checks</span><span class="promiseDesc">Real freight options and delivery estimates against your destination and timeline.</span></div><div class="promise"><span class="promiseTitle">Evidence-backed comparisons</span><span class="promiseDesc">Market signals plus supplier facts — what's verified, what's still missing.</span></div></div></section>`;
  return docShell(brand() + flow(0) + card + promises);
}

function criteriaState() {
  const c = `<div class="card"><h2 class="cardTitle">Review my criteria</h2><p class="cardSub">NicheScout translated your description into these working numbers. Adjust anything that doesn't fit, then find opportunities that match.</p><div style="display:grid;gap:14px;grid-template-columns:repeat(2,1fr)"><div style="grid-column:1/-1"><span class="fieldLabel">Search phrases (one per line, max 3)</span><textarea class="textarea" rows="3">desk organizer\nlightweight desk accessories</textarea></div><label class="field"><span class="fieldLabel">Max product cost (USD)</span><input class="input" value="12"></label><label class="field"><span class="fieldLabel">Min required margin (0–1)</span><input class="input" value="0.35"></label><label class="field"><span class="fieldLabel">Destination country (ISO-2)</span><input class="input" value="US"></label><label class="field"><span class="fieldLabel">Max shipping days</span><input class="input" value="10"></label><label class="field" style="grid-column:1/-1"><span class="fieldLabel">Category (optional)</span><input class="input" placeholder=""></label></div><div style="margin-top:18px;display:flex;gap:10px;justify-content:space-between"><button class="btn btnGhost">← Start over</button><button class="btn btnPrimary">Confirm and find opportunities →</button></div></div>`;
  return docShell(brand() + flow(1) + c);
}

function confirmState() {
  return criteriaState() +
    `<div class="card" style="border-color:var(--accent);background:var(--accent-soft);margin-top:16px"><h2 class="cardTitle" style="font-size:18px">One more thing</h2><p class="cardSub" style="color:var(--text-soft)">Pressing the button below will check real supplier prices and market signals for your criteria.</p><button class="btn btnPrimary btnBlock">Find opportunities</button></div>`;
}

function resultsState() {
  const card = `<div class="card"><h2 class="cardTitle">Opportunities</h2><div class="sectionHeader"><h3 class="sectionTitle" style="font-size:16px">Needs more evidence</h3><span class="sectionMeta">5</span></div><p style="margin-bottom:8px;font-size:13px">We couldn't compare these yet because a key signal is missing. Here are the precise blockers:</p><ul class="list"><li><div><div class="listId">…2614544</div><div style="margin-top:2px;color:var(--text)">Needs more evidence — only 0 usable market results (minimum 5); no currency code on market results</div></div><span class="pill pillWarn">Awaiting evidence</span></li><li><div><div class="listId">…1626300</div><div style="margin-top:2px;color:var(--text)">Needs more evidence — only 0 usable market results (minimum 5); no currency code on market results</div></div><span class="pill pillWarn">Awaiting evidence</span></li></ul></div>`;
  return docShell(brand() + flow(2) + card);
}

function resultsWithListingState() {
  const card = `<div class="card"><h2 class="cardTitle">Opportunities</h2><div class="productCard"><div class="productImgFallback" aria-hidden="true">📦</div><div class="productBody"><div class="productTitle">Magnetic Phone Stand — Adjustable Aluminum Holder for Desk</div><div class="productMeta"><span>Cost <b>$9.20</b></span><span>Suggested <b>$19.99</b></span><span>Margin <b>54.0%</b></span><span>Delivery <b>5–11 days via CJPacket Sensitive Pro</b></span></div><div class="productStatus"><span class="pill pillOk">Stock verified</span><span class="pill pillMuted">6 evidence items</span></div></div><div class="productSide"><div class="scoreRing">83</div><button class="btn btnPrimary btnSm">Create listing</button></div><div style="grid-column:1/-1"><div class="listingCard"><div class="listingHero"><div class="listingImgFallback" aria-hidden="true">📦</div><div><h3 class="listingTitle">Adjustable Aluminum Phone Stand for Home and Travel</h3><p class="listingDesc">A stable, foldable phone stand made for everyday desk use. Compact and lightweight, fits any phone from 4.7" to 6.7".</p><ul class="listingBullets"><li>Fits most phones, including larger models</li><li>Adjustable angle for hands-free viewing</li><li>Foldable and lightweight for travel</li></ul></div></div><div class="listingCostTable"><div class="listingCell">Supplier cost<b>$2.10</b></div><div class="listingCell">Shipping<b>$7.10</b></div><div class="listingCell">Estimated margin<b>54.0%</b></div></div><p style="margin-top:12px;font-size:12px;color:var(--text-muted)">Suggested price $19.99 · Minimum profitable $13.20 (USD).</p></div></div></div>`;
  return docShell(brand() + flow(2) + card);
}

const files = {
  "01-initial.html": initialState(),
  "02-criteria.html": criteriaState(),
  "03-confirm.html": confirmState(),
  "04-results-needs-more.html": resultsState(),
  "05-results-with-listing.html": resultsWithListingState(),
};
for (const [name, html] of Object.entries(files)) writeFileSync(path.join(OUT, name), html);
console.log(`Wrote ${Object.keys(files).length} snapshots to ${OUT}`);
